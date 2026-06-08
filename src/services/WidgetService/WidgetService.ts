import { TAbstractFile, TFile, normalizePath } from 'obsidian';
import { z } from 'zod/v3';
import type StewardPlugin from 'src/main';
import { logger } from 'src/utils/logger';
import { isPathUnderPrefix } from 'src/utils/pathUtils';
import { uniqueID } from 'src/utils/uniqueID';
import { WidgetBundler } from './WidgetBundler';
import { WidgetDefinitionService } from './WidgetDefinitionService';
import { WidgetStateService } from './WidgetStateService';
import type { WidgetJsValidationError } from './WidgetJsValidator';
import { WidgetJsValidator } from './WidgetJsValidator';
import { WIDGET_ACTION_APPLY_TIMEOUT_MS } from './WidgetProtocol';
import { WidgetAsset, type WidgetAssetReadResponse } from './WidgetAsset';
import {
  type WidgetActionParamSpec,
  type WidgetActionResult,
  type WidgetActionsCatalog,
  type WidgetProjectBundle,
  WidgetProjectFenceData,
} from './types';
import { stringifyYamlFence } from '../MarkdownDefinitionService';
import { buildWidgetSrcdoc } from './WidgetBuild';
import { getBundledInternal } from 'src/utils/bundledInternals';

const { getTranslation } = getBundledInternal('i18n');

export type WidgetRefreshNotifyKind = 'newTab' | 'artifact';

/** Markdown fence language for project widget references in conversation notes */
export const WIDGET_PROJECT_FENCE_LANGUAGE = 'stw-widget-project';

/** File extension for saved widget artifacts under `{stewardFolder}/Artifacts`. */
export const ARTIFACT_FILE_EXTENSION = 'art';

export interface MountedWidgetHandle {
  projectPath: string;
  refresh: () => Promise<void>;
}

export interface WidgetActionBridgeHandle {
  projectPath: string;
  sendApplyAction: (payload: {
    action: string;
    params: Record<string, unknown>;
    requestId: string;
  }) => void;
}

interface MountedWidgetEntry {
  container: HTMLElement;
  refresh: () => Promise<void>;
}

interface WidgetActionBridgeEntry {
  sendApplyAction: WidgetActionBridgeHandle['sendApplyAction'];
  registeredActions: string[];
}

interface PendingActionRequest {
  resolve: (result: WidgetActionResult) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

/**
 * Manages multi-file widget projects in the vault: create, list, bundle, and hot-reload on edit.
 */
export class WidgetService {
  private static instance: WidgetService;
  private readonly bundler: WidgetBundler;
  public readonly jsValidator: WidgetJsValidator;
  private readonly mountedByPath = new Map<string, Set<MountedWidgetEntry>>();
  private readonly actionBridgeEntriesByPath = new Map<string, Set<WidgetActionBridgeEntry>>();
  private readonly pendingActionRequests = new Map<string, PendingActionRequest>();
  private modifyListenerRegistered = false;
  private readonly _definitionService: WidgetDefinitionService;
  private readonly _stateService: WidgetStateService;
  private readonly _assets: WidgetAsset;

  private constructor(private readonly plugin: StewardPlugin) {
    this.bundler = new WidgetBundler(plugin);
    this.jsValidator = new WidgetJsValidator();
    this._assets = new WidgetAsset(plugin);
    this._definitionService = WidgetDefinitionService.getInstance(plugin);
    this._definitionService.initialize();
    this._stateService = WidgetStateService.getInstance(plugin);
  }

  /** Widget.md definition read, validate, and frontmatter logic. */
  public get definitionService(): WidgetDefinitionService {
    return this._definitionService;
  }

  /** Widget runtime state in state.json per project folder. */
  public get stateService(): WidgetStateService {
    return this._stateService;
  }

  /** Vault asset size limits and blob URL resolution. */
  public get assets(): WidgetAsset {
    return this._assets;
  }

  /** Returns the singleton service bound to the plugin instance. */
  public static getInstance(plugin: StewardPlugin): WidgetService {
    if (!WidgetService.instance) {
      WidgetService.instance = new WidgetService(plugin);
    }
    return WidgetService.instance;
  }

