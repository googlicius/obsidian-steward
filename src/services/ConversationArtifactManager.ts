import { ContentReadingResult } from './ContentReadingService';
import { ContentUpdateExtraction } from '../lib/modelfusion/extractions';
import { logger } from 'src/utils/logger';

/**
 * Types of artifacts that can be stored for conversations
 */
export enum ArtifactType {
  SEARCH_RESULTS = 'search_results',
  MOVE_RESULTS = 'move_results',
  CALCULATION_RESULTS = 'calculation_results',
  CREATED_NOTES = 'created_notes',
  READ_CONTENT = 'read_content',
  CONTENT_UPDATE = 'content_update',
  MEDIA_RESULTS = 'media_results',
}

/**
 * Base interface for all artifacts
 */
export interface BaseArtifact {
  type: ArtifactType;
  createdAt: number; // Timestamp when the artifact was created
  id: string; // ID of the artifact (usually the message ID that created it)
}

/**
 * Search results artifact
 */
export interface SearchResultsArtifact extends BaseArtifact {
  type: ArtifactType.SEARCH_RESULTS;
  originalResults: any[]; // The original, unpaginated results
}

/**
 * Created notes artifact
 */
export interface CreatedNotesArtifact extends BaseArtifact {
  type: ArtifactType.CREATED_NOTES;
  paths: string[];
}

/**
 * Read content artifact
 */
export interface ReadContentArtifact extends BaseArtifact {
  type: ArtifactType.READ_CONTENT;
  readingResult: ContentReadingResult;
}

/**
 * Content update artifact
 */
export interface ContentUpdateArtifact extends BaseArtifact {
  type: ArtifactType.CONTENT_UPDATE;
  path: string;
  updateExtraction: ContentUpdateExtraction;
}

/**
 * Media results artifact
 */
export interface MediaResultsArtifact extends BaseArtifact {
  type: ArtifactType.MEDIA_RESULTS;
  paths: string[]; // Paths to the media files
  mediaType?: 'audio' | 'image'; // Type of media
}

export type Artifact =
  | SearchResultsArtifact
  | CreatedNotesArtifact
  | ReadContentArtifact
  | ContentUpdateArtifact
  | MediaResultsArtifact;

type ArtifactMap = {
  [ArtifactType.SEARCH_RESULTS]: SearchResultsArtifact;
  [ArtifactType.CREATED_NOTES]: CreatedNotesArtifact;
  [ArtifactType.READ_CONTENT]: ReadContentArtifact;
  [ArtifactType.CONTENT_UPDATE]: ContentUpdateArtifact;
  [ArtifactType.MEDIA_RESULTS]: MediaResultsArtifact;
};

/**
 * Manages the storage and retrieval of conversation artifacts
 */
export class ConversationArtifactManager {
  private static instance: ConversationArtifactManager;
  private artifacts: Map<string, Map<string, Artifact>> = new Map();

  /**
   * Get the singleton instance
   */
  public static getInstance(): ConversationArtifactManager {
    if (!ConversationArtifactManager.instance) {
      ConversationArtifactManager.instance = new ConversationArtifactManager();
    }
    return ConversationArtifactManager.instance;
  }

  /**
   * Store an artifact for a conversation
   * @param conversationTitle The title of the conversation
   * @param artifactId The ID of the artifact (usually a message ID)
   * @param artifact The artifact to store
   */
  public storeArtifact(
    conversationTitle: string,
    artifactId: string,
    artifact: Partial<Artifact>
  ): void {
    if (!this.artifacts.has(conversationTitle)) {
      this.artifacts.set(conversationTitle, new Map());
    }

    // Ensure all artifacts have a createdAt timestamp
    if (!('createdAt' in artifact)) {
      artifact.createdAt = Date.now();
    }

    // Ensure all artifacts have an id
    if (!('id' in artifact)) {
      artifact.id = artifactId;
    }

    this.artifacts.get(conversationTitle)?.set(artifactId, artifact as Artifact);

    logger.log('Stored artifact in artifact manager', artifact);
  }

  /**
   * Get an artifact for a conversation
   * @param conversationTitle The title of the conversation
   * @param artifactId The ID of the artifact
   * @returns The artifact, or undefined if not found
   */
  public getArtifact(conversationTitle: string, artifactId: string): Artifact | undefined {
    return this.artifacts.get(conversationTitle)?.get(artifactId);
  }

