import { ContextAugmentationIntent, Intent } from 'src/solutions/commands/types';

export enum Events {
  CONVERSATION_INTENT_RECEIVED = 'conversation-intent-received',
  CONVERSATION_LINK_INSERTED = 'conversation-link-inserted',
  CONVERSATION_INDICATOR_CHANGED = 'conversation-indicator-changed',
  MOVE_OPERATION_COMPLETED = 'move-operation-completed',
  COPY_OPERATION_COMPLETED = 'copy-operation-completed',
  MODEL_CHANGED = 'model_changed',
}

export interface ConversationIntentReceivedPayload {
  title: string;
  intents: (Intent | ContextAugmentationIntent)[];
  /**
   * The original query that was received from the user
   */
  originalQuery?: string;
  lang?: string | null;
}

export interface ConversationLinkInsertedPayload {
  title: string;
  intentType: string;
  intentQuery: string;
  lang?: string;
}

export interface MoveOperationCompletedPayload {
  title: string;
  operations: Array<{
    destinationFolder: string;
    moved: string[];
    errors: string[];
    skipped: string[];
  }>;
}

export interface CopyOperationCompletedPayload {
  title: string;
  operations: Array<{
    destinationFolder: string;
    copied: string[];
    errors: string[];
    skipped: string[];
  }>;
}

export interface ConversationIndicatorChangedPayload {
  /** Conversation note path (e.g. "Steward/Conversations/Title.md") */
  conversationPath: string;
  /** Whether the indicator should be visible */
  active: boolean;
  /** Indicator text (e.g. "Planning...") */
  indicatorText?: string;
}

export interface ModelChangedPayload {
  modelId: string;
}

export type EventPayloadMap = {
  [Events.CONVERSATION_INTENT_RECEIVED]: ConversationIntentReceivedPayload;
  [Events.CONVERSATION_LINK_INSERTED]: ConversationLinkInsertedPayload;
  [Events.CONVERSATION_INDICATOR_CHANGED]: ConversationIndicatorChangedPayload;
  [Events.MOVE_OPERATION_COMPLETED]: MoveOperationCompletedPayload;
  [Events.COPY_OPERATION_COMPLETED]: CopyOperationCompletedPayload;
  [Events.MODEL_CHANGED]: ModelChangedPayload;
};
