import { SystemPromptItem } from './SystemPromptModifier';
import { ToolName } from './ToolRegistry';
import { ToolCallPart } from './tools/types';

/**
 * Represents a single intent in a sequence
 */
export interface Intent {
  /** @deprecated As we use only one super agent, we don't need to distinguish between intents. */
  type: string;
  query: string;
  systemPrompts?: (string | SystemPromptItem)[];
  model?: string; // Optional model to use for this intent
  no_confirm?: boolean; // Skip confirmation for this intent
  tools?: {
    exclude?: ToolName[];
  };
}

export interface ContextAugmentationIntent extends Intent {
  type: 'context_augmentation';
  retryRemaining: number;
}

export enum IntentResultStatus {
  SUCCESS = 'success',
  ERROR = 'error',
  NEEDS_CONFIRMATION = 'needs_confirmation',
  NEEDS_USER_INPUT = 'needs_user_input',
  LOW_CONFIDENCE = 'low_confidence',
  STOP_PROCESSING = 'stop_processing',
}

type UserInputResult = {
  status: IntentResultStatus.NEEDS_USER_INPUT;
  onUserInput: (message: string) => Promise<AgentResult> | AgentResult;
};

type SuccessResult = {
  status: IntentResultStatus.SUCCESS;
  shouldContinue?: boolean;
  nextParams?: Partial<AgentHandlerParams>;
};

type StopProcessingResult = {
  status: IntentResultStatus.STOP_PROCESSING;
  reason?: string;
};

type ErrorResult = {
  status: IntentResultStatus.ERROR;
  error?: Error | string;
};

type LowConfidenceResult = {
  status: IntentResultStatus.LOW_CONFIDENCE;
  intentType: string;
  explanation?: string;
};

export type ConfirmationResult<T = unknown> = {
  status: IntentResultStatus.NEEDS_CONFIRMATION;
  confirmationMessage?: string;
  toolCall?: ToolCallPart<T>;
  onConfirmation: (message: string) => Promise<AgentResult> | AgentResult;
  onRejection?: (message: string) => Promise<AgentResult> | AgentResult;
  onFinal?: () => Promise<void> | void;
};

export type AgentResult =
  | ConfirmationResult
  | UserInputResult
  | SuccessResult
  | ErrorResult
  | LowConfidenceResult
  | StopProcessingResult;

export interface AgentHandlerParams<T extends Intent = Intent> {
  title: string;
  intent: T;
  lang?: string | null;
  /**
   * Handler ID to group all messages issued in one handle function call.
   * If not provided, a new ID will be generated.
   */
  handlerId?: string;
  /**
   * Count of how many times the handle function has been invoked.
   * When 0 or undefined, it's the first iteration and user messages should be included.
   */
  invocationCount?: number;
  upstreamOptions?: {
    isReloadRequest?: boolean;
    ignoreClassify?: boolean;
  };
  activeTools?: ToolName[];
}
