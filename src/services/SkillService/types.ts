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
}

/**
 * Skill catalog entry shown to the LLM in the system prompt
 */
export interface SkillCatalogEntry {
  name: string;
  description: string;
}