  /** Root folder for all widget projects: `{stewardFolder}/Widgets`. */
  public getWidgetsRootPath(): string {
    return normalizePath(`${this.plugin.settings.stewardFolder}/Widgets`);
  }

  /** Absolute vault path for one widget project: `{widgetsRoot}/{widgetId}`. */
  public getProjectPath(params: { widgetId: string }): string {
    return normalizePath(`${this.getWidgetsRootPath()}/${params.widgetId}`);
  }

  /** Sanitizes a widget display name for use as a vault note filename (without extension). */
  private sanitizeWidgetViewFileName(widgetName: string): string {
    return widgetName.trim().replace(/[\\/:*?"<>|]/g, '');
  }

  /** Vault path for the generated widget reading note: `{projectPath}/{widgetName}.md`. */
  public getProjectViewPath(params: { widgetId: string; widgetName: string }): string {
    const fileBaseName = this.sanitizeWidgetViewFileName(params.widgetName) || params.widgetId;
    return normalizePath(
      `${this.getProjectPath({ widgetId: params.widgetId })}/${fileBaseName}.md`
    );
  }

  /** Markdown body for a widget reading note or artifact (frontmatter + optional notify callout + project fence). */
  private buildProjectViewContent(params: {
    widgetId: string;
    widgetName: string;
    lang?: string | null;
    refreshNotifyKind: WidgetRefreshNotifyKind;
    /** When set, fence uses generated.html and the refresh notify callout may be included. */
    generatedFile?: string | null;
  }): string {
    const frontmatter = [
      '---',
      `widgetName: ${this.formatYamlQuotedString(params.widgetName)}`,
      '---',
    ].join('\n');
    const fenceLines = [`widgetId: ${params.widgetId}`];
    if (params.lang) {
      fenceLines.push(`lang: ${params.lang}`);
    }
    if (params.generatedFile) {
      fenceLines.push(`generatedFile: ${params.generatedFile}`);
    }
    const fence = `\`\`\`${WIDGET_PROJECT_FENCE_LANGUAGE}\n${fenceLines.join('\n')}\n\`\`\``;

    const bodyParts: string[] = [];
    if (params.generatedFile && !this.plugin.settings.dismissWidgetRefreshNotify) {
      bodyParts.push(
        this.buildWidgetRefreshNotifyCallout({
          lang: params.lang,
          kind: params.refreshNotifyKind,
        })
      );
    }
    bodyParts.push(fence);

    return `${frontmatter}\n\n${bodyParts.join('\n')}`;
  }

  /**
   * Creates or updates the generated widget reading note and returns its vault path.
   */
  public async ensureProjectView(params: {
    widgetId: string;
    lang?: string | null;
  }): Promise<string> {
    const projectPath = this.getProjectPath({ widgetId: params.widgetId });
    await this.writeGeneratedHtml(projectPath);

    const def = await this.definitionService.getWidgetDefinition(projectPath);
    const widgetName = def.manifest?.widgetName?.trim() || params.widgetId;
    const viewPath = this.getProjectViewPath({
      widgetId: params.widgetId,
      widgetName,
    });
    const content = this.buildProjectViewContent({
      widgetId: params.widgetId,
      widgetName,
      lang: params.lang,
      refreshNotifyKind: 'newTab',
    });

    const existing = this.plugin.app.vault.getFileByPath(viewPath);
    if (existing) {
      await this.plugin.app.vault.modify(existing, content);
      return viewPath;
    }

    await this.plugin.obsidianAPITools.ensureFolderExists(projectPath);
    await this.plugin.app.vault.create(viewPath, content);
    return viewPath;
  }

  /** Root folder for saved widget artifacts: `{stewardFolder}/Artifacts`. */
  private getArtifactsRootPath(): string {
    return normalizePath(`${this.plugin.settings.stewardFolder}/Artifacts`);
  }

  /** Whether a vault path is a widget artifact note (`.art` under the artifacts root). */
  public isArtifactPath(path: string): boolean {
    const normalized = normalizePath(path);
    const root = this.getArtifactsRootPath();
    return normalized.startsWith(`${root}/`) && normalized.endsWith(`.${ARTIFACT_FILE_EXTENSION}`);
  }

  /** Vault path for a widget artifact: `{artifactsRoot}/{widgetName}.art`. */
  public getWidgetArtifactPath(params: { widgetName: string }): string {
    const fileBaseName = this.sanitizeWidgetViewFileName(params.widgetName) || 'Widget';
    return normalizePath(
      `${this.getArtifactsRootPath()}/${fileBaseName}.${ARTIFACT_FILE_EXTENSION}`
    );
  }

  /** Ensures the artifacts folder exists. */
  public async ensureArtifactsFolder(): Promise<void> {
    await this.plugin.obsidianAPITools.ensureFolderExists(this.getArtifactsRootPath());
  }

  /**
   * Creates or updates a widget artifact note and returns its vault path.
   * Reuses the same file when it already references the same widgetId; otherwise appends a suffix.
   */
  public async saveWidgetArtifact(params: {
    widgetId: string;
    widgetName: string;
    lang?: string | null;
  }): Promise<string> {
    await this.ensureArtifactsFolder();

    const projectPath = this.getProjectPath({ widgetId: params.widgetId });
    await this.writeGeneratedHtml(projectPath);

    const filePath = await this.resolveWidgetArtifactPath({
      widgetId: params.widgetId,
      widgetName: params.widgetName,
    });
    const content = this.buildProjectViewContent({
      widgetId: params.widgetId,
      widgetName: params.widgetName,
      lang: params.lang,
      refreshNotifyKind: 'artifact',
    });

    const existing = this.plugin.app.vault.getFileByPath(filePath);
    if (existing) {
      await this.plugin.app.vault.modify(existing, content);
      return filePath;
    }

    await this.plugin.app.vault.create(filePath, content);
    return filePath;
  }

  /** Whether a vault path is under the widget projects root. */
  private isWidgetProjectPath(path: string): boolean {
    const normalized = normalizePath(path);
    const root = this.getWidgetsRootPath();
    return normalized === root || normalized.startsWith(`${root}/`);
  }

  /** Replaces whitespace with dashes for use in widget folder names. */
  public slugifyWidgetName(name: string): string {
    return name
      .trim()
      .replace(/\s+/g, '-')
      .replace(/[\\/:*?"<>|]/g, '');
  }

  /** Builds widgetId as slugified name plus a short unique suffix. */
  public buildWidgetId(widgetName: string): string {
    const slug = this.slugifyWidgetName(widgetName);
    if (!slug) {
      throw new Error('Widget name must not be empty');
    }
    return `${slug}${uniqueID()}`;
  }

  /** Builds the markdown fence block that references a project in the conversation note. */
  public buildProjectFence(data: {
    widgetId: string;
    widgetName: string;
    lang?: string | null;
  }): string {
    const projectPath = this.getProjectPath({ widgetId: data.widgetId });
    const body = this.formatProjectFenceBody({ widgetId: data.widgetId, lang: data.lang });
    return `\`\`\`${WIDGET_PROJECT_FENCE_LANGUAGE}\n${body}\n\`\`\`\n<small>*ID: ${data.widgetId} - Definition: [[${projectPath}/Widget.md|${data.widgetName}]]*</small>`;
  }

  /** Serializes stw-widget-project fence body (widgetId, lang, …). */
  public formatProjectFenceBody(params: { widgetId: string; lang?: string | null }): string {
    const lines = [`widgetId: ${params.widgetId}`];
    if (params.lang) {
      lines.push(`lang: ${params.lang}`);
    }
    return lines.join('\n');
  }

  /** Hint callout for dedicated / artifact views until dismissed globally. */
  private buildWidgetRefreshNotifyCallout(params: {
    lang?: string | null;
    kind: WidgetRefreshNotifyKind;
  }): string {
    const t = getTranslation(params.lang);
    const actionKey = params.kind === 'artifact' ? 'common.saveAsArtifact' : 'common.openInNewTab';
    const messageKey =
      params.kind === 'artifact' ? 'widget.artifactRefreshNotify' : 'widget.newTabRefreshNotify';
    const message = t(messageKey, { action: t(actionKey) });
    const dismiss = t('common.dismiss');
    const neverAskAgain = t('common.neverAskAgain');
    const buttons = [
      `<button type="button" class="stw-callout-action" data-action="close">${dismiss}</button>`,
      `<button type="button" class="stw-callout-action" data-action="never-ask-again">${neverAskAgain}</button>`,
    ].join(' ');
    return this.plugin.noteContentService.formatCallout(`${message}\n${buttons}`, 'stw-notify', {
      lang: params.lang ?? '',
    });
  }

  /** Vault path for host-generated bundled HTML: `{projectPath}/generated.html`. */
  private getGeneratedHtmlPath(projectPath: string): string {
    return normalizePath(`${projectPath}/generated.html`);
  }

  /** Whether the path is the host-generated bundle file for a widget project. */
  private isGeneratedHtmlPath(filePath: string): boolean {
    const normalized = normalizePath(filePath);
    return normalized.endsWith('/generated.html');
  }

  /**
   * Bundles the project and writes a self-contained HTML file for standalone iframe `src` loading.
   * Includes current persisted state at write time.
   */
  private async writeGeneratedHtml(projectPath: string): Promise<string> {
    const bundled = await this.bundleProject(projectPath);
    const state = await this.stateService.readState(projectPath);
    const { srcdoc } = buildWidgetSrcdoc({
      type: 'html',
      code: bundled.html,
      extraHead: this.stateService.buildStateHead(state, bundled.assets),
    });

    const outputPath = this.getGeneratedHtmlPath(projectPath);
    const existing = this.plugin.app.vault.getFileByPath(outputPath);
    if (existing) {
      await this.plugin.app.vault.modify(existing, srcdoc);
      return outputPath;
    }

    await this.plugin.obsidianAPITools.ensureFolderExists(projectPath);
    await this.plugin.app.vault.create(outputPath, srcdoc);
    return outputPath;
  }

  /**
   * Parses widgetId (and optional lang) from a stw-widget-project fence (code body or full message).
   * projectPath is derived as `{stewardFolder}/Widgets/{widgetId}`.
   */
  public parseProjectFenceContent(content: string): WidgetProjectFenceData | null {
    const parsed = this.parseFenceBody(content);
    if (!parsed.widgetId) {
      return null;
    }

    return {
      widgetId: parsed.widgetId,
      projectPath: this.getProjectPath({ widgetId: parsed.widgetId }),
      lang: parsed.lang,
      generatedFile: parsed.generatedFile,
    };
  }

  private parseFenceBody(content: string): {
    widgetId: string | null;
    lang: string | null;
    generatedFile: string | null;
  } {
    const fencePattern = new RegExp(
      `\`\`\`${WIDGET_PROJECT_FENCE_LANGUAGE}\\s*\\n([\\s\\S]*?)\\n\`\`\``,
      'i'
    );
    const fenceMatch = content.match(fencePattern);
    const body = fenceMatch ? fenceMatch[1] : content;

    let widgetId: string | null = null;
    let lang: string | null = null;
    let generatedFile: string | null = null;

    const lines = body.trim().split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const trimmed = lines[i].trim();
      if (!trimmed) {
        continue;
      }

      const colonIndex = trimmed.indexOf(':');
      if (colonIndex > 0) {
        const key = trimmed.slice(0, colonIndex).trim();
        const value = trimmed.slice(colonIndex + 1).trim();
        if (key === 'widgetId' && value) {
          widgetId = value;
        }
        if (key === 'lang' && value) {
          lang = value;
        }
        if (key === 'generatedFile' && value) {
          generatedFile = normalizePath(value);
        }
        continue;
      }

      if (!widgetId) {
        widgetId = trimmed;
      }
    }

    return { widgetId, lang, generatedFile };
  }

  /** Prepares asset: attribute references for iframe hydration (no host-side inlining). */
  public inlineAssetsInHtml(params: { html: string; assets?: string[] }): string {
    return this.bundler.prepareAssetPlaceholders(params.html);
  }

  /** Returns asset: paths used in content but absent from the declared assets list. */
  public findMissingAssets(params: {
    content: string | string[];
    declaredAssets?: string[];
  }): string[] {
    return this.bundler.findMissingAssets(params);
  }

  /** Validates `.js` widget project files from vault content after they are written. */
  public async validateWrittenJsFiles(filePaths: string[]): Promise<WidgetJsValidationError[]> {
    const errors: WidgetJsValidationError[] = [];

    for (let i = 0; i < filePaths.length; i++) {
      const filePath = filePaths[i];
      if (!this.isWidgetProjectPath(filePath) || !this.jsValidator.isJsFilePath(filePath)) {
        continue;
      }

      const file = this.plugin.app.vault.getFileByPath(filePath);
      if (!file) {
        continue;
      }

      const content = await this.plugin.app.vault.read(file);
      const error = this.jsValidator.validateContent({ filePath, content });
      if (error) {
        errors.push(error);
      }
    }

    return errors;
  }

  /**
   * Writes project files and Widget.md manifest under the widget project folder.
   */
  public async createProject(params: {
    widgetId: string;
    widgetName: string;
    files: Record<string, string>;
    entry?: string;
    assets?: string[];
  }): Promise<{ projectPath: string; entry: string }> {
    const projectPath = this.getProjectPath({
      widgetId: params.widgetId,
    });
    const entry = params.entry ?? 'index.html';

    if (!params.files[entry]) {
      throw new Error(`Widget entry file "${entry}" is missing from files`);
    }

    await this.plugin.obsidianAPITools.ensureFolderExists(projectPath);

    const manifestYamlData: Record<string, unknown> = {
      name: 'manifest',
      entry,
      type: 'html',
      widgetId: params.widgetId,
      widgetName: params.widgetName,
      maxAssetSize: WidgetAsset.DEFAULT_MAX_SIZE_MANIFEST,
    };
    if (params.assets?.length) {
      manifestYamlData.assets = params.assets.map(path => WidgetBundler.normalizeAssetPath(path));
    }

    const filePaths = Object.keys(params.files);
    for (let i = 0; i < filePaths.length; i++) {
      const relativePath = filePaths[i];
      if (relativePath.startsWith('/') || relativePath.split('/').includes('..')) {
        throw new Error(`Invalid widget file path: ${relativePath}`);
      }

      const absolutePath = normalizePath(`${projectPath}/${relativePath}`);
      if (!isPathUnderPrefix(normalizePath(projectPath), normalizePath(absolutePath))) {
        throw new Error(`Invalid widget file path: ${relativePath}`);
      }

      const existing = this.plugin.app.vault.getFileByPath(absolutePath);
      if (existing) {
        await this.plugin.app.vault.modify(existing, params.files[relativePath]);
      } else {
        const parent = absolutePath.includes('/')
          ? absolutePath.slice(0, absolutePath.lastIndexOf('/'))
          : projectPath;
        await this.plugin.obsidianAPITools.ensureFolderExists(parent);
        await this.plugin.app.vault.create(absolutePath, params.files[relativePath]);
      }
    }

    const definitionPath = normalizePath(`${projectPath}/Widget.md`);
    const definitionContent = this.plugin.markdownDefinitionService.buildYamlFence(
      stringifyYamlFence(manifestYamlData)
    );
    let definitionFile = this.plugin.app.vault.getFileByPath(definitionPath);
    if (definitionFile) {
      await this.plugin.app.vault.modify(definitionFile, definitionContent);
    } else {
      definitionFile = await this.plugin.app.vault.create(definitionPath, definitionContent);
    }

    return { projectPath, entry };
  }

  /** Lists relative file paths in a project folder (recursive). */
  public async listProjectFiles(projectPath: string): Promise<string[]> {
    const folder = this.plugin.app.vault.getFolderByPath(projectPath);
    if (!folder) {
      return [];
    }

    const normalizedProject = normalizePath(projectPath);
    const vaultFiles = this.plugin.obsidianAPITools.getFilesFromFolder(folder, {
      recursive: true,
    });
    const files: string[] = [];
    for (let i = 0; i < vaultFiles.length; i++) {
      files.push(normalizePath(vaultFiles[i].path).slice(normalizedProject.length + 1));
    }
    files.sort();
    return files;
  }

  /** Validates action params against the Widget.md actions catalog. */
  private validateActionParams(params: {
    catalog: WidgetActionsCatalog;
    action: string;
    actionParams: Record<string, unknown>;
  }): { valid: true } | { valid: false; errors: string[] } {
    const actionDef = params.catalog.actions[params.action];
    if (!actionDef) {
      return { valid: false, errors: [`Unknown action "${params.action}"`] };
    }

    const schema = this.buildActionParamsSchema(actionDef.params ?? {});
    const parsed = schema.safeParse(params.actionParams);
    if (parsed.success) {
      return { valid: true };
    }

    return {
      valid: false,
      errors: parsed.error.issues.map(issue => issue.message),
    };
  }

  private buildActionParamsSchema(
    paramSpecs: NonNullable<WidgetActionsCatalog['actions'][string]['params']>
  ): z.ZodObject<Record<string, z.ZodTypeAny>> {
    const shape: Record<string, z.ZodTypeAny> = {};
    const paramNames = Object.keys(paramSpecs);

    for (let i = 0; i < paramNames.length; i++) {
      const paramName = paramNames[i];
      shape[paramName] = this.buildParamZodSchema(paramName, paramSpecs[paramName]);
    }

    return z.object(shape);
  }

  private buildParamZodSchema(paramName: string, spec: WidgetActionParamSpec): z.ZodTypeAny {
    const paramType = spec.type ?? 'string';

    if (paramType === 'integer') {
      let schema = z
        .number({
          required_error: `Missing required param "${paramName}"`,
          invalid_type_error: `Param "${paramName}" must be an integer`,
        })
        .int(`Param "${paramName}" must be an integer`);

      if (spec.minimum !== undefined) {
        schema = schema.min(spec.minimum, `Param "${paramName}" must be >= ${spec.minimum}`);
      }
      if (spec.maximum !== undefined) {
        schema = schema.max(spec.maximum, `Param "${paramName}" must be <= ${spec.maximum}`);
      }

      return schema;
    }

    if (paramType === 'number') {
      let schema = z.number({
        required_error: `Missing required param "${paramName}"`,
        invalid_type_error: `Param "${paramName}" must be a number`,
      });

      if (spec.minimum !== undefined) {
        schema = schema.min(spec.minimum, `Param "${paramName}" must be >= ${spec.minimum}`);
      }
      if (spec.maximum !== undefined) {
        schema = schema.max(spec.maximum, `Param "${paramName}" must be <= ${spec.maximum}`);
      }

      return schema;
    }

    if (paramType === 'boolean') {
      return z.boolean({
        required_error: `Missing required param "${paramName}"`,
        invalid_type_error: `Param "${paramName}" must be a boolean`,
      });
    }

    return z.string({
      required_error: `Missing required param "${paramName}"`,
      invalid_type_error: `Param "${paramName}" must be a string`,
    });
  }

  /**
   * Registers the host→iframe bridge for dispatching actions on a mounted project widget.
   * @returns Unregister function to call on DOM teardown.
   */
  public registerActionBridge(handle: WidgetActionBridgeHandle): () => void {
    const normalizedPath = normalizePath(handle.projectPath);
    const entry: WidgetActionBridgeEntry = {
      sendApplyAction: handle.sendApplyAction,
      registeredActions: [],
    };

    let entries = this.actionBridgeEntriesByPath.get(normalizedPath);
    if (!entries) {
      entries = new Set();
      this.actionBridgeEntriesByPath.set(normalizedPath, entries);
    }
    entries.add(entry);

    return () => {
      const current = this.actionBridgeEntriesByPath.get(normalizedPath);
      if (!current) {
        return;
      }
      current.delete(entry);
      if (current.size === 0) {
        this.actionBridgeEntriesByPath.delete(normalizedPath);
      }
    };
  }

  /** Records action names registered inside one mounted iframe via window.stw.registerAction. */
  public setRegisteredActions(params: {
    projectPath: string;
    sendApplyAction: WidgetActionBridgeHandle['sendApplyAction'];
    actions: string[];
  }): void {
    const normalizedPath = normalizePath(params.projectPath);
    const entries = this.actionBridgeEntriesByPath.get(normalizedPath);
    if (!entries) {
      return;
    }

    for (const entry of entries) {
      if (entry.sendApplyAction !== params.sendApplyAction) {
        continue;
      }

      entry.registeredActions = [...params.actions];
      void this.warnUnregisteredCatalogActions(normalizedPath, entry.registeredActions);
      return;
    }
  }

  private resolveActionBridgeEntry(params: {
    projectPath: string;
    action: string;
  }): WidgetActionBridgeEntry | null {
    const entries = this.actionBridgeEntriesByPath.get(normalizePath(params.projectPath));
    if (!entries || entries.size === 0) {
      return null;
    }

    for (const entry of entries) {
      if (entry.registeredActions.length === 0 || entry.registeredActions.includes(params.action)) {
        return entry;
      }
    }

    return null;
  }

  /** Resolves a pending applyAction request from a WIDGET_ACTION_RESULT message. */
  public resolveActionResult(params: {
    requestId: string;
    ok: boolean;
    error?: string;
    state?: unknown;
  }): void {
    const pending = this.pendingActionRequests.get(params.requestId);
    if (!pending) {
      return;
    }

    clearTimeout(pending.timer);
    this.pendingActionRequests.delete(params.requestId);
    pending.resolve({
      ok: params.ok,
      error: params.error,
      state: params.state,
    });
  }

  /**
   * Dispatches a registered widget action into the mounted iframe.
   * Validates against Widget.md before dispatch; persistence uses the iframe setState path.
   */
  public async applyAction(params: {
    projectPath: string;
    action: string;
    actionParams: Record<string, unknown>;
  }): Promise<WidgetActionResult> {
    const normalizedPath = normalizePath(params.projectPath);
    const def = await this.definitionService.getWidgetDefinition(normalizedPath);
    if (!def.actions) {
      return { ok: false, error: 'actions_catalog_missing' };
    }

    const validation = this.validateActionParams({
      catalog: def.actions,
      action: params.action,
      actionParams: params.actionParams,
    });
    if (!validation.valid) {
      return { ok: false, error: validation.errors.join('; ') };
    }

    const bridge = this.resolveActionBridgeEntry({
      projectPath: normalizedPath,
      action: params.action,
    });
    if (!bridge) {
      const entries = this.actionBridgeEntriesByPath.get(normalizedPath);
      if (!entries || entries.size === 0) {
        return { ok: false, error: 'widget_not_mounted' };
      }
      return { ok: false, error: `action_not_registered:${params.action}` };
    }

    const requestId = `stw-action-${uniqueID()}`;

    return new Promise<WidgetActionResult>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingActionRequests.delete(requestId);
        reject(new Error('widget_action_timeout'));
      }, WIDGET_ACTION_APPLY_TIMEOUT_MS);

      this.pendingActionRequests.set(requestId, { resolve, reject, timer });

      bridge.sendApplyAction({
        action: params.action,
        params: params.actionParams,
        requestId,
      });
    }).catch(error => {
      const message = error instanceof Error ? error.message : String(error);
      return { ok: false, error: message };
    });
  }

