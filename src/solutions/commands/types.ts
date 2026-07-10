import { ToolName } from './ToolRegistry';
import { ToolCallPart } from './tools/types';

/** Optional markdown section merged into the agent core system prompt for this turn. */
export interface ExtraCorePromptSection {
  heading: string;
  body: string;
}

/**
 * Represents a single intent in a sequence
 */
export interface Intent {
  type: string;
  query: string;
  systemPrompts?: string[];
  /** When set, replaces the agent core prompt entirely (e.g. widget actor turns). */
  coreSystemPrompt?: string;
  /** Extra sections appended to the agent core prompt (heading + body). */
  extraCorePromptSections?: ExtraCorePromptSection[];
  model?: string; // Optional model to use for this intent
  /** Ordered model list for sub-agent capability switching and fallback. */
  models?: string[];
  no_confirm?: boolean; // Skip confirmation for this intent
  /** When set, limits which Super Agent tools are available (UDC / narrow mode). Omit = full tool set. */
  tools?: ToolName[];
  /** When set, limits how many trailing conversation messages are replayed as model history. */
  maxHistoryMessages?: number;
}

export interface ContextAugmentationIntent extends Intent {
  type: 'context_augmentation';
  retryRemaining: number;
}

export enum IntentResultStatus {
  SUCCESS = 'success',
  ERROR = 'error',
  NEEDS_CONFIRMATION = 'needs_confirmation',
  LOW_CONFIDENCE = 'low_confidence',
  STOP_PROCESSING = 'stop_processing',
  /** Tool handler finished setup; SuperAgent should continue with `nextParams` (e.g. after UDC expansion). */
  CONTINUE_WITH_INTENT = 'continue_with_intent',
}

type SuccessResult = {
  status: IntentResultStatus.SUCCESS;
  shouldContinue?: boolean;
  nextParams?: Partial<AgentHandlerParams>;
};

export type ContinueWithIntentResult = {
  status: IntentResultStatus.CONTINUE_WITH_INTENT;
  nextParams: Partial<AgentHandlerParams>;
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
  /** Resolved labels for the note markers; omit for default Yes / No. */
  buttonLabels?: {
    confirm?: string;
    reject?: string;
  };
  toolCall?: ToolCallPart<T>;
  /** Set after the first btw side question serializes a deferred tool result. */
  deferred?: boolean;
  onConfirmation: (message: string) => Promise<AgentResult> | AgentResult;
  onRejection?: (message: string) => Promise<AgentResult> | AgentResult;
  onFinal?: () => Promise<void> | void;
};

export type AgentResult =
  | ConfirmationResult
  | SuccessResult
  | ContinueWithIntentResult
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
    invocationCount?: number;
    handlerId?: string;
  };
  activeTools?: ToolName[];
  inactiveTools?: ToolName[]; // When provided, the tool set is activeTools + inactiveTools.
}
