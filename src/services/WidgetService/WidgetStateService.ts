import { normalizePath } from 'obsidian';
import type StewardPlugin from 'src/main';
import { logger } from 'src/utils/logger';
import { buildWidgetStateHead } from './WidgetBuild';
import {
  WIDGET_STATE_VERSION,
  widgetStateSchema,
  type WidgetSessionData,
  type WidgetState,
} from './types';

export { WIDGET_STATE_VERSION, widgetStateSchema, type WidgetState } from './types';

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

  /** Writes widget runtime data to state.json (creates or updates). Preserves prior session when omitted. */
  public async writeState(params: {
    projectPath: string;
    data: unknown;
    session?: WidgetSessionData;
  }): Promise<void> {
    let session = params.session;
    if (session === undefined) {
      const previous = await this.readState(params.projectPath);
      session = previous?.session;
    }

    const envelope = widgetStateSchema.parse({
      version: WIDGET_STATE_VERSION,
      updatedAt: new Date().toISOString(),
      data: params.data,
      ...(session !== undefined ? { session } : {}),
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

  /** Reads host-owned session from the state envelope sibling field. */
  public async readSession(projectPath: string): Promise<WidgetSessionData | null> {
    const state = await this.readState(projectPath);
    return state?.session ?? null;
  }

  /** Removes the session sibling from state.json; leaves `data` unchanged. */
  public async clearSession(projectPath: string): Promise<void> {
    const previous = await this.readState(projectPath);
    if (!previous) {
      return;
    }

    const envelope = widgetStateSchema.parse({
      version: WIDGET_STATE_VERSION,
      updatedAt: new Date().toISOString(),
      data: previous.data,
    });
    const statePath = this.getStatePath(projectPath);
    const content = JSON.stringify(envelope, null, 2);
    const stateFile = this.plugin.app.vault.getFileByPath(statePath);
    if (stateFile) {
      await this.plugin.app.vault.modify(stateFile, content);
    }
  }

  /** Updates only the session sibling without changing widget data. */
  public async writeSession(params: {
    projectPath: string;
    session: WidgetSessionData;
  }): Promise<void> {
    const previous = await this.readState(params.projectPath);
    const data = previous?.data ?? {};
    await this.writeState({
      projectPath: params.projectPath,
      data,
      session: params.session,
    });
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
