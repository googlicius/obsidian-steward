import { normalizePath } from 'obsidian';
import { z } from 'zod/v3';
import type StewardPlugin from 'src/main';
import { logger } from 'src/utils/logger';
import { buildWidgetStateHead } from './WidgetBuild';

export const WIDGET_STATE_VERSION = 1;

/** Persisted widget runtime state envelope stored in state.json */
export const widgetStateSchema = z
  .object({
    version: z.literal(WIDGET_STATE_VERSION),
    updatedAt: z.string().min(1),
    data: z.unknown(),
  })
  .superRefine((value, ctx) => {
    if (!Object.prototype.hasOwnProperty.call(value, 'data') || value.data === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'data is required',
        path: ['data'],
      });
    }
  });

export type WidgetState = z.infer<typeof widgetStateSchema>;

type ParseWidgetStateResult =
  | { valid: true; data: WidgetState }
  | { valid: false; errors: string[] };

/**
 * Reads, validates, and writes widget runtime state in `state.json` per project folder.
 */
export class WidgetStateService {
  private static instance: WidgetStateService | null = null;

  private constructor(private readonly plugin: StewardPlugin) {}

  public static getInstance(plugin: StewardPlugin): WidgetStateService {
    if (!WidgetStateService.instance) {
      WidgetStateService.instance = new WidgetStateService(plugin);
    }
    return WidgetStateService.instance;
  }

  /** Vault path for persisted runtime state in a widget project. */
  public getStatePath(projectPath: string): string {
    return normalizePath(`${projectPath}/state.json`);
  }

  /** Returns extraHead script that injects persisted state and window.stw into the iframe. */
  public buildStateHead(state: WidgetState | null, assets?: Record<string, string>): string {
    return buildWidgetStateHead({ state, assets });
  }

  /** Reads and parses state.json from a project folder. */
  public async readState(projectPath: string): Promise<WidgetState | null> {
    const statePath = this.getStatePath(projectPath);
    const file = this.plugin.app.vault.getFileByPath(statePath);
    if (!file) {
      return null;
    }

    try {
      const raw = await this.plugin.app.vault.read(file);
      const parsed: unknown = JSON.parse(raw);
      const result = this.parseWidgetState(parsed);
      if (!result.valid) {
        logger.warn('Invalid widget state envelope:', statePath, result.errors);
        return null;
      }
      return result.data;
    } catch (error) {
      logger.error('Failed to read widget state:', error);
      return null;
    }
  }

  /** Writes widget runtime data to state.json (creates or updates). */
  public async writeState(params: { projectPath: string; data: unknown }): Promise<void> {
    const envelope = widgetStateSchema.parse({
      version: WIDGET_STATE_VERSION,
      updatedAt: new Date().toISOString(),
      data: params.data,
    });
    const statePath = this.getStatePath(params.projectPath);
    const content = JSON.stringify(envelope, null, 2);
    const stateFile = this.plugin.app.vault.getFileByPath(statePath);
    if (stateFile) {
      await this.plugin.app.vault.modify(stateFile, content);
      return;
    }

    await this.plugin.obsidianAPITools.ensureFolderExists(params.projectPath);
    await this.plugin.app.vault.create(statePath, content);
  }

  private parseWidgetState(data: unknown): ParseWidgetStateResult {
    const result = widgetStateSchema.safeParse(data);
    if (result.success) {
      return { valid: true, data: result.data };
    }

    const errors: string[] = [];
    for (let i = 0; i < result.error.issues.length; i++) {
      const issue = result.error.issues[i];
      const path = issue.path.length > 0 ? `${issue.path.join('.')}: ` : '';
      errors.push(`${path}${issue.message}`);
    }

    return { valid: false, errors };
  }
}
