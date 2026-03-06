import type { ToolRegistry } from '../../ToolRegistry';

/**
 * Context for building the SuperAgent core system prompt (tools enabled).
 */
export interface SuperAgentCorePromptContext {
  readonly registry: ToolRegistry<unknown>;
  readonly currentNote: string | null;
  readonly currentPosition: number | null;
  readonly todoListPrompt: string;
  readonly skillCatalogPrompt: string;
}

/**
 * Builds system prompts for agents.
 * Each agent (SuperAgent, Search, Speech, etc.) can have its own implementation.
 */
export interface SystemPromptBuilder {
  /**
   * Build the core system prompt when tools are enabled.
   */
  buildCorePrompt(context: SuperAgentCorePromptContext): string;

  /**
   * Build the system prompt when tools are disabled (e.g. switch-to-agent mode).
   */
  buildDisabledToolsPrompt(): string;
}
