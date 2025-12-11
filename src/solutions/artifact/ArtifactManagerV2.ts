import { TFile } from 'obsidian';
import { logger } from 'src/utils/logger';
import type StewardPlugin from 'src/main';
import {
  Artifact,
  ArtifactMap,
  ArtifactSerializer,
  ArtifactType,
} from 'src/solutions/artifact/types';
import { JsonArtifactSerializer, SearchResultSerializer, CompositeSerializer } from './serializers';
import { GeneratedContentSerializer } from './serializers/GeneratedContentSerializer';
import { DocWithPath } from 'src/types/types';

/**
 * Manager for storing and retrieving artifacts in conversation notes
 */
export class ArtifactManagerV2 {
  private static instance: ArtifactManagerV2;
  private static withTitleInstances: Map<string, ArtifactManagerV2> = new Map();
  // Flag to track if the modify event listener has been registered
  private static modifyListenerRegistered = false;
  private conversationTitle = '';
  private serializers: Map<ArtifactType, ArtifactSerializer> = new Map();

  // In-memory cache of artifacts for the current conversation
  private artifactsCache: Artifact[] | null = null;

  get documentStore() {
    return this.plugin.searchService.documentStore;
  }

  private constructor(private plugin: StewardPlugin) {}

  /**
   * Register the modify event listener for all instances
   * to update the cache if there is mismatch between the cache and the conversation note
   */
  private static registerModifyListener(plugin: StewardPlugin): void {
    if (ArtifactManagerV2.modifyListenerRegistered) {
      return;
    }

    plugin.registerEvent(
      plugin.app.vault.on('modify', async (file: TFile) => {
        const title = plugin.conversationRenderer.extractTitleFromPath(file.path);

        // Get the instance directly by title
        const manager = ArtifactManagerV2.withTitleInstances.get(title);

        // If we have a manager for this title and it has a cache, check if we need to refresh
        if (manager && manager.artifactsCache && manager.artifactsCache.length > 0) {
          const lastItem = manager.artifactsCache[manager.artifactsCache.length - 1];
          if (lastItem && lastItem.id) {
            const fileContent = await plugin.app.vault.cachedRead(file);
            if (!fileContent.includes(lastItem.id)) {
              logger.log(
                `Last item in cache for "${title}" does not exist in conversation note, refreshing cache`
              );
              manager.getAllArtifacts(true);
            }
          }
        }
      })
    );

    ArtifactManagerV2.modifyListenerRegistered = true;
    logger.log('Registered modify event listener for ArtifactManagerV2');
  }

  /**
   * Get the singleton instance
   */
  public static getInstance(plugin?: StewardPlugin): ArtifactManagerV2 {
    if (plugin) {
      ArtifactManagerV2.instance = new ArtifactManagerV2(plugin);
      ArtifactManagerV2.instance.registerDefaultSerializers();
    }

    if (!ArtifactManagerV2.instance) {
      throw new Error('ArtifactManagerV2 is not initialized');
    }

    return ArtifactManagerV2.instance;
  }

  /**
   * Create a new instance or get the existing instance with the specified conversation title
   */
  public withTitle(conversationTitle: string): ArtifactManagerV2 {
    // Return existing instance if available
    if (ArtifactManagerV2.withTitleInstances.has(conversationTitle)) {
      return ArtifactManagerV2.withTitleInstances.get(conversationTitle) as ArtifactManagerV2;
    }

    // Create a new instance
    const manager = new ArtifactManagerV2(this.plugin);
    manager.conversationTitle = conversationTitle;
    manager.artifactsCache = null;

    // Register the instance in the static registry
    ArtifactManagerV2.withTitleInstances.set(conversationTitle, manager);

    // Ensure the modify event listener is registered
    ArtifactManagerV2.registerModifyListener(this.plugin);

    return manager;
  }

  /**
   * Register a custom serializer for an artifact type
   */
  public registerSerializer(type: ArtifactType, serializer: ArtifactSerializer): void {
    this.serializers.set(type, serializer);
  }

