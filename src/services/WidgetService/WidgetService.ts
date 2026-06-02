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
import {
  type WidgetActionParamSpec,
  type WidgetActionResult,
  type WidgetActionsCatalog,
  WidgetProjectFenceData,
} from './types';
import { stringifyYamlFence } from '../MarkdownDefinitionService';

const MAX_ASSET_BYTES = 2 * 1024 * 1024;

/** Markdown fence language for project widget references in conversation notes */
export const WIDGET_PROJECT_FENCE_LANGUAGE = 'stw-widget-project';

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

interface WidgetActionBridge {
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
  private readonly actionBridgeByPath = new Map<string, WidgetActionBridge>();
  private readonly pendingActionRequests = new Map<string, PendingActionRequest>();
  private modifyListenerRegistered = false;
  private readonly _definitionService: WidgetDefinitionService;
  private readonly _stateService: WidgetStateService;

  private constructor(private readonly plugin: StewardPlugin) {
    this.bundler = new WidgetBundler(plugin);
    this.jsValidator = new WidgetJsValidator();
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

  /** Whether a vault path is under the widget projects root. */
  public isWidgetProjectPath(path: string): boolean {
    const normalized = normalizePath(path);
    const root = this.getWidgetsRootPath();
    return normalized === root || normalized.startsWith(`${root}/`);
  }

  /** Whether a vault path is the Widget.md definition file inside a widget project. */
  public isWidgetDefinitionPath(filePath: string): boolean {
    return this.definitionService.isWidgetDefinitionPath(filePath);
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
  public buildProjectFence(data: WidgetProjectFenceData): string {
    return `\`\`\`${WIDGET_PROJECT_FENCE_LANGUAGE}\nwidgetId: ${data.widgetId}\nprojectPath: ${data.projectPath}\n\`\`\`\n<small>*ID: ${data.widgetId}*</small>`;
  }

  /** Parses `widgetId` and `projectPath` from a stw-widget-project code block body (pre > code textContent). */
  public parseProjectFenceContent(content: string): WidgetProjectFenceData | null {
    const match = content.match(/widgetId:\s*([^\r\n]+)\r?\nprojectPath:\s*([^\r\n]+)/);
    if (!match) {
      return null;
    }

    return {
      widgetId: match[1].trim(),
      projectPath: normalizePath(match[2].trim()),
    };
  }

  /** Instance wrapper around {@link parseProjectFenceContent}. */
  public parseProjectFence(content: string): WidgetProjectFenceData | null {
    return this.parseProjectFenceContent(content);
  }

  /** Replaces vault asset path references in HTML with inlined data URLs. */
  public async inlineAssetsInHtml(params: { html: string; assets?: string[] }): Promise<string> {
    if (!params.assets || params.assets.length === 0) {
      return params.html;
    }

    const assetDataUrls = await this.resolveAssetDataUrls(params.assets);
    return this.bundler.applyAssetPaths(params.html, assetDataUrls);
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
    this.actionBridgeByPath.set(normalizedPath, {
      sendApplyAction: handle.sendApplyAction,
      registeredActions: [],
    });

    return () => {
      this.actionBridgeByPath.delete(normalizedPath);
    };
  }

  /** Records action names registered inside the iframe via window.stw.registerAction. */
  public setRegisteredActions(projectPath: string, actions: string[]): void {
    const bridge = this.actionBridgeByPath.get(normalizePath(projectPath));
    if (!bridge) {
      return;
    }

    bridge.registeredActions = [...actions];

    void this.warnUnregisteredCatalogActions(projectPath, bridge.registeredActions);
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

    const bridge = this.actionBridgeByPath.get(normalizedPath);
    if (!bridge) {
      return { ok: false, error: 'widget_not_mounted' };
    }

    if (bridge.registeredActions.length > 0 && !bridge.registeredActions.includes(params.action)) {
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

  /** Bundles the project entry HTML with inlined assets for iframe srcdoc rendering. */
  public async bundleProject(projectPath: string): Promise<string> {
    const def = await this.definitionService.getWidgetDefinition(projectPath);
    if (!def.manifest?.entry) {
      throw new Error(`Widget manifest missing or invalid: ${projectPath}`);
    }

    const assetDataUrls = await this.resolveAssetDataUrls(def.manifest.assets ?? []);
    return this.bundler.bundle({
      projectPath,
      entryRelativePath: def.manifest.entry,
      assetDataUrls,
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

  /** Resolves asset paths into data URLs keyed by asset:path for HTML replacement. */
  private async resolveAssetDataUrls(assets: string[]): Promise<Record<string, string>> {
    const dataUrls: Record<string, string> = {};

    for (let i = 0; i < assets.length; i++) {
      const vaultRelativePath = WidgetBundler.normalizeAssetPath(assets[i]);
      const file = await this.plugin.mediaTools.findFileByNameOrPath(vaultRelativePath);
      if (!file) {
        logger.warn(`Widget asset not found: ${vaultRelativePath}`);
        continue;
      }

      const dataUrl = await this.readFileAsDataUrl(file);
      if (!dataUrl) {
        continue;
      }

      const key = WidgetBundler.assetPathKey(vaultRelativePath);
      dataUrls[key] = dataUrl;
    }

    return dataUrls;
  }

  /** Reads a vault file as a base64 data URL, skipping files over the size cap. */
  private async readFileAsDataUrl(file: TFile): Promise<string | null> {
    const stat = await this.plugin.app.vault.adapter.stat(file.path);
    if (stat && stat.size > MAX_ASSET_BYTES) {
      logger.warn(
        `Widget asset too large, skipping: ${file.path} (${stat.size} bytes, max ${MAX_ASSET_BYTES})`
      );
      return null;
    }

    const binary = await this.plugin.app.vault.readBinary(file);
    if (binary.byteLength > MAX_ASSET_BYTES) {
      logger.warn(
        `Widget asset too large, skipping: ${file.path} (${binary.byteLength} bytes, max ${MAX_ASSET_BYTES})`
      );
      return null;
    }

    const mimeType = this.getMimeType(file.extension);
    const base64 = this.arrayBufferToBase64(binary);
    return `data:${mimeType};base64,${base64}`;
  }

  private getMimeType(extension: string): string {
    const ext = extension.toLowerCase();
    if (ext === 'png') {
      return 'image/png';
    }
    if (ext === 'jpg' || ext === 'jpeg') {
      return 'image/jpeg';
    }
    if (ext === 'gif') {
      return 'image/gif';
    }
    if (ext === 'webp') {
      return 'image/webp';
    }
    if (ext === 'svg') {
      return 'image/svg+xml';
    }
    return 'application/octet-stream';
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

  private arrayBufferToBase64(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }
}
