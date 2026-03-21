import type { ConversationIntentReceivedPayload } from '../../types/events';
import type { AgentResult } from './types';

export interface ProcessIntentsOptions {
  /** @deprecated */
  skipIndicators?: boolean;
  sendToDownstream?: {
    isReloadRequest?: boolean;
    ignoreClassify?: boolean;
  };
}

/**
 * Common interface for intent processors (CommandProcessor, AgentRunner).
 * Supports config-driven agent architectures and backward compatibility.
 */
export interface IntentProcessor {
  getLastResult(title: string): AgentResult | undefined;
  setLastResult(title: string, result: AgentResult): void;
  clearLastResult(title: string): void;
  processIntents(
    payload: ConversationIntentReceivedPayload,
    options?: ProcessIntentsOptions
  ): Promise<void>;
  processCommandInIsolation(
    payload: ConversationIntentReceivedPayload,
    intentType: string,
    options?: ProcessIntentsOptions
  ): Promise<void>;
  isProcessing(title: string): boolean;
  deleteNextPendingIntent(title: string): void;
  hasBuiltInHandler(commandType: string): boolean;
  clearIntents(title: string): void;
  getPendingIntent?(title: string): unknown;
  setCurrentIndex?(title: string, index: number): void;
}