  /**
   * Register default serializers
   */
  private registerDefaultSerializers(): void {
    const jsonSerializer = new JsonArtifactSerializer();

    for (const type of Object.values(ArtifactType)) {
      switch (type) {
        case ArtifactType.SEARCH_RESULTS: {
          const searchResultSerializer = new SearchResultSerializer(this.documentStore);

          this.registerSerializer(
            type,
            new CompositeSerializer(searchResultSerializer, jsonSerializer)
          );
          break;
        }
        case ArtifactType.GENERATED_CONTENT: {
          const generatedContentSerializer = new GeneratedContentSerializer(
            (conversationTitle: string, messageId: string) => {
              return this.plugin.conversationRenderer.getMessageById(conversationTitle, messageId);
            }
          );
          this.registerSerializer(type, generatedContentSerializer);
          break;
        }
        default: {
          this.registerSerializer(type, jsonSerializer);
          break;
        }
      }
    }
  }

  /**
   * Get the serializer for a specific artifact type
   */
  private getSerializer(type: ArtifactType): ArtifactSerializer {
    const serializer = ArtifactManagerV2.instance.serializers.get(type);
    if (!serializer) {
      throw new Error(`No serializer registered for artifact type: ${type}`);
    }
    return serializer;
  }

  /**
   * Get the path to the conversation note
   */
  private getNotePath(): string {
    if (!this.conversationTitle) {
      throw new Error('Conversation title is not set. Use withTitle() first.');
    }
    return `${this.plugin.settings.stewardFolder}/Conversations/${this.conversationTitle}.md`;
  }

  /**
   * Get the file for the conversation note
   */
  private async getFile(): Promise<TFile> {
    const notePath = this.getNotePath();
    const file = this.plugin.app.vault.getFileByPath(notePath);

    if (!file) {
      throw new Error(`Note not found: ${notePath}`);
    }

    return file;
  }

  /**
   * Store an artifact in a conversation note
   */
  public async storeArtifact(params: {
    text?: string;
    artifact: Artifact;
  }): Promise<string | undefined> {
    try {
      if (!this.conversationTitle) {
        throw new Error('Conversation title is not set. Use withTitle() first.');
      }

      const file = await this.getFile();

      // Get the serializer for this artifact type
      const serializer = this.getSerializer(params.artifact.artifactType);

      // Build message metadata
      const { messageId, comment } = await this.plugin.conversationRenderer.buildMessageMetadata(
        this.conversationTitle,
        {
          type: 'artifact',
          role: 'assistant',
          artifactType: params.artifact.artifactType,
          includeHistory: false,
        }
      );

      if (!params.artifact.id) {
        params.artifact.id = messageId;
      }

      // Process the file content
      await this.plugin.app.vault.process(file, currentContent => {
        // Remove any generating indicator
        currentContent = this.plugin.conversationRenderer.removeGeneratingIndicator(currentContent);

        let contentToAdd = params.text ? `${params.text}\n` : '';

        contentToAdd += serializer.serialize(params.artifact);

        // Return the updated content
        return `${currentContent}\n\n${comment}\n${contentToAdd}`;
      });

      // Add to the in-memory cache
      await this.addToCache(params.artifact);

      logger.log('Stored artifact in conversation note', params.artifact);
      return messageId;
    } catch (error) {
      logger.error('Error storing artifact:', error);
      return undefined;
    }
  }

  /**
   * Add an artifact to the in-memory cache
   */
  private async addToCache(artifact: Artifact): Promise<void> {
    if (!this.artifactsCache) {
      this.artifactsCache = await this.getAllArtifacts(true);
    }
    this.artifactsCache.push(artifact);
  }

