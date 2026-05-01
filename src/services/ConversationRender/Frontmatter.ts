import type { LanguageModelUsage } from 'ai';
import { parseYaml } from 'obsidian';
import { logger } from 'src/utils/logger';
import type { ConversationRenderer } from '../ConversationRenderer';

/**
 * Agent id segment for token usage. Frontmatter uses one top-level key per agent:
 * `usage_<segment>` (e.g. `usage_super`, `usage_title`). Each call overwrites that block with
 * the latest snapshot (see `recordTokenUsage`); some agents store both `usage` and `totalUsage`.
 */
export const USAGE_AGENT_KEY = {
  super: 'super',
  sub: 'sub',
  title: 'title',
  compaction: 'compaction',
} as const;

export type UsageAgentKey = (typeof USAGE_AGENT_KEY)[keyof typeof USAGE_AGENT_KEY];

/** Full frontmatter property name for an agent's usage block, e.g. `usage_super`. */
export function usageFrontmatterPropertyName(agent: string): string {
  return `usage_${agent}`;
}

type FrontmatterHost = Pick<ConversationRenderer, 'plugin' | 'getConversationFileByName'>;

type FrontmatterHostWithConversationProps = Pick<
  ConversationRenderer,
  'plugin' | 'getConversationFileByName' | 'getConversationProperty'
>;

/** Nested block under `usage_<agent>` when both last-step and cumulative usage are recorded (see recordTokenUsage). */
type AgentUsageFrontmatterBlock = {
  usage: LanguageModelUsage;
  totalUsage: LanguageModelUsage;
};

export class Frontmatter {
  /**
   * Writes token usage for this agent under `usage_<agent>` in the note frontmatter.
   * Values are stored as provided (last write wins; no running totals): full {@link LanguageModelUsage}
   * objects from the SDK.
   *
   * When both `usage` and `totalUsage` are set, stored shape is `{ usage, totalUsage }`. Otherwise the single
   * provided snapshot is stored at the top level.
   */
  public async recordTokenUsage(
    this: FrontmatterHost,
    conversationTitle: string,
    agent: string,
    usage: LanguageModelUsage | undefined,
    totalUsage?: LanguageModelUsage | undefined
  ): Promise<void> {
    if (!agent || !agent.trim()) {
      return;
    }
    if (!usage && !totalUsage) {
      return;
    }
    const propertyKey = usageFrontmatterPropertyName(agent);
    const stored =
      usage !== undefined && totalUsage !== undefined
        ? { usage, totalUsage }
        : (usage ?? totalUsage);
    try {
      const file = this.getConversationFileByName(conversationTitle);
      await this.plugin.app.fileManager.processFrontMatter(file, frontmatter => {
        frontmatter[propertyKey] = stored;
      });
    } catch (error) {
      logger.error('Error recording token usage in conversation frontmatter:', error);
    }
  }

  /**
   * Last-recorded prompt/input tokens for an agent from `usage_<agent>` (see recordTokenUsage).
   * Expects nested `{ usage, totalUsage }`; reads prompt size from `usage` (last LLM call), not `totalUsage`.
   */
  public async getRecordedInputTokensForAgent(
    this: FrontmatterHostWithConversationProps,
    conversationTitle: string,
    agent: string,
    forceRefresh?: boolean
  ): Promise<number | undefined> {
    if (!agent?.trim()) {
      return undefined;
    }
    const key = usageFrontmatterPropertyName(agent);
    const block = await this.getConversationProperty<AgentUsageFrontmatterBlock | undefined>(
      conversationTitle,
      key,
      forceRefresh
    );
    if (!block?.usage) {
      return undefined;
    }

    const raw = block.usage.inputTokens;
    if (typeof raw !== 'number' || !Number.isFinite(raw) || raw < 0) {
      return undefined;
    }
    return Math.floor(raw);
  }

  /**
   * Gets a property from the conversation's YAML frontmatter
   * Tries cache first, then reads directly from file if not found
   * @param conversationTitle The title of the conversation
   * @param property The property name to retrieve
   * @returns The property value or undefined if not found
   */
  public async getConversationProperty<T>(
    this: FrontmatterHost,
    conversationTitle: string,
    property: string,
    forceRefresh?: boolean
  ): Promise<T | undefined> {
    try {
      const file = this.getConversationFileByName(conversationTitle);

      const fileCache = this.plugin.app.metadataCache.getFileCache(file);

      if (fileCache?.frontmatter && !forceRefresh) {
        return fileCache.frontmatter[property];
      }

      if (forceRefresh) {
        logger.log(`Force refresh for property ${property}, reading directly from file`);
      } else {
        logger.log(`Cache miss for property ${property}, reading directly from file`);
      }
      const fileContent = await this.plugin.app.vault.read(file);
      const frontmatterRegex = /^---\n([\s\S]*?)\n---/;
      const match = fileContent.match(frontmatterRegex);

      if (match) {
        const frontmatter = parseYaml(match[1]) as Record<string, unknown>;
        return frontmatter[property] as T;
      }

      return undefined;
    } catch (error) {
      logger.error(`Error getting conversation property ${property}:`, error);
      return undefined;
    }
  }

  /**
   * Updates a property in the conversation's YAML frontmatter
   * @param conversationTitle The title of the conversation
   * @param properties The properties to update
   * @returns True if successful, false otherwise
   */
  public async updateConversationFrontmatter(
    this: FrontmatterHost,
    conversationTitle: string,
    properties: Array<{ name: string; value?: unknown; delete?: boolean }>
  ): Promise<boolean> {
    try {
      const file = this.getConversationFileByName(conversationTitle);

      await this.plugin.app.fileManager.processFrontMatter(file, frontmatter => {
        for (const prop of properties) {
          if (prop.delete) {
            delete frontmatter[prop.name];
            continue;
          }
          frontmatter[prop.name] = prop.value;
        }
      });

      return true;
    } catch (error) {
      logger.error(`Error updating conversation frontmatter:`, error);
      return false;
    }
  }
}
