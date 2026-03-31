import { TFile, TFolder } from 'obsidian';
import { parseYaml } from 'obsidian';
import type StewardPlugin from 'src/main';
import i18next from 'src/i18n';
import { logger } from 'src/utils/logger';
import { ToolName } from 'src/solutions/commands/ToolRegistry';
import type { GuardrailsAction, GuardrailsRule } from './types';
import {
  guardrailsRuleFrontmatterSchema,
  type GuardrailsRuleFrontmatterData,
  type ValidateRuleResult,
} from './schema';

const RULES_FOLDER_NAME = 'Rules';

const TOOL_TO_ACTIONS: Partial<Record<ToolName, GuardrailsAction[]>> = {
  [ToolName.CONTENT_READING]: ['read'],
  [ToolName.LIST]: ['list'],
  [ToolName.SEARCH]: ['list'],
  [ToolName.CREATE]: ['create'],
  [ToolName.DELETE]: ['delete'],
  [ToolName.GREP]: ['read'],
  [ToolName.EXISTS]: ['read', 'list'],
  [ToolName.EDIT]: ['edit'],
  [ToolName.MOVE]: ['move'],
  [ToolName.RENAME]: ['rename'],
  [ToolName.COPY]: ['copy'],
  [ToolName.UPDATE_FRONTMATTER]: ['edit'],
};

export class GuardrailsRuleService {
  private static instance: GuardrailsRuleService | null = null;

  private rules: GuardrailsRule[] = [];

  private constructor(private plugin: StewardPlugin) {
    this.initialize();
  }

  get rulesFolderPath(): string {
    return `${this.plugin.settings.stewardFolder}/${RULES_FOLDER_NAME}`;
  }

  public static getInstance(plugin?: StewardPlugin): GuardrailsRuleService {
    if (plugin) {
      GuardrailsRuleService.instance = new GuardrailsRuleService(plugin);
      return GuardrailsRuleService.instance;
    }

    if (!GuardrailsRuleService.instance) {
      throw new Error('GuardrailsRuleService must be initialized with a plugin');
    }

    return GuardrailsRuleService.instance;
  }

  private isInRulesFolder(path: string): boolean {
    const folder = this.rulesFolderPath;
    return path.startsWith(folder + '/') && !path.slice(folder.length + 1).includes('/');
  }

  private toGuardrailsRule(data: GuardrailsRuleFrontmatterData, path: string): GuardrailsRule {
    const enabled = data.enabled !== false && data.enabled !== 'false';
    return {
      name: data.name,
      path,
      targets: data.targets,
      actions: data.actions,
      instruction: data.instruction,
      enabled,
    };
  }

  private buildStatusMessage(valid: boolean, errors?: string[]): string {
    if (valid) {
      return i18next.t('common.statusValid');
    }
    const combinedErrors = (errors ?? []).join('; ');
    return i18next.t('common.statusInvalid', { errors: combinedErrors });
  }

  private validateRuleFrontmatter(raw: unknown): ValidateRuleResult {
    const result = guardrailsRuleFrontmatterSchema.safeParse(raw);

    if (result.success) {
      return { valid: true, data: result.data };
    }

    const errors: string[] = [];
    for (const issue of result.error.issues) {
      const path = issue.path.length > 0 ? `${issue.path.join('.')}: ` : '';
      errors.push(`${path}${issue.message}`);
    }
    return { valid: false, errors };
  }

  private initialize(): void {
    try {
      this.plugin.app.workspace.onLayoutReady(async () => {
        await this.loadRules();
      });

      this.plugin.registerEvent(
        this.plugin.app.vault.on('modify', file => {
          if (file instanceof TFile && this.isInRulesFolder(file.path)) {
            this.reloadRule(file);
          }
        })
      );

      this.plugin.registerEvent(
        this.plugin.app.vault.on('create', file => {
          if (file instanceof TFile && this.isInRulesFolder(file.path)) {
            this.reloadRule(file);
          }
        })
      );

      this.plugin.registerEvent(
        this.plugin.app.vault.on('delete', file => {
          if (file.path === this.rulesFolderPath) {
            this.loadRules();
          } else if (this.isInRulesFolder(file.path)) {
            this.removeRule(file.path);
          }
        })
      );

      this.plugin.registerEvent(
        this.plugin.app.metadataCache.on('changed', file => {
          if (file instanceof TFile && this.isInRulesFolder(file.path)) {
            this.reloadRule(file);
          }
        })
      );
    } catch (error) {
      logger.error('Error initializing GuardrailsRuleService:', error);
    }
  }

