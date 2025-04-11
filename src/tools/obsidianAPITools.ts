import { App } from 'obsidian';
import { SearchIndexer, SearchResult } from '../searchIndexer';

export class ObsidianAPITools {
	constructor(
		private readonly app: App,
		private searchIndexer: SearchIndexer
	) {}

	async createNewFile(title: string, content: string) {
		const file = await this.app.vault.create(`${title}.md`, content);
		return file;
	}

	/**
	 * Search for files containing the query term
	 * @param query Search query
	 * @param limit Maximum number of results to return
	 */
	async search(query: string, limit = 10): Promise<SearchResult[]> {
		return this.searchIndexer.search(query, limit);
	}

	/**
	 * Move files with specific tags to a destination folder
	 * @param tags Tags to search for
	 * @param destination Destination folder path
	 */
	async moveFilesByTags(
		tags: string[],
		destination: string
	): Promise<{ moved: string[]; errors: string[] }> {
		const moved: string[] = [];
		const errors: string[] = [];

		// Ensure the destination folder exists
		const destFolder = this.app.vault.getAbstractFileByPath(destination);
		if (!destFolder) {
			try {
				await this.app.vault.createFolder(destination);
			} catch (error) {
				throw new Error(`Could not create destination folder: ${destination}`);
			}
		}

		// Get all files with the specified tags
		const files = this.app.vault.getMarkdownFiles().filter(file => {
			const cache = this.app.metadataCache.getFileCache(file);
			if (!cache || !cache.tags) return false;

			const fileTags = cache.tags.map(t => t.tag.toLowerCase());
			return tags.some(tag => fileTags.includes(tag.toLowerCase()));
		});

		// Move each file to the destination
		for (const file of files) {
			const fileName = file.name;
			const destPath = `${destination}/${fileName}`;

			try {
				await this.app.vault.rename(file, destPath);
				moved.push(file.path);
			} catch (error) {
				errors.push(file.path);
			}
		}

		return { moved, errors };
	}

	/**
	 * Move files that match a search query to a destination folder
	 * @param query Search query
	 * @param destination Destination folder path
	 */
	async moveFilesBySearch(
		query: string,
		destination: string
	): Promise<{ moved: string[]; errors: string[] }> {
		const moved: string[] = [];
		const errors: string[] = [];

		// Ensure the destination folder exists
		const destFolder = this.app.vault.getAbstractFileByPath(destination);
		if (!destFolder) {
			try {
				await this.app.vault.createFolder(destination);
			} catch (error) {
				throw new Error(`Could not create destination folder: ${destination}`);
			}
		}

		// Search for files matching the query
		const searchResults = await this.search(query);

		// Move each file to the destination
		for (const result of searchResults) {
			const file = result.file;
			const fileName = file.name;
			const destPath = `${destination}/${fileName}`;

			try {
				await this.app.vault.rename(file, destPath);
				moved.push(file.path);
			} catch (error) {
				errors.push(file.path);
			}
		}

		return { moved, errors };
	}
}
