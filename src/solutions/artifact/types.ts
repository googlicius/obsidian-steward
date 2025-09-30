import { ContentReadingResult } from 'src/services/ContentReadingService';
import { IndexedDocument } from 'src/database/SearchDatabase';
import { ConditionResult } from 'src/solutions/search/searchEngineV3';
import { UpdateContentArgs } from 'src/solutions/commands/handlers/GenerateCommandHandler/zSchemas';

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
  GENERATED_CONTENT = 'generated_content',
  MEDIA_RESULTS = 'media_results',
  CONVERSATION_SUMMARY = 'conversation_summary',
  EXTRACTION_RESULT = 'extraction-result',
}

/**
 * Base interface for all artifacts
 */
export interface BaseArtifact {
  artifactType: ArtifactType;
  createdAt?: number; // Timestamp when the artifact was created
  id?: string; // ID of the artifact (usually the message ID that created it)
}

/**
 * Search results artifact
 */
export interface SearchResultsArtifact extends BaseArtifact {
  artifactType: ArtifactType.SEARCH_RESULTS;
  originalResults: ConditionResult<IndexedDocument>[]; // The original, unpaginated results
}

/**
 * Created notes artifact
 */
export interface CreatedNotesArtifact extends BaseArtifact {
  artifactType: ArtifactType.CREATED_NOTES;
  paths: string[];
}

/**
 * Read content artifact
 */
export interface ReadContentArtifact extends BaseArtifact {
  artifactType: ArtifactType.READ_CONTENT;
  readingResult: ContentReadingResult;
}

/**
 * Content update artifact
 */
export interface ContentUpdateArtifact extends BaseArtifact {
  artifactType: ArtifactType.CONTENT_UPDATE;
  path: string;
  updateExtraction: UpdateContentArgs;
}

/**
 * Media results artifact
 */
export interface MediaResultsArtifact extends BaseArtifact {
  artifactType: ArtifactType.MEDIA_RESULTS;
  paths: string[]; // Paths to the media files
  mediaType?: 'audio' | 'image'; // Type of media
}

/**
 * Conversation summary artifact
 */
export interface ConversationSummaryArtifact extends BaseArtifact {
  artifactType: ArtifactType.CONVERSATION_SUMMARY;
  summary: string; // The generated summary text
}

/**
 * Extraction result artifact
 */
export interface ExtractionResultArtifact extends BaseArtifact {
  artifactType: ArtifactType.EXTRACTION_RESULT;
  content: {
    query: string;
    commands: {
      commandType: string;
      query: string;
    }[];
  };
}

export type Artifact =
  | SearchResultsArtifact
  | CreatedNotesArtifact
  | ReadContentArtifact
  | ContentUpdateArtifact
  | MediaResultsArtifact
  | ConversationSummaryArtifact
  | ExtractionResultArtifact;

export type ArtifactMap = {
  [ArtifactType.SEARCH_RESULTS]: SearchResultsArtifact;
  [ArtifactType.CREATED_NOTES]: CreatedNotesArtifact;
  [ArtifactType.READ_CONTENT]: ReadContentArtifact;
  [ArtifactType.CONTENT_UPDATE]: ContentUpdateArtifact;
  [ArtifactType.MEDIA_RESULTS]: MediaResultsArtifact;
  [ArtifactType.CONVERSATION_SUMMARY]: ConversationSummaryArtifact;
  [ArtifactType.EXTRACTION_RESULT]: ExtractionResultArtifact;
};

/**
 * Interface for artifact serializers
 */
export interface ArtifactSerializer {
  /**
   * Serialize an artifact to a string wrapped in stw-artifact block
   * @param artifact The artifact to serialize
   * @returns The serialized artifact as a string wrapped in stw-artifact block
   */
  serialize(artifact: Artifact): string;

  /**
   * Deserialize a string to an artifact
   * @param data The string to deserialize (possibly containing a stw-artifact block)
   * @returns The deserialized artifact or a Promise that resolves to the artifact
   */
  deserialize(data: string): Artifact | Promise<Artifact>;
}
