import type { App } from 'obsidian';
import type StewardPlugin from 'src/main';
import type { ConversationRenderer } from 'src/services/ConversationRenderer';
import type { ObsidianAPITools } from 'src/tools/obsidianAPITools';
import type { CommandProcessor } from '../CommandProcessor';
import type { ToolCallPart, ToolResultPart } from '../tools/types';

/**
 * Context interface for agent tool handlers.
 * Provides the minimal dependencies handlers need without coupling to concrete agent implementations.
 * Supports config-driven and alternative agent architectures.
 */
export interface AgentHandlerContext {
  readonly renderer: ConversationRenderer;
  readonly plugin: StewardPlugin;
  readonly obsidianAPITools: ObsidianAPITools;
  readonly app: App;
  readonly commandProcessor: CommandProcessor;

  /**
   * Serialize a tool invocation result to the conversation note.
   */
  serializeInvocation<T>(params: {
    title: string;
    handlerId: string;
    command: string;
    toolCall: ToolCallPart<T>;
    result: ToolResultPart['output'];
    step?: number;
  }): Promise<void>;

  /**
   * Delete a temporary streaming file. Used by handlers that stream tool content (e.g. create, edit).
   */
  deleteTempStreamFile(filePath: string): Promise<void>;
}
