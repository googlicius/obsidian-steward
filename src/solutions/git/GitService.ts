import { App, FileSystemAdapter, normalizePath, Notice } from 'obsidian';
import * as git from 'isomorphic-git';
import * as fs from 'fs';
import { logger } from '../../utils/logger';

/**
 * Represents a Git operation that can be tracked and reverted
 */
export interface GitOperation {
	type: 'create' | 'modify' | 'delete' | 'move' | 'bulk';
	affectedFiles: string[]; // Paths of affected files
	description: string; // Human-readable description of the operation
	timestamp: number; // When the operation occurred
}

/**
 * Service for handling Git operations in the Obsidian vault
 */
export class GitService {
	private static instance: GitService;
	private app: App;
	private fs: typeof fs;
	private initialized = false;
	private gitDir: string;
	private vaultPath: string;
	private author = { name: 'Obsidian Steward', email: 'steward@obsidian.md' };

	private constructor(app: App) {
		this.app = app;
		this.fs = fs;
		this.vaultPath = normalizePath(this.adapter.getBasePath() || '');
		this.gitDir = `${this.vaultPath}/.git`;
	}

	get adapter() {
		return this.app.vault.adapter as FileSystemAdapter;
	}

	/**
	 * Get the singleton instance of GitService
	 */
	public static getInstance(app: App): GitService {
		if (!GitService.instance) {
			GitService.instance = new GitService(app);
		}
		return GitService.instance;
	}

	private async createGitignore(): Promise<void> {
		const gitignorePath = normalizePath(`${this.vaultPath}/.gitignore`);
		const requiredPatterns = ['Steward/'];

		try {
			// Try to read existing content
			let existingContent = '';
			try {
				existingContent = await this.fs.promises.readFile(gitignorePath, 'utf-8');
			} catch (error) {
				// File doesn't exist yet, that's okay
			}

			// Split existing content into lines and filter out empty ones
			const existingLines = existingContent.split('\n').filter(line => line.trim());

			// Add required patterns if they don't exist
			const newLines = [...existingLines];
			for (const pattern of requiredPatterns) {
				if (!existingLines.some(line => line.trim() === pattern)) {
					newLines.push(pattern);
				}
			}

			// Write back the combined content
			await this.fs.promises.writeFile(gitignorePath, newLines.join('\n') + '\n', 'utf-8');
		} catch (error) {
			logger.error('Failed to update .gitignore', error);
		}
	}

	/**
	 * Initialize the Git repository in the Obsidian vault
	 * @returns True if initialized successfully
	 */
	public async initialize(): Promise<boolean> {
		try {
			if (this.initialized) {
				return true;
			}
			const dotGitExists = await this.fs.promises
				.stat(this.gitDir)
				.then(() => true)
				.catch(() => false);

			if (!dotGitExists) {
				// Create .gitignore first
				await this.createGitignore();

				// Initialize git repository
				await git.init({
					fs: this.fs,
					dir: this.vaultPath,
					gitdir: this.gitDir,
					defaultBranch: 'steward',
				});
				logger.log('Git repository initialized');

				this.initialized = true;

				// Make initial commit
				this.commitChanges('Initial commit', true);
			}

			this.initialized = true;
			return true;
		} catch (error) {
			logger.error('Failed to initialize Git repository', error);
			return false;
		}
	}

	/**
	 * Commit changes to Git repository
	 * @param message Commit message
	 * @param initialCommit Whether this is the initial commit
	 * @returns The commit hash if successful
	 */
	public async commitChanges(message: string, initialCommit = false): Promise<string | null> {
		try {
			if (!this.initialized) {
				logger.error('Git repository not initialized');
				return null;
			}

			// If initial commit, add all files
			if (initialCommit) {
				// Add .gitignore first
				await git.add({ fs: this.fs, dir: this.vaultPath, filepath: '.gitignore' });

				// Then add markdown files in the vault
				const markdownFiles = this.app.vault.getMarkdownFiles();
				for (const file of markdownFiles) {
					await git.add({ fs: this.fs, dir: this.vaultPath, filepath: file.path });
				}
			} else {
				// Stage all changes
				const status = await git.statusMatrix({ fs: this.fs, dir: this.vaultPath });
				for (const [filepath, , worktreeStatus] of status) {
					if (worktreeStatus === 0) {
						logger.log(`Removing file: ${filepath}`);
						await git.remove({ fs: this.fs, dir: this.vaultPath, filepath });
					} else if (worktreeStatus !== 1) {
						logger.log(`Staging change: ${filepath}`);
						// If file has changed
						await git.add({ fs: this.fs, dir: this.vaultPath, filepath });
					}
				}
			}

			// Commit changes
			const sha = await git.commit({
				fs: this.fs,
				dir: this.vaultPath,
				message,
				author: this.author,
			});

			logger.log(`Committed changes: ${message}, SHA: ${sha}`);
			return sha;
		} catch (error) {
			logger.error('Failed to commit changes', error);
			return null;
		}
	}