  private async processRuleFile(file: TFile): Promise<GuardrailsRule | null> {
    try {
      const fileCache = this.plugin.app.metadataCache.getFileCache(file);
      let frontmatter: Record<string, unknown> | null =
        (fileCache?.frontmatter as Record<string, unknown>) ?? null;

      if (!frontmatter) {
        const content = await this.plugin.app.vault.cachedRead(file);
        const match = content.match(/^---\s*\n([\s\S]*?)\n---/);
        if (match) {
          frontmatter = parseYaml(match[1]) as Record<string, unknown> | null;
        }
      }

      if (!frontmatter) return null;

      const validation = this.validateRuleFrontmatter(frontmatter);
      const newStatus = this.buildStatusMessage(
        validation.valid,
        validation.valid ? undefined : validation.errors
      );
      const currentStatus = frontmatter.status as string | undefined;

      if (currentStatus !== newStatus) {
        await this.plugin.app.fileManager.processFrontMatter(file, fm => {
          fm.status = newStatus;
        });
      }

      if (validation.valid) {
        return this.toGuardrailsRule(validation.data, file.path);
      }
      logger.warn(`Invalid guardrails rule ${file.path}:`, validation.errors);
      return null;
    } catch (fileError) {
      logger.warn(`Failed to parse rule file ${file.path}:`, fileError);
      return null;
    }
  }

  private async loadRules(): Promise<void> {
    try {
      const folder = this.plugin.app.vault.getAbstractFileByPath(this.rulesFolderPath);
      if (!(folder instanceof TFolder)) {
        this.rules = [];
        return;
      }

      const parsed: GuardrailsRule[] = [];
      for (const child of folder.children) {
        if (!(child instanceof TFile) || child.extension !== 'md') continue;

        const rule = await this.processRuleFile(child);
        if (rule) parsed.push(rule);
      }

      this.rules = parsed;
      logger.log(`Loaded ${this.rules.length} guardrails rules from ${this.rulesFolderPath}`);
    } catch (error) {
      logger.error('Error loading guardrails rules:', error);
      this.rules = [];
    }
  }

  private async reloadRule(file: TFile): Promise<void> {
    const rule = await this.processRuleFile(file);
    const existingIndex = this.rules.findIndex(r => r.path === file.path);

    if (existingIndex >= 0) {
      this.rules.splice(existingIndex, 1);
    }

    if (rule) {
      const insertIndex = existingIndex >= 0 ? existingIndex : this.rules.length;
      this.rules.splice(insertIndex, 0, rule);
    }
  }

  private removeRule(path: string): void {
    const index = this.rules.findIndex(r => r.path === path);
    if (index >= 0) {
      this.rules.splice(index, 1);
      logger.log(`Removed guardrails rule ${path}`);
    }
  }

  public getRules(): GuardrailsRule[] {
    return this.rules.filter(r => r.enabled !== false);
  }

  public getAllRules(): GuardrailsRule[] {
    return [...this.rules];
  }

  public getRulesForTool(toolName: ToolName): GuardrailsRule[] {
    const actions = TOOL_TO_ACTIONS[toolName];
    if (!actions) return [];

    const enabled = this.getRules();
    return enabled.filter(rule => actions.some(action => rule.actions.includes(action)));
  }

  public getInstructionsForTool(toolName: ToolName): string[] {
    const rules = this.getRulesForTool(toolName);
    const instructions: string[] = [];
    for (const rule of rules) {
      if (rule.instruction) instructions.push(rule.instruction);
    }
    return instructions;
  }

  public getInstructionsByTool(): Map<ToolName, string[]> {
    const map = new Map<ToolName, string[]>();
    const toolNames = Object.keys(TOOL_TO_ACTIONS) as ToolName[];
    for (const toolName of toolNames) {
      const instructions = this.getInstructionsForTool(toolName);
      if (instructions.length > 0) {
        map.set(toolName, instructions);
      }
    }
    return map;
  }
}