  /** Bundles the project entry HTML for iframe srcdoc rendering (assets hydrated at runtime). */
  public async bundleProject(projectPath: string): Promise<WidgetProjectBundle> {
    const def = await this.definitionService.getWidgetDefinition(projectPath);
    if (!def.manifest?.entry) {
      throw new Error(`Widget manifest missing or invalid: ${projectPath}`);
    }

    const manifestAssets = def.manifest.assets ?? [];
    const html = await this.bundler.bundle({
      projectPath,
      entryRelativePath: def.manifest.entry,
    });
    const assets = WidgetAsset.buildRegistry(manifestAssets);
    return { html, assets };
  }

  /**
   * Reads a manifest-listed asset for an iframe asset request.
   * Only assets declared in Widget.md manifest are allowed.
   */
  public async provideAsset(params: {
    projectPath: string;
    assetId: string;
  }): Promise<WidgetAssetReadResponse> {
    const def = await this.definitionService.getWidgetDefinition(params.projectPath);
    const manifestAssets = def.manifest?.assets ?? [];
    const maxAssetBytes = WidgetAsset.resolveMaxBytes(def.manifest);
    return this._assets.readManifestAsset({
      assetId: params.assetId,
      manifestAssets,
      maxAssetBytes,
    });
  }

  /**
   * Registers a mounted widget for hot-reload when project files change.
   * @returns Unregister function to call on DOM teardown.
   */
  public registerMountedWidget(
    params: MountedWidgetHandle & { container: HTMLElement }
  ): () => void {
    this.ensureModifyListener();

    const entry: MountedWidgetEntry = {
      container: params.container,
      refresh: params.refresh,
    };

    let entries = this.mountedByPath.get(params.projectPath);
    if (!entries) {
      entries = new Set();
      this.mountedByPath.set(params.projectPath, entries);
    }
    entries.add(entry);

    return () => {
      const current = this.mountedByPath.get(params.projectPath);
      if (!current) {
        return;
      }
      current.delete(entry);
      if (current.size === 0) {
        this.mountedByPath.delete(params.projectPath);
      }
    };
  }

