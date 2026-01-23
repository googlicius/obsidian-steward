import type StewardPlugin from 'src/main';
import { logger } from 'src/utils/logger';
import { GITHUB_RAW_BASE_URL, DOCS_FOLDER_NAME } from 'src/constants';
import { Notice } from 'obsidian';
import i18next from 'i18next';

export type ResourceType = 'doc' | 'command' | 'image';

interface FetchResourceOptions {
  type: ResourceType;
  name: string;
  destinationFolder: string;
  githubPath: string;
  extension?: string;
}

/**
 * Service for fetching and managing resources from GitHub (docs, commands, images).
 * Resources are lazily fetched when accessed and cached in the vault.
 */
export class GitHubResourceService {
  private static instance: GitHubResourceService | null = null;

  private constructor(private plugin: StewardPlugin) {}

  /**
   * Get the singleton instance
   */
  public static getInstance(plugin?: StewardPlugin): GitHubResourceService {
    if (plugin) {
      GitHubResourceService.instance = new GitHubResourceService(plugin);
    }

    if (!GitHubResourceService.instance) {
      throw new Error('GitHubResourceService is not initialized');
    }

    return GitHubResourceService.instance;
  }

  /**
   * Get the local docs folder path in the vault
   */
  private getDocsFolderPath(): string {
    return `${this.plugin.settings.stewardFolder}/${DOCS_FOLDER_NAME}`;
  }

  /**
   * Get the commands folder path in the vault
   */
  private getCommandsFolderPath(): string {
    return `${this.plugin.settings.stewardFolder}/Commands`;
  }

  /**
   * Get the full path for a resource file in the vault
   */
  private getResourcePath(
    type: ResourceType,
    name: string,
    destinationFolder: string,
    extension = 'md'
  ): string {
    return `${destinationFolder}/${name}.${extension}`;
  }

  /**
   * Check if a resource file exists in the vault
   */
  private resourceExists(resourcePath: string): boolean {
    return this.plugin.app.vault.getFileByPath(resourcePath) !== null;
  }

  /**
   * Fetch a resource from GitHub
   */
  private async fetchResourceFromGitHub(
    githubPath: string,
    resourceName: string
  ): Promise<string | null> {
    const url = `${GITHUB_RAW_BASE_URL}/${githubPath}`;

    try {
      const response = await fetch(url);

      if (!response.ok) {
        if (response.status === 404) {
          logger.warn(`Resource not found on GitHub: ${resourceName}`);
          return null;
        }
        logger.warn(`Failed to fetch resource: ${response.status}`);
        return null;
      }

      return await response.text();
    } catch (error) {
      logger.error(`Error fetching resource from GitHub: ${resourceName}`, error);
      return null;
    }
  }

  /**
   * Fetch binary resource (e.g., images) from GitHub
   */
  private async fetchBinaryResourceFromGitHub(
    githubPath: string,
    resourceName: string
  ): Promise<ArrayBuffer | null> {
    const url = `${GITHUB_RAW_BASE_URL}/${githubPath}`;

    try {
      const response = await fetch(url);

      if (!response.ok) {
        if (response.status === 404) {
          logger.warn(`Resource not found on GitHub: ${resourceName}`);
          return null;
        }
        logger.warn(`Failed to fetch resource: ${response.status}`);
        return null;
      }

      return await response.arrayBuffer();
    } catch (error) {
      logger.error(`Error fetching resource from GitHub: ${resourceName}`, error);
      return null;
    }
  }

  /**
   * Get or create a resource file in the vault.
   * If the file doesn't exist, it will be fetched from GitHub.
   */
  private async getOrCreateResource(options: FetchResourceOptions): Promise<string | null> {
    const { type, name, destinationFolder, githubPath, extension = 'md' } = options;
    const resourcePath = this.getResourcePath(type, name, destinationFolder, extension);

    // Check if the resource already exists
    if (this.resourceExists(resourcePath)) {
      return resourcePath;
    }

    // Show notification that we're downloading
    new Notice(i18next.t('documentation.downloading', { name }));

    // Ensure the destination folder exists
    await this.plugin.obsidianAPITools.ensureFolderExists(destinationFolder);

    // Fetch from GitHub
    if (type === 'image') {
      const binaryContent = await this.fetchBinaryResourceFromGitHub(githubPath, name);
      if (!binaryContent) {
        return null;
      }

      // Create the binary file
      try {
        await this.plugin.app.vault.createBinary(resourcePath, binaryContent);
        logger.log(`Created resource file: ${resourcePath}`);
        return resourcePath;
      } catch (error) {
        logger.error(`Error creating resource file: ${resourcePath}`, error);
        return null;
      }
    } else {
      const content = await this.fetchResourceFromGitHub(githubPath, name);
      if (!content) {
        return null;
      }

      // Create the text file
      try {
        await this.plugin.app.vault.create(resourcePath, content);
        logger.log(`Created resource file: ${resourcePath}`);
        return resourcePath;
      } catch (error) {
        logger.error(`Error creating resource file: ${resourcePath}`, error);
        return null;
      }
    }
  }