  /**
   * Extract all artifacts from a conversation note
   * @param refresh Force a refresh of the cache
   */
  public async getAllArtifacts(refresh = false): Promise<Artifact[]> {
    try {
      if (!this.conversationTitle) {
        throw new Error('Conversation title is not set. Use withTitle() first.');
      }

      // Check if we have a cached version and refresh is not requested
      if (!refresh && this.artifactsCache !== null) {
        return this.artifactsCache;
      }

      // Get all messages from the conversation
      const messages = await this.plugin.conversationRenderer.extractAllConversationMessages(
        this.conversationTitle
      );

      // Filter messages with type 'artifact'
      const artifactMessages = messages.filter(message => message.type === 'artifact');

      if (artifactMessages.length === 0) {
        this.artifactsCache = null;
        return [];
      }

      const artifacts: Artifact[] = [];

      for (const message of artifactMessages) {
        if (!message.artifactType) {
          continue;
        }
        try {
          const serializer = this.getSerializer(message.artifactType as ArtifactType);
          const result = await serializer
            .injectTitle(this.conversationTitle)
            .deserialize(message.content);
          if (!result.id && message.id) {
            result.id = message.id;
          }
          artifacts.push(result);
        } catch (error) {
          logger.error(`Error deserializing artifact of type ${message.artifactType}:`, error);
        }
      }

      // Cache the results
      this.artifactsCache = artifacts;

      return artifacts;
    } catch (error) {
      logger.error('Error getting artifacts:', error);
      return [];
    }
  }

  /**
   * Get an artifact by its ID
   */
  public async getArtifactById(artifactId: string): Promise<Artifact | undefined> {
    // Get all artifacts from cache or load them if not available
    const artifacts = await this.getAllArtifacts();
    return artifacts.find(artifact => artifact.id === artifactId);
  }

  /**
   * Get the most recent artifact of a specific type
   */
  public async getMostRecentArtifactByType<T extends keyof ArtifactMap>(
    type: T
  ): Promise<ArtifactMap[T] | undefined> {
    // Get all artifacts from cache or load them if not available
    const artifacts = await this.getAllArtifacts();

    // Filter artifacts by type
    const typeArtifacts = artifacts.filter(artifact => artifact.artifactType === type);

    if (typeArtifacts.length === 0) {
      return undefined;
    }

    // Return the last artifact (most recently added)
    return typeArtifacts[typeArtifacts.length - 1] as ArtifactMap[T];
  }

  /**
   * Get the most recent artifact of specified types
   */
  public async getMostRecentArtifactOfTypes(types: ArtifactType[]): Promise<Artifact | undefined> {
    const artifacts = await this.getAllArtifacts();

    // Filter artifacts by the specified types
    const filteredArtifacts = artifacts.filter(artifact => types.includes(artifact.artifactType));

    if (filteredArtifacts.length === 0) {
      return undefined;
    }

    return filteredArtifacts[filteredArtifacts.length - 1];
  }

  /**
   * Clear the in-memory cache
   */
  public clearCache(): void {
    this.artifactsCache = null;
    logger.log('Artifact cache cleared');
  }