  /** Subscribes once to vault modify events for widget project hot-reload. */
  private ensureModifyListener(): void {
    if (this.modifyListenerRegistered) {
      return;
    }

    this.plugin.registerEvent(
      this.plugin.app.vault.on('modify', (file: TAbstractFile) => {
        if (!(file instanceof TFile)) {
          return;
        }
        if (!this.isWidgetProjectPath(file.path)) {
          return;
        }

        const projectPath = this.findProjectPathForFile(file.path);
        if (!projectPath) {
          return;
        }

        if (normalizePath(file.path) === this.stateService.getStatePath(projectPath)) {
          return;
        }

        if (this.isGeneratedHtmlPath(file.path)) {
          return;
        }

        const entries = this.mountedByPath.get(projectPath);
        if (!entries || entries.size === 0) {
          return;
        }

        for (const entry of entries) {
          void entry.refresh();
        }
      })
    );

    this.modifyListenerRegistered = true;
  }

  /** Resolves `{root}/{widgetId}` from any file path inside a project. */
  private findProjectPathForFile(filePath: string): string | null {
    const normalized = normalizePath(filePath);
    const root = this.getWidgetsRootPath();
    if (!normalized.startsWith(`${root}/`)) {
      return null;
    }

    const relative = normalized.slice(root.length + 1);
    const segments = relative.split('/');
    if (segments.length < 1 || !segments[0]) {
      return null;
    }

    return normalizePath(`${root}/${segments[0]}`);
  }

