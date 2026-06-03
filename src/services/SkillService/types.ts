import type { ToolName } from 'src/solutions/commands/toolNames';

/**
 * Represents a loaded skill with its metadata and content
 */
export interface Skill {
  /** Unique identifier for the skill (from frontmatter) */
  name: string;
  /** Description of the skill's purpose (from frontmatter) */
  description: string;
  /** The markdown body content (knowledge/instructions) */
  content: string;
  /** Source file path in the vault */
  filePath: string;
  /** Whether the skill is enabled */
  enabled: boolean;
  /** When set, listed in the catalog only while these tools are active in the conversation. */
  tools?: ToolName[];
}

/**
 * Skill catalog entry shown to the LLM in the system prompt.
 * Includes path so the LLM can use read_content to read the skill file.
 */
export interface SkillCatalogEntry {
  name: string;
  description: string;
  /** Vault path to the skill file (e.g. Steward/Skills/foo/SKILL.md) */
  path: string;
}