  /**
   * Get the most recent artifact of a specific type for a conversation
   * @param conversationTitle The title of the conversation
   * @param type The type of artifact to get
   * @returns The most recent artifact, or undefined if none found
   */
  public getMostRecentArtifactByType<T extends keyof ArtifactMap>(
    conversationTitle: string,
    type: T
  ): ArtifactMap[T] | undefined {
    const conversationArtifacts = this.artifacts.get(conversationTitle);
    if (!conversationArtifacts) {
      return undefined;
    }

    // Find the most recent artifact of the specified type by timestamp
    let latestArtifact: Artifact | undefined;
    let latestTimestamp = 0;

    conversationArtifacts.forEach(artifact => {
      if (artifact.type === type) {
        const timestamp = artifact.createdAt || 0;
        if (!latestArtifact || timestamp > latestTimestamp) {
          latestArtifact = artifact;
          latestTimestamp = timestamp;
        }
      }
    });

    return latestArtifact as ArtifactMap[T];
  }

  /**
   * Get the most recent artifact of any type for a conversation
   * @param conversationTitle The title of the conversation
   * @returns The most recent artifact, or undefined if none found
   */
  public getMostRecentArtifact(conversationTitle: string): Artifact | undefined {
    const conversationArtifacts = this.artifacts.get(conversationTitle);
    if (!conversationArtifacts || conversationArtifacts.size === 0) {
      return undefined;
    }

    // Get all artifacts and find the most recent one by timestamp
    let latestArtifact: Artifact | undefined = undefined;
    let latestTimestamp = 0;

    conversationArtifacts.forEach((artifact, id) => {
      const timestamp = artifact.createdAt || 0;
      if (!latestArtifact || timestamp > latestTimestamp) {
        latestArtifact = artifact;
        latestTimestamp = timestamp;
      }
    });

    return latestArtifact;
  }

  /**
   * Get the ID of the most recent artifact for a conversation
   * @param conversationTitle The title of the conversation
   * @returns The ID of the most recent artifact, or undefined if none found
   */
  public getMostRecentArtifactId(conversationTitle: string): string | undefined {
    const conversationArtifacts = this.artifacts.get(conversationTitle);
    if (!conversationArtifacts || conversationArtifacts.size === 0) {
      return undefined;
    }

    let latestId = '';
    let latestTimestamp = 0;

    conversationArtifacts.forEach((artifact, id) => {
      const timestamp = artifact.createdAt || 0;
      if (!latestId || timestamp > latestTimestamp) {
        latestId = id;
        latestTimestamp = timestamp;
      }
    });

    return latestId;
  }

  /**
   * Get the ID of the most recent artifact of a specific type for a conversation
   * @param conversationTitle The title of the conversation
   * @param type The type of artifact to get
   * @returns The ID of the most recent artifact, or undefined if none found
   */
  public getMostRecentArtifactIdByType(
    conversationTitle: string,
    type: ArtifactType
  ): string | undefined {
    const conversationArtifacts = this.artifacts.get(conversationTitle);
    if (!conversationArtifacts || conversationArtifacts.size === 0) {
      return undefined;
    }

    let latestId = '';
    let latestTimestamp = 0;

    conversationArtifacts.forEach((artifact, id) => {
      if (artifact.type === type) {
        const timestamp = artifact.createdAt || 0;
        if (!latestId || timestamp > latestTimestamp) {
          latestId = id;
          latestTimestamp = timestamp;
        }
      }
    });

    return latestId;
  }

  /**
   * Delete an artifact for a conversation
   * @param conversationTitle The title of the conversation
   * @param messageId The ID of the artifact to delete
   * @returns True if the artifact was deleted, false otherwise
   */
  public deleteArtifact(conversationTitle: string, messageId: string): boolean {
    const conversationArtifacts = this.artifacts.get(conversationTitle);
    return conversationArtifacts ? conversationArtifacts?.delete(messageId) : true;
  }

  /**
   * Clear artifacts for a conversation
   * @param conversationTitle The title of the conversation
   */
  public clearArtifacts(conversationTitle: string): void {
    this.artifacts.delete(conversationTitle);
  }
}
