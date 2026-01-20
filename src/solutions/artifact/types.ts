import { ContentReadingResult } from 'src/services/ContentReadingService';
import { IndexedDocument } from 'src/database/SearchDatabase';
import { ConditionResult } from 'src/solutions/search/searchEngineV3';
import { EditArgs } from '../commands/tools/editContent';

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
  DELETED_FILES = 'deleted_files',
  UPDATE_FRONTMATTER_RESULTS = 'update_frontmatter_results',
  RENAME_RESULTS = 'rename_results',
  LIST_RESULTS = 'list_results',
  STW_SELECTED = 'stw_selected',
  EDIT_RESULTS = 'edit_results',
}

export const revertAbleArtifactTypes = [
  ArtifactType.MOVE_RESULTS,
  ArtifactType.CREATED_NOTES,
  ArtifactType.DELETED_FILES,
  ArtifactType.UPDATE_FRONTMATTER_RESULTS,
  ArtifactType.RENAME_RESULTS,
  ArtifactType.EDIT_RESULTS,
];

/**
 * Base interface for all artifacts
 */
export interface BaseArtifact {
  artifactType: ArtifactType;
  createdAt?: number; // Timestamp when the artifact was created
  id?: string; // ID of the artifact (usually the message ID that created it)
  deleteReason?: string;
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
 * Read content artifact interface
 */
export interface ReadContentArtifact extends BaseArtifact {
  artifactType: ArtifactType.READ_CONTENT;
  readingResult: ContentReadingResult;
  imagePaths?: string[];
}

/**
 * Content update artifact
 */
export interface ContentUpdateArtifact extends BaseArtifact {
  artifactType: ArtifactType.CONTENT_UPDATE;
  path: string;
  updateExtraction: EditArgs;
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

export interface GeneratedContentArtifact extends BaseArtifact {
  artifactType: ArtifactType.GENERATED_CONTENT;
  content: string;
  messageId: string;
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

/**
 * Deleted files artifact
 * The artifact ID is used to reference deleted files in .trash-metadata.json
 */
export interface DeletedFilesArtifact extends BaseArtifact {
  artifactType: ArtifactType.DELETED_FILES;
  // The id field (from BaseArtifact) serves as the reference to deleted files in metadata
  fileCount: number; // Number of files deleted in this operation
}

/**
 * Move results artifact
 * Stores pairs of original paths and their moved paths
 */
export interface MoveResultsArtifact extends BaseArtifact {
  artifactType: ArtifactType.MOVE_RESULTS;
  moves: Array<[string, string]>; // Array of [originalPath, movedPath] pairs
}

/**
 * Update frontmatter results artifact
 * Stores paths with their original and updated frontmatter properties
 */
export interface UpdateFrontmatterResultsArtifact extends BaseArtifact {
  artifactType: ArtifactType.UPDATE_FRONTMATTER_RESULTS;
  updates: Array<{
    path: string;
    original: Record<string, unknown>; // Original frontmatter properties
    updated: Record<string, unknown>; // Updated frontmatter properties
  }>;
}

/**
 * Rename results artifact
 * Stores pairs of original paths and their renamed paths
 */
export interface RenameResultsArtifact extends BaseArtifact {
  artifactType: ArtifactType.RENAME_RESULTS;
  renames: Array<[string, string]>; // Array of [originalPath, renamedPath] pairs
}

/**
 * List results artifact
 * Stores the full list of file paths from a list operation
 */
export interface ListResultsArtifact extends BaseArtifact {
  artifactType: ArtifactType.LIST_RESULTS;
  paths: string[]; // Full list of file paths
}

/**
 * STW Selected artifact
 * Stores selected content blocks from the user's query in the format:
 * {{stw-selected from:<startLine>,to:<endLine>,selection:<selectionContent>,path:<notePath>}}
 */
export interface StwSelectedArtifact extends BaseArtifact {
  artifactType: ArtifactType.STW_SELECTED;
  selections: Array<{
    fromLine: number; // Starting line number (0-based)
    toLine: number; // Ending line number (0-based)
    selection: string; // The selected content
    path: string; // Path to the note file
  }>;
}

/**
 * Represents a single change made to content
 */
export interface Change {
  // Location info (for display ordering)
  startLine: number; // Starting line number (0-based) before the change
  endLine: number; // Ending line number (0-based) before the change

  // Content diff
  originalContent: string; // What was there before (empty for insert)
  newContent: string; // What it becomes (empty for delete)

  // Context for matching during revert (optional enhancement)
  contextBefore?: string; // 1-2 lines before change
  contextAfter?: string; // 1-2 lines after change

  // Operation metadata (for understanding what happened)
  mode: string; // EditMode as string
}

/**
 * Represents all changes made to a single file
 */
export interface FileChangeSet {
  path: string; // File path that was edited
  changes: Change[]; // Array of changes made to this file
}

/**
 * Edit results artifact
 * Stores changes made to files for preview and revert purposes
 */
export interface EditResultsArtifact extends BaseArtifact {
  artifactType: ArtifactType.EDIT_RESULTS;
  files: FileChangeSet[]; // Array of file change sets
}

export type Artifact =
  | SearchResultsArtifact
  | CreatedNotesArtifact
  | ReadContentArtifact
  | ContentUpdateArtifact
  | GeneratedContentArtifact
  | MediaResultsArtifact
  | ConversationSummaryArtifact
  | ExtractionResultArtifact
  | DeletedFilesArtifact
  | MoveResultsArtifact
  | UpdateFrontmatterResultsArtifact
  | RenameResultsArtifact
  | ListResultsArtifact
  | StwSelectedArtifact
  | EditResultsArtifact;

export type ArtifactMap = {
  [ArtifactType.SEARCH_RESULTS]: SearchResultsArtifact;
  [ArtifactType.CREATED_NOTES]: CreatedNotesArtifact;
  [ArtifactType.READ_CONTENT]: ReadContentArtifact;
  [ArtifactType.CONTENT_UPDATE]: ContentUpdateArtifact;
  [ArtifactType.GENERATED_CONTENT]: GeneratedContentArtifact;
  [ArtifactType.MEDIA_RESULTS]: MediaResultsArtifact;
  [ArtifactType.CONVERSATION_SUMMARY]: ConversationSummaryArtifact;
  [ArtifactType.EXTRACTION_RESULT]: ExtractionResultArtifact;
  [ArtifactType.DELETED_FILES]: DeletedFilesArtifact;
  [ArtifactType.MOVE_RESULTS]: MoveResultsArtifact;
  [ArtifactType.UPDATE_FRONTMATTER_RESULTS]: UpdateFrontmatterResultsArtifact;
  [ArtifactType.RENAME_RESULTS]: RenameResultsArtifact;
  [ArtifactType.LIST_RESULTS]: ListResultsArtifact;
  [ArtifactType.STW_SELECTED]: StwSelectedArtifact;
  [ArtifactType.EDIT_RESULTS]: EditResultsArtifact;
};

/**
 * Interface for artifact serializers
 */
export abstract class ArtifactSerializer {
  title?: string;

  injectTitle(title: string): this {
    this.title = title;
    return this;
  }

  /**
   * Serialize an artifact to a string wrapped in stw-artifact block
   * @param artifact The artifact to serialize
   * @returns The serialized artifact as a string wrapped in stw-artifact block
   */
  abstract serialize(artifact: unknown | string): string | unknown;

  /**
   * Deserialize a string to an artifact
   * @param data The string to deserialize (possibly containing a stw-artifact block)
   * @returns The deserialized artifact or a Promise that resolves to the artifact
   */
  abstract deserialize(data: string): Artifact | Promise<Artifact>;
}
