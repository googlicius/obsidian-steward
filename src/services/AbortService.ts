import { logger } from '../utils/logger';

/**
 * Manages AbortControllers keyed by `(conversationTitle, operationKey)`.
 * Multiple concurrent operations may run per conversation.
 * Ctrl-C and the Stop tool use {@link abortConversation} for one note title.
 */
export class AbortService {
  private static instance: AbortService;
  /** conversationTitle → operationKey → controller */
  private readonly byConversation = new Map<string, Map<string, AbortController>>();
  /** Conversations where the user requested stop (Ctrl-C or stop command). */
  private readonly stopRequested = new Set<string>();

  private generateOperationId(): string {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
    return `op-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }

  private getInnerMap(conversationTitle: string): Map<string, AbortController> {
    let inner = this.byConversation.get(conversationTitle);
    if (!inner) {
      inner = new Map();
      this.byConversation.set(conversationTitle, inner);
    }
    return inner;
  }

  public static getInstance(): AbortService {
    if (!AbortService.instance) {
      AbortService.instance = new AbortService();
    }
    return AbortService.instance;
  }

  /**
   * Create a controller for `(conversationTitle, operationKey)`. If an entry already exists for
   * that pair, it is aborted first. Omit `operationKey` to allocate a random id (no replacement).
   */
  public createAbortController(conversationTitle: string, operationKey?: string): AbortSignal {
    const resolvedKey = operationKey ?? this.generateOperationId();
    const inner = this.getInnerMap(conversationTitle);

    if (inner.has(resolvedKey)) {
      this.abortOperation(conversationTitle, resolvedKey);
    }

    const controller = new AbortController();
    inner.set(resolvedKey, controller);
    return controller.signal;
  }

  /**
   * @param conversationTitle - When omitted, total count across all conversations.
   */
  public getActiveOperationsCount(conversationTitle?: string): number {
    if (conversationTitle !== undefined && conversationTitle !== '') {
      return this.byConversation.get(conversationTitle)?.size ?? 0;
    }

    let total = 0;
    for (const inner of this.byConversation.values()) {
      total += inner.size;
    }
    return total;
  }

  public getAbortSignal(conversationTitle: string, operationKey: string): AbortSignal | undefined {
    return this.byConversation.get(conversationTitle)?.get(operationKey)?.signal;
  }

  public isStopRequested(conversationTitle: string): boolean {
    return this.stopRequested.has(conversationTitle);
  }

  public clearStopRequest(conversationTitle: string): void {
    this.stopRequested.delete(conversationTitle);
  }

  /**
   * Remove a registered operation without aborting (normal completion).
   */
  public unregisterOperation(conversationTitle: string, operationKey: string): void {
    const inner = this.byConversation.get(conversationTitle);
    if (!inner) {
      return;
    }

    inner.delete(operationKey);
    if (inner.size === 0) {
      this.byConversation.delete(conversationTitle);
    }
  }

  /**
   * Abort one `(conversationTitle, operationKey)`. Removes the controller from the registry.
   */
  public abortOperation(conversationTitle: string, operationKey: string): boolean {
    const inner = this.byConversation.get(conversationTitle);
    const controller = inner?.get(operationKey);

    if (controller && inner) {
      try {
        controller.abort();
        inner.delete(operationKey);
        if (inner.size === 0) {
          this.byConversation.delete(conversationTitle);
        }
        logger.log(`Aborted operation: ${conversationTitle} / ${operationKey}`);
        return true;
      } catch (error) {
        logger.error(`Error aborting operation ${conversationTitle}/${operationKey}:`, error);
      }
    }

    return false;
  }

  /**
   * Abort every operation registered for this conversation note.
   * @returns Number of controllers that were aborted
   */
  public abortConversation(conversationTitle: string): number {
    this.stopRequested.add(conversationTitle);

    const inner = this.byConversation.get(conversationTitle);
    if (!inner || inner.size === 0) {
      return 0;
    }

    const keys = Array.from(inner.keys());
    let count = 0;
    for (const operationKey of keys) {
      if (this.abortOperation(conversationTitle, operationKey)) {
        count += 1;
      }
    }

    return count;
  }

  /** Abort every registered operation (e.g. test teardown). */
  public abortAllOperations(): void {
    const titles = Array.from(this.byConversation.keys());
    for (const conversationTitle of titles) {
      this.abortConversation(conversationTitle);
    }
    this.stopRequested.clear();
  }
}
