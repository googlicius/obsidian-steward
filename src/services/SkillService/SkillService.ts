import { TFile } from 'obsidian';
import type StewardPlugin from 'src/main';
import { logger } from 'src/utils/logger';
import { Skill, SkillCatalogEntry } from './types';

/**
 * Service for loading, watching, and providing skills from the Steward/Skills folder.
 * Skills are markdown files with YAML frontmatter (name, description) and body content
 * that provides domain-specific knowledge to the LLM.
 */
export class SkillService {
  private static instance: SkillService | null = null;

  /** Map of skill name -> Skill */
  public skills: Map<string, Skill> = new Map();

  private constructor(private plugin: StewardPlugin) {
    this.initialize();
  }

  get skillsFolder(): string {
    return `${this.plugin.settings.stewardFolder}/Skills`;
  }

  public static getInstance(plugin?: StewardPlugin): SkillService {
    if (plugin) {
      SkillService.instance = new SkillService(plugin);
      return SkillService.instance;
    }

    if (!SkillService.instance) {
      throw new Error('SkillService must be initialized with a plugin');
    }

    return SkillService.instance;
  }

  /**
   * Initialize the skill service: create folder, load skills, watch for changes
   */
  private initialize(): void {
    try {
      this.plugin.app.workspace.onLayoutReady(async () => {
        await this.loadAllSkills();
      });

      // Watch for file modifications
      this.plugin.registerEvent(
        this.plugin.app.vault.on('modify', file => {
          if (file instanceof TFile && this.isSkillFile(file)) {
            this.loadSkillFromFile(file);
          }
        })
      );

      // Watch for file creation
      this.plugin.registerEvent(
        this.plugin.app.vault.on('create', file => {
          if (file instanceof TFile && this.isSkillFile(file)) {
            this.loadSkillFromFile(file);
          }
        })
      );

      // Watch for file deletion
      this.plugin.registerEvent(
        this.plugin.app.vault.on('delete', file => {
          if (file instanceof TFile && this.isSkillFile(file)) {
            this.removeSkillFromFile(file.path);
          }
        })
      );
    } catch (error) {
      logger.error('Error initializing SkillService:', error);
    }
  }

  /**
   * Check if a file is a skill file (inside the Skills folder and is markdown)
   */
  private isSkillFile(file: TFile): boolean {
    return file.path.startsWith(this.skillsFolder) && file.extension === 'md';
  }

  /**
   * Load all skill files from the Skills folder recursively
   */
  private async loadAllSkills(): Promise<void> {
    const folder = this.plugin.app.vault.getFolderByPath(this.skillsFolder);

    if (!folder) {
      return;
    }

    this.skills.clear();

    const files = this.plugin.obsidianAPITools.getFilesFromFolder(folder);
    for (const file of files) {
      if (file.extension === 'md') {
        await this.loadSkillFromFile(file);
      }
    }

    logger.log(`Loaded ${this.skills.size} skills`);
  }

  /**
   * Load a single skill from a markdown file.
   * Extracts name and description from YAML frontmatter and the body as content.
   */
  private async loadSkillFromFile(file: TFile): Promise<void> {
    try {
      // Remove any existing skill from this file
      this.removeSkillFromFile(file.path);

      const content = await this.plugin.app.vault.cachedRead(file);
      const { frontmatter, body } = this.parseFrontmatter(content);

      if (!frontmatter.name || !frontmatter.description) {
        logger.warn(
          `Skill file ${file.path} is missing required frontmatter fields (name, description). Skipping.`
        );
        return;
      }

      const skill: Skill = {
        name: frontmatter.name,
        description: frontmatter.description,
        content: body.trim(),
        filePath: file.path,
      };

      this.skills.set(skill.name, skill);
      logger.log(`Loaded skill: ${skill.name} from ${file.path}`);
    } catch (error) {
      logger.error(`Error loading skill from file ${file.path}:`, error);
    }
  }

  /**
   * Remove a skill that was loaded from a specific file path
   */
  private removeSkillFromFile(filePath: string): void {
    for (const [name, skill] of this.skills.entries()) {
      if (skill.filePath === filePath) {
        this.skills.delete(name);
        logger.log(`Removed skill ${name} from ${filePath}`);
        return;
      }
    }
  }

  /**
   * Parse YAML frontmatter from markdown content.
   * Returns the frontmatter key-value pairs and the body content.
   */
  private parseFrontmatter(content: string): {
    frontmatter: Record<string, string>;
    body: string;
  } {
    const frontmatter: Record<string, string> = {};

    const match = content.match(/^---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/);
    if (!match) {
      return { frontmatter, body: content };
    }

    const yamlBlock = match[1];
    const body = match[2];

    // Simple YAML key-value parsing (supports single-line values only)
    for (const line of yamlBlock.split('\n')) {
      const colonIndex = line.indexOf(':');
      if (colonIndex === -1) continue;

      const key = line.substring(0, colonIndex).trim();
      const value = line.substring(colonIndex + 1).trim();

      if (key && value) {
        frontmatter[key] = value;
      }
    }

    return { frontmatter, body };
  }

  /**
   * Get the skill catalog (name + description) for all loaded skills.
   * Used for the system prompt to show the LLM what skills are available.
   */
  public getSkillCatalog(): SkillCatalogEntry[] {
    const entries: SkillCatalogEntry[] = [];

    for (const skill of this.skills.values()) {
      entries.push({
        name: skill.name,
        description: skill.description,
      });
    }

    return entries;
  }

  /**
   * Get the full content of one or more skills by name.
   * @param skillNames Array of skill names to retrieve
   * @returns Object with activated skill names and any invalid names
   */
  public getSkillContents(skillNames: string[]): {
    activatedSkills: string[];
    invalidSkills: string[];
    contents: Record<string, string>;
  } {
    const activatedSkills: string[] = [];
    const invalidSkills: string[] = [];
    const contents: Record<string, string> = {};

    for (const name of skillNames) {
      const skill = this.skills.get(name);
      if (skill) {
        activatedSkills.push(name);
        contents[name] = skill.content;
      } else {
        invalidSkills.push(name);
      }
    }

    return { activatedSkills, invalidSkills, contents };
  }

  /**
   * Check if any skills are loaded
   */
  public hasSkills(): boolean {
    return this.skills.size > 0;
  }

  /**
   * Get all loaded skill names
   */
  public getSkillNames(): string[] {
    return Array.from(this.skills.keys());
  }
}
