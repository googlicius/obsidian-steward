import { normalizePath, TFile } from 'obsidian';
import i18next from 'src/i18n';
import type StewardPlugin from 'src/main';
import { logger } from 'src/utils/logger';
import { z } from 'zod/v3';
import { Skill, SkillCatalogEntry } from './types';

const skillFrontmatterSchema = z.object({
  name: z.string().refine(s => s.trim().length > 0),
  description: z.string().refine(s => s.trim().length > 0),
  enabled: z.boolean().optional(),
});

/**
 * Service for loading, watching, and providing skills from the Steward/Skills folder.
 * Skills are markdown files with YAML frontmatter (name, description, optional enabled) and body content
 * that provides domain-specific knowledge to the LLM.
 */
export class SkillService {
  private static instance: SkillService | null = null;

  /** Map of skill name -> Skill (including enabled/disabled status) */
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
          if (!(file instanceof TFile) || !this.isSkillFile(file)) {
            return;
          }
          void this.onMarkdownUnderSkillsChanged(file);
        })
      );

      this.plugin.registerEvent(
        this.plugin.app.vault.on('rename', (file, oldPath) => {
          if (this.isSkillMarkdownPath(oldPath)) {
            this.removeSkillFromFile(oldPath);
          }
          if (file instanceof TFile && this.isSkillFile(file)) {
            void this.onMarkdownUnderSkillsChanged(file);
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
    return this.isSkillMarkdownPath(file.path);
  }

  private isSkillMarkdownPath(path: string): boolean {
    const normalizedPath = normalizePath(path);
    const prefix = `${normalizePath(this.skillsFolder)}/`;
    return normalizedPath.startsWith(prefix) && normalizedPath.endsWith('.md');
  }

  /** Agent-style skill entry: `SKILL.md` (case-insensitive) under Steward/Skills */
  private isSkillNoteFile(file: TFile): boolean {
    return file.extension === 'md' && file.basename.toLowerCase() === 'skill';
  }

  private async onMarkdownUnderSkillsChanged(file: TFile): Promise<void> {
    if (this.isSkillNoteFile(file)) {
      await this.ensureSkillNoteFrontmatter(file);
    }
    await this.loadSkillFromFile(file);
  }

  /**
   * Fill missing `name`, `description`, and `enabled` when a SKILL.md note is created or renamed to that name.
   */
  private async ensureSkillNoteFrontmatter(file: TFile): Promise<void> {
    try {
      const initialContent = await this.plugin.app.vault.cachedRead(file);
      const initialParsed =
        this.plugin.noteContentService.parseMarkdownFrontmatter(initialContent);
      await this.migrateLegacySkillDisabledFrontmatter(file, initialParsed.frontmatter);

      await this.plugin.app.fileManager.processFrontMatter(file, fm => {
        if (this.needsFrontmatterScalar(fm.name)) {
          fm.name = this.defaultSkillNameFromPath(file.path);
        }
        if (this.needsFrontmatterScalar(fm.description)) {
          fm.description = i18next.t('skills.scaffoldDefaultDescription');
        }
        if (!Object.prototype.hasOwnProperty.call(fm, 'enabled')) {
          fm.enabled = true;
        }
      });
    } catch (error) {
      logger.error(`Failed to scaffold SKILL note frontmatter for ${file.path}:`, error);
    }
  }

  private needsFrontmatterScalar(value: unknown): boolean {
    if (value === undefined || value === null) {
      return true;
    }
    if (typeof value === 'string' && value.trim() === '') {
      return true;
    }
    return false;
  }

  private defaultSkillNameFromPath(filePath: string): string {
    const normalized = normalizePath(filePath);
    const dir = normalized.substring(0, normalized.lastIndexOf('/'));
    const parentSegment = dir.substring(dir.lastIndexOf('/') + 1);
    if (parentSegment === '' || parentSegment === 'Skills') {
      return i18next.t('skills.scaffoldDefaultName');
    }
    return parentSegment;
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

      let content = await this.plugin.app.vault.cachedRead(file);
      let parsed = this.plugin.noteContentService.parseMarkdownFrontmatter(content);
      if (await this.migrateLegacySkillDisabledFrontmatter(file, parsed.frontmatter)) {
        content = await this.plugin.app.vault.cachedRead(file);
        parsed = this.plugin.noteContentService.parseMarkdownFrontmatter(content);
      }
      const frontmatter = parsed.frontmatter;
      const body = parsed.body;

      const fmParsed = skillFrontmatterSchema.safeParse(frontmatter);
      if (!fmParsed.success) {
        logger.warn(
          `Skill file ${file.path} has invalid frontmatter (${fmParsed.error.message}). Skipping.`
        );
        return;
      }

      const fm = fmParsed.data;
      const name = fm.name.trim();
      const description = fm.description.trim();
      const enabled = fm.enabled !== false;

      const skill: Skill = {
        name,
        description,
        content: body.trim(),
        filePath: file.path,
        enabled,
      };

      this.skills.set(skill.name, skill);
      if (!enabled) {
        logger.log(`Loaded skill: ${skill.name} from ${file.path} (disabled)`);
        return;
      }

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
   * Legacy: map YAML `disabled` onto `enabled` and drop `disabled`. Remove this and
   * {@link coerceLegacyDisabledBoolean} once users no longer use `disabled`.
   */
  private async migrateLegacySkillDisabledFrontmatter(
    file: TFile,
    frontmatter: Record<string, unknown>
  ): Promise<boolean> {
    if (!Object.prototype.hasOwnProperty.call(frontmatter, 'disabled')) {
      return false;
    }
    try {
      await this.plugin.app.fileManager.processFrontMatter(file, fm => {
        if (!Object.prototype.hasOwnProperty.call(fm, 'enabled')) {
          fm.enabled = !this.coerceLegacyDisabledBoolean(fm.disabled);
        }
        delete fm.disabled;
      });
      return true;
    } catch (error) {
      logger.error(`Failed to migrate legacy disabled frontmatter on ${file.path}:`, error);
      return false;
    }
  }

  /** Legacy helper for {@link migrateLegacySkillDisabledFrontmatter}; remove with it. */
  private coerceLegacyDisabledBoolean(value: unknown): boolean {
    if (value === true || value === 'true') {
      return true;
    }
    if (value === false || value === 'false') {
      return false;
    }
    return false;
  }

  /**
   * Get the skill catalog (name + description) for all loaded skills.
   * Used for the system prompt to show the LLM what skills are available.
   */
  public getSkillCatalog(): SkillCatalogEntry[] {
    const entries: SkillCatalogEntry[] = [];

    for (const skill of this.skills.values()) {
      if (!skill.enabled) {
        continue;
      }

      entries.push({
        name: skill.name,
        description: skill.description,
        path: skill.filePath,
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
      if (skill && skill.enabled) {
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
    for (const skill of this.skills.values()) {
      if (skill.enabled) {
        return true;
      }
    }
    return false;
  }

  /**
   * Get all loaded skill names
   */
  public getSkillNames(): string[] {
    const names: string[] = [];
    for (const [name, skill] of this.skills.entries()) {
      if (skill.enabled) {
        names.push(name);
      }
    }
    return names;
  }

  /**
   * Get all skills, including disabled ones
   */
  public getAllSkills(): Skill[] {
    return Array.from(this.skills.values());
  }
}
