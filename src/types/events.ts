import { CommandIntent, ContextAugmentationIntent } from './types';
import { IndexedDocument } from '../database/SearchDatabase';
import { SearchQueryExtractionV2 } from 'src/solutions/commands/handlers/SearchCommandHandler/zSchemas';

export enum Events {
  CONVERSATION_NOTE_CREATED = 'conversation-note-created',
  CONVERSATION_COMMAND_RECEIVED = 'conversation-command-received',
  CONVERSATION_LINK_INSERTED = 'conversation-link-inserted',
  LLM_RESPONSE_RECEIVED = 'LLM_RESPONSE_RECEIVED',
  RESPONSE_READY_TO_INSERT = 'RESPONSE_READY_TO_INSERT',
  MOVE_QUERY_EXTRACTED = 'move-query-extracted',
  MOVE_FROM_ARTIFACT_CONFIRMED = 'move-from-artifact-confirmed',
  DELETE_OPERATION_CONFIRMED = 'delete-operation-confirmed',
  COPY_OPERATION_CONFIRMED = 'copy-operation-confirmed',
  MOVE_OPERATION_COMPLETED = 'move-operation-completed',
  DELETE_OPERATION_COMPLETED = 'delete-operation-completed',
  COPY_OPERATION_COMPLETED = 'copy-operation-completed',
  CONFIRMATION_REQUESTED = 'confirmation-requested',
  CONFIRMATION_RESPONDED = 'confirmation-responded',
  // Git related events
  GIT_OPERATION_PERFORMED = 'GIT_OPERATION_PERFORMED',
  GIT_OPERATION_REVERTED = 'GIT_OPERATION_REVERTED',
  // Media generation events
  MEDIA_GENERATION_STARTED = 'media-generation-started',
  MEDIA_GENERATION_COMPLETED = 'media-generation-completed',
  MEDIA_GENERATION_FAILED = 'media-generation-failed',
  UPDATE_OPERATION_COMPLETED = 'update_operation_completed',
}

export enum ErrorEvents {
  MATH_PROCESSING_ERROR = 'MATH_PROCESSING_ERROR',
  LLM_ERROR = 'LLM_ERROR',
  GIT_ERROR = 'GIT_ERROR',
}

export interface ConversationCommandReceivedPayload {
  title: string;
  commands: (CommandIntent | ContextAugmentationIntent)[];
  /**
   * The original query that was received from the user
   */
  originalQuery?: string;
  lang?: string | null;
}

export interface ConversationLinkInsertedPayload {
  title: string;
  commandType: string;
  commandQuery: string;
  lang?: string;
}

export interface ResponseReadyPayload {
  notePath: string;
  content: string;
  position: number;
}

export interface ErrorPayload {
  notePath: string;
  error: Error;
  position: number;
}

export interface MoveFromArtifactConfirmedPayload {
  title: string;
  destinationFolder: string;
  docs: IndexedDocument[];
  explanation: string;
}

export interface ConfirmationRequestPayload {
  id: string;
  conversationTitle: string;
  message: string;
  type: string;
  context: any;
}

export interface ConfirmationResponsePayload {
  id: string;
  confirmed: boolean;
  conversationTitle: string;
  context?: any; // Additional context data, such as language preference
}

export interface GitOperationRevertedPayload {
  commitHash: string;
  success: boolean;
}

export interface MoveOperationCompletedPayload {
  title: string;
  operations: Array<{
    sourceQuery: string;
    destinationFolder: string;
    moved: string[];
    errors: string[];
    skipped: string[];
  }>;
}

export interface DeleteOperationConfirmedPayload {
  title: string;
  queryExtraction: SearchQueryExtractionV2;
  docs: IndexedDocument[];
}

export interface CopyOperationConfirmedPayload {
  title: string;
  queryExtraction: SearchQueryExtractionV2;
  docs: IndexedDocument[];
}

export interface CopyOperationCompletedPayload {
  title: string;
  operations: Array<{
    sourceQuery: string;
    destinationFolder: string;
    copied: string[];
    errors: string[];
    skipped: string[];
  }>;
}

export interface DeleteOperationCompletedPayload {
  title: string;
  operations: Array<{
    sourceQuery: string;
    deleted: string[];
    errors: string[];
  }>;
}

export interface MediaGenerationStartedPayload {
  type: 'image' | 'audio';
  prompt: string;
}

export interface MediaGenerationCompletedPayload {
  type: 'image' | 'audio';
  filePath: string;
  metadata: {
    model?: string;
    prompt: string;
    timestamp: number;
    voice?: string;
  };
}

export interface MediaGenerationFailedPayload {
  type: 'image' | 'audio';
  error: string;
}

export interface UpdateOperationCompletedPayload {
  title: string;
  operations: Array<{
    updateInstruction: string;
    updated: string[];
    skipped: string[];
    errors: string[];
  }>;
}

export type EventPayloadMap = {
  [Events.CONVERSATION_COMMAND_RECEIVED]: ConversationCommandReceivedPayload;
  [Events.LLM_RESPONSE_RECEIVED]: ResponseReadyPayload;
  [Events.RESPONSE_READY_TO_INSERT]: ResponseReadyPayload;
  [Events.CONVERSATION_LINK_INSERTED]: ConversationLinkInsertedPayload;
  [Events.CONFIRMATION_REQUESTED]: ConfirmationRequestPayload;
  [Events.CONFIRMATION_RESPONDED]: ConfirmationResponsePayload;
  [Events.MOVE_FROM_ARTIFACT_CONFIRMED]: MoveFromArtifactConfirmedPayload;
  [Events.GIT_OPERATION_REVERTED]: GitOperationRevertedPayload;
  [Events.MOVE_OPERATION_COMPLETED]: MoveOperationCompletedPayload;
  [ErrorEvents.MATH_PROCESSING_ERROR]: ErrorPayload;
  [ErrorEvents.LLM_ERROR]: ErrorPayload;
  [Events.DELETE_OPERATION_CONFIRMED]: DeleteOperationConfirmedPayload;
  [Events.COPY_OPERATION_CONFIRMED]: CopyOperationConfirmedPayload;
  [Events.DELETE_OPERATION_COMPLETED]: DeleteOperationCompletedPayload;
  [Events.COPY_OPERATION_COMPLETED]: CopyOperationCompletedPayload;
  [Events.MEDIA_GENERATION_STARTED]: MediaGenerationStartedPayload;
  [Events.MEDIA_GENERATION_COMPLETED]: MediaGenerationCompletedPayload;
  [Events.MEDIA_GENERATION_FAILED]: MediaGenerationFailedPayload;
  [Events.UPDATE_OPERATION_COMPLETED]: UpdateOperationCompletedPayload;
};