  /**
   * Get or create a documentation file in the vault.
   * If the file doesn't exist, it will be fetched from GitHub.
   * @param docName The documentation file name (without .md extension)
   * @returns The path to the documentation file, or null if it couldn't be created
   */
  private async getOrCreateDoc(docName: string): Promise<string | null> {
    return this.getOrCreateResource({
      type: 'doc',
      name: docName,
      destinationFolder: this.getDocsFolderPath(),
      githubPath: `docs/${encodeURIComponent(docName)}.md`,
    });
  }

  /**
   * Get or create a community command file in the vault.
   * If the file doesn't exist, it will be fetched from GitHub.
   * @param commandName The command file name (without .md extension)
   * @returns The path to the command file, or null if it couldn't be created
   */
  private async getOrCreateCommand(commandName: string): Promise<string | null> {
    return this.getOrCreateResource({
      type: 'command',
      name: commandName,
      destinationFolder: this.getCommandsFolderPath(),
      githubPath: `community-UDCs/${encodeURIComponent(commandName)}.md`,
    });
  }

  /**
   * Get or create an image file in the vault.
   * If the file doesn't exist, it will be fetched from GitHub.
   * @param imageName The image file name (with extension)
   * @param githubPath The path to the image in the GitHub repo
   * @param destinationFolder The folder in the vault to store the image
   * @returns The path to the image file, or null if it couldn't be created
   */
  public async getOrCreateImage(
    imageName: string,
    githubPath: string,
    destinationFolder: string
  ): Promise<string | null> {
    const extension = imageName.split('.').pop() || 'png';
    const nameWithoutExt = imageName.replace(/\.[^/.]+$/, '');

    return this.getOrCreateResource({
      type: 'image',
      name: nameWithoutExt,
      destinationFolder,
      githubPath,
      extension,
    });
  }

  /**
   * Open a resource file, fetching it from GitHub if needed
   */
  private async openResource(resourcePath: string | null): Promise<boolean> {
    if (!resourcePath) {
      return false;
    }

    const file = this.plugin.app.vault.getFileByPath(resourcePath);

    if (!file) {
      return false;
    }

    // Open the file (Obsidian will handle navigation based on the current view)
    await this.plugin.app.workspace.getLeaf().openFile(file);
    return true;
  }

  /**
   * Open a documentation file, fetching it from GitHub if needed
   * @param docName The documentation file name (without .md extension)
   * @returns True if the file was opened successfully
   */
  public async openDoc(docName: string): Promise<boolean> {
    const docPath = await this.getOrCreateDoc(docName);
    return this.openResource(docPath);
  }

  /**
   * Open a community command file, fetching it from GitHub if needed
   * @param commandName The command file name (without .md extension)
   * @returns True if the file was opened successfully
   */
  public async openCommand(commandName: string): Promise<boolean> {
    const commandPath = await this.getOrCreateCommand(commandName);
    return this.openResource(commandPath);
  }

  /**
   * Generate a protocol link for a resource
   * This creates an obsidian:// URL that will trigger our protocol handler
   * @param type The resource type ('doc' or 'command')
   * @param name The resource name (without extension)
   * @param displayText The text to display for the link
   */
  public getResourceLink(type: ResourceType, name: string, displayText: string): string {
    const encodedName = encodeURIComponent(name);
    return `[${displayText}](obsidian://steward-resource?type=${type}&name=${encodedName})`;
  }

  /**
   * Generate a protocol link for a documentation file (backward compatibility)
   */
  public getDocLink(docName: string, displayText: string): string {
    return this.getResourceLink('doc', docName, displayText);
  }

  /**
   * Generate a protocol link for a command file
   */
  public getCommandLink(commandName: string, displayText: string): string {
    return this.getResourceLink('command', commandName, displayText);
  }
}