  private async resolveWidgetArtifactPath(params: {
    widgetId: string;
    widgetName: string;
  }): Promise<string> {
    const preferredPath = this.getWidgetArtifactPath({ widgetName: params.widgetName });
    const existing = this.plugin.app.vault.getFileByPath(preferredPath);
    if (!existing) {
      return preferredPath;
    }

    const existingWidgetId = this.parseProjectFenceContent(
      await this.plugin.app.vault.read(existing)
    )?.widgetId;
    if (existingWidgetId === params.widgetId) {
      return preferredPath;
    }

    const suffix = this.sanitizeWidgetViewFileName(params.widgetId) || params.widgetId;
    const fileBaseName = this.sanitizeWidgetViewFileName(params.widgetName) || 'Widget';
    return normalizePath(
      `${this.getArtifactsRootPath()}/${fileBaseName} (${suffix}).${ARTIFACT_FILE_EXTENSION}`
    );
  }

  private formatYamlQuotedString(value: string): string {
    return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
  }

  private async warnUnregisteredCatalogActions(
    projectPath: string,
    registeredActions: string[]
  ): Promise<void> {
    const { actions: actionsCatalog } =
      await this.definitionService.getWidgetDefinition(projectPath);
    if (!actionsCatalog) {
      return;
    }

    const catalogActions = Object.keys(actionsCatalog.actions);
    for (let i = 0; i < catalogActions.length; i++) {
      const actionName = catalogActions[i];
      if (!registeredActions.includes(actionName)) {
        logger.warn(
          `Widget action "${actionName}" is listed in Widget.md but not registered in main.js`,
          { projectPath }
        );
      }
    }
  }
}