	/**
	 * Track file operations and commit them
	 * @param operation The operation details
	 * @returns The commit hash if successful
	 */
	public async trackOperation(operation: GitOperation): Promise<string | null> {
		try {
			if (!this.initialized) {
				return null;
			}

			// Build a descriptive commit message
			const commitMessage = `${operation.type}: ${operation.description}`;

			// Let Git add the changes automatically (they're already done in the filesystem)
			const commitHash = await this.commitChanges(commitMessage);

			return commitHash;
		} catch (error) {
			logger.error('Failed to track operation', error);
			return null;
		}
	}

	/**
	 * Revert to a specific commit
	 * @param commitHash The commit hash to revert to
	 * @returns True if revert was successful
	 */
	public async revertToCommit(commitHash: string): Promise<boolean> {
		try {
			if (!this.initialized) {
				return false;
			}

			// Create a new commit that reverts to the specified state
			await git.checkout({
				fs: this.fs,
				dir: this.vaultPath,
				ref: commitHash,
				force: true,
			});

			// Notify about successful revert
			new Notice(`Successfully reverted changes to commit ${commitHash.substring(0, 7)}`);

			// Reload the vault to reflect the changes
			this.reloadVault();

			return true;
		} catch (error) {
			logger.error('Failed to revert to commit', error);
			new Notice(`Failed to revert changes: ${error.message}`);
			return false;
		}
	}

	/**
	 * Revert the last operation
	 * @returns True if revert was successful
	 */
	public async revertLastOperation(): Promise<boolean> {
		try {
			if (!this.initialized) {
				return false;
			}

			// Get the last two commits (HEAD and HEAD~1)
			const commits = await git.log({
				fs: this.fs,
				dir: this.vaultPath,
				depth: 2,
			});

			if (commits.length < 2) {
				new Notice('No previous commit to revert to');
				return false;
			}

			// Revert to the previous commit
			const previousCommit = commits[1].oid;
			return await this.revertToCommit(previousCommit);
		} catch (error) {
			logger.error('Failed to revert last operation', error);
			new Notice(`Failed to revert last operation: ${error.message}`);
			return false;
		}
	}

	/**
	 * Get commit history
	 * @param depth Number of commits to fetch (default: 10)
	 * @returns Array of commit objects
	 */
	public async getCommitHistory(depth = 10): Promise<any[]> {
		try {
			if (!this.initialized) {
				return [];
			}

			const commits = await git.log({
				fs: this.fs,
				dir: this.vaultPath,
				depth,
			});

			return commits.map(commit => ({
				hash: commit.oid,
				message: commit.commit.message,
				author: commit.commit.author,
				date: new Date(commit.commit.author.timestamp * 1000),
			}));
		} catch (error) {
			logger.error('Failed to get commit history', error);
			return [];
		}
	}

	/**
	 * Helper method to reload the vault after changes
	 * This forces Obsidian to re-read files from disk
	 */
	private reloadVault() {
		// Trigger a vault refresh by touching a file
		// This is a workaround since there's no direct API to refresh the vault
		const dummyOperation = async () => {
			try {
				// Find a random markdown file
				const files = this.app.vault.getMarkdownFiles();
				if (files.length > 0) {
					const randomFile = files[0];
					const content = await this.app.vault.read(randomFile);
					await this.app.vault.modify(randomFile, content);
				}
			} catch (error) {
				logger.error('Failed to reload vault', error);
			}
		};

		setTimeout(dummyOperation, 500);
	}
}