  /**
   * Remove an artifact from both the conversation note and in-memory cache
   * Finds the line containing the artifactId, then removes the entire message block
   * (from the STW comment block to the next STW comment block)
   * If deleteReason is provided, the artifact is marked as deleted instead of being removed
   * @param artifactId The ID of the artifact to remove
   * @param deleteReason Optional reason for deletion. If provided, artifact is marked as deleted with {id, deleteReason}
   * @returns true if the artifact was successfully removed or marked as deleted, false otherwise
   */
  public async removeArtifact(artifactId: string, deleteReason?: string): Promise<boolean> {
    try {
      if (!this.conversationTitle) {
        throw new Error('Conversation title is not set. Use withTitle() first.');
      }

      const file = await this.getFile();
      const content = await this.plugin.app.vault.cachedRead(file);
      const lines = content.split('\n');

      let startLineIndex = -1;

      // Find the line index that contains the artifactId
      let artifactLineIndex = -1;
      for (let i = 0; i < lines.length; i += 1) {
        const isIDInMessage = lines[i].includes(`"id":"${artifactId}"`);
        const isIDInComment = lines[i].includes(`ID:${artifactId}`);
        if (isIDInMessage || isIDInComment) {
          artifactLineIndex = i;
          if (isIDInComment) {
            startLineIndex = i;
          }
          break;
        }
      }

      if (artifactLineIndex === -1) {
        logger.warn(`Artifact with ID "${artifactId}" not found in conversation note`);
        return false;
      }

      const stwCommentRegex = /<!--STW ID:[^>]*-->/i;
      // Traverse up to find the STW comment block that starts this message
      if (startLineIndex === -1) {
        for (let i = artifactLineIndex; i >= 0; i -= 1) {
          if (stwCommentRegex.test(lines[i])) {
            startLineIndex = i;
            break;
          }
        }
      }

      if (startLineIndex === -1) {
        logger.warn(
          `Could not find STW comment block before artifact "${artifactId}" in conversation note`
        );
        return false;
      }

      // Traverse down to find the next STW comment block (or end of file)
      let endLineIndex = lines.length;
      for (let i = artifactLineIndex + 1; i < lines.length; i += 1) {
        if (stwCommentRegex.test(lines[i])) {
          endLineIndex = i;
          break;
        }
      }

      // Get the original artifact to determine its type before deletion
      const originalArtifact = await this.getArtifactById(artifactId);

      const deletedArtifact = deleteReason
        ? {
            ...originalArtifact,
            deleteReason,
          }
        : undefined;

      // Prepare new lines if marking as deleted, otherwise undefined for removal
      const newArtifactLines = deletedArtifact
        ? [
            lines[startLineIndex], // Keep the STW comment
            '```stw-artifact',
            JSON.stringify(deletedArtifact),
            '```',
            '',
          ]
        : undefined;

      // Replace the old lines with new lines (if provided) or remove them
      const newLines = [...lines];
      if (newArtifactLines) {
        newLines.splice(startLineIndex, endLineIndex - startLineIndex, ...newArtifactLines);
      } else {
        newLines.splice(startLineIndex, endLineIndex - startLineIndex);
      }

      // Write the updated content back to the file
      const updatedContent = newLines.join('\n');
      await this.plugin.app.vault.modify(file, updatedContent);

      // Update in-memory cache
      if (this.artifactsCache) {
        const index = this.artifactsCache.findIndex(artifact => artifact.id === artifactId);
        if (index !== -1) {
          if (deletedArtifact) {
            // Replace with deleted artifact structure
            this.artifactsCache[index] = deletedArtifact as Artifact;
          } else {
            // Remove from cache
            this.artifactsCache.splice(index, 1);
            // If cache is now empty, set it to null
            if (this.artifactsCache.length === 0) {
              this.artifactsCache = null;
            }
          }
        }
      }

      logger.log(
        deleteReason
          ? `Marked artifact "${artifactId}" as deleted with reason: ${deleteReason}`
          : `Removed artifact "${artifactId}" from conversation note and cache`
      );
      return true;
    } catch (error) {
      logger.error(`Error removing artifact "${artifactId}":`, error);
      return false;
    }
  }

  /**
   * Resolve files from an artifact
   * Supported artifact types: SEARCH_RESULTS, CREATED_NOTES, READ_CONTENT, LIST_RESULTS
   * @param artifactId The ID of the artifact to resolve files from
   * @returns Array of DocWithPath objects containing file paths
   */
  public async resolveFilesFromArtifact(artifactId: string): Promise<DocWithPath[]> {
    const artifact = await this.getArtifactById(artifactId);

    if (!artifact) {
      logger.warn(`Artifact not found: ${artifactId}`);
      return [];
    }

    const resolvedFiles: DocWithPath[] = [];

    switch (artifact.artifactType) {
      case ArtifactType.SEARCH_RESULTS: {
        for (const result of artifact.originalResults) {
          if (result.document) {
            resolvedFiles.push({ path: result.document.path });
          } else {
            logger.warn(`Search result document not found.`);
          }
        }
        break;
      }

      case ArtifactType.CREATED_NOTES: {
        for (const path of artifact.paths) {
          resolvedFiles.push({ path });
        }
        break;
      }

      case ArtifactType.READ_CONTENT: {
        const file = artifact.readingResult.file;
        if (file) {
          resolvedFiles.push({ path: file.path });
        }
        break;
      }

      case ArtifactType.LIST_RESULTS: {
        for (const path of artifact.paths) {
          resolvedFiles.push({ path });
        }
        break;
      }

      default: {
        logger.warn(
          `Unsupported artifact type for resolving files: ${artifact.artifactType}. Supported types: search_results, created_notes, read_content, list_results`
        );
        return [];
      }
    }

    return resolvedFiles;
  }
}
