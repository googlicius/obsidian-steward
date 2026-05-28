import { TAbstractFile, TFile, normalizePath } from 'obsidian';
import type StewardPlugin from 'src/main';
import { logger } from 'src/utils/logger';
import { isPathUnderPrefix } from 'src/utils/pathUtils';
import { WidgetBundler } from './WidgetBundler';
import { WidgetJsValidator } from './WidgetJsValidator';
import type { WidgetManifest, WidgetProjectFenceData } from './types';

const MAX_ASSET_BYTES = 2 * 1024 * 1024;

/** Markdown fence language for project widget references in conversation notes */
export const WIDGET_PROJECT_FENCE_LANGUAGE = 'stw-widget-project';

export interface MountedWidgetHandle {
  projectPath: string;
  refresh: () => Promise<void>;
}

interface MountedWidgetEntry {
  container: HTMLElement;
  refresh: () => Promise<void>;
}

/**
 * Manages multi-file widget projects in the vault: create, list, bundle, and hot-reload on edit.
 */
export class WidgetService {
  private static instance: WidgetService;
  private readonly bundler: WidgetBundler;
  public readonly jsValidator: WidgetJsValidator;
  private readonly mountedByPath = new Map<string, Set<MountedWidgetEntry>>();
  private modifyListenerRegistered = false;

  private constructor(private readonly plugin: StewardPlugin) {
    this.bundler = new WidgetBundler(plugin);
    this.jsValidator = new WidgetJsValidator();
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

  /** Absolute vault path for one widget project. */
  public getProjectPath(params: { conversationTitle: string; widgetId: string }): string {
    return normalizePath(
      `${this.getWidgetsRootPath()}/${params.conversationTitle}/${params.widgetId}`
    );
  }

  /** Whether a vault path is under the widget projects root. */
  public isWidgetProjectPath(path: string): boolean {
    const normalized = normalizePath(path);
    const root = this.getWidgetsRootPath();
    return normalized === root || normalized.startsWith(`${root}/`);
  }

  /** Builds the markdown fence block that references a project in the conversation note. */
  public buildProjectFence(data: WidgetProjectFenceData): string {
    return `\`\`\`${WIDGET_PROJECT_FENCE_LANGUAGE}\nwidgetId: ${data.widgetId}\nprojectPath: ${data.projectPath}\n\`\`\``;
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

  /**
   * Writes project files and manifest.json under the widget project folder.
   */
  public async createProject(params: {
    conversationTitle: string;
    widgetId: string;
    files: Record<string, string>;
    entry?: string;
    assets?: string[];
  }): Promise<{ projectPath: string; entry: string }> {
    const projectPath = this.getProjectPath({
      conversationTitle: params.conversationTitle,
      widgetId: params.widgetId,
    });
    const entry = params.entry ?? 'index.html';

    if (!params.files[entry]) {
      throw new Error(`Widget entry file "${entry}" is missing from files`);
    }

    await this.plugin.obsidianAPITools.ensureFolderExists(projectPath);

    const manifest: WidgetManifest = {
      entry,
      type: 'html',
      assets: params.assets?.length
        ? params.assets.map(path => WidgetBundler.normalizeAssetPath(path))
        : undefined,
    };

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

    const manifestPath = normalizePath(`${projectPath}/manifest.json`);
    const manifestContent = JSON.stringify(manifest, null, 2);
    const manifestFile = this.plugin.app.vault.getFileByPath(manifestPath);
    if (manifestFile) {
      await this.plugin.app.vault.modify(manifestFile, manifestContent);
    } else {
      await this.plugin.app.vault.create(manifestPath, manifestContent);
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

  /** Reads and parses manifest.json from a project folder. */
  public async readManifest(projectPath: string): Promise<WidgetManifest | null> {
    const manifestPath = normalizePath(`${projectPath}/manifest.json`);
    const file = this.plugin.app.vault.getFileByPath(manifestPath);
    if (!file) {
      return null;
    }

    try {
      const raw = await this.plugin.app.vault.read(file);
      return JSON.parse(raw) as WidgetManifest;
    } catch (error) {
      logger.error('Failed to read widget manifest:', error);
      return null;
    }
  }

  /** Bundles the project entry HTML with inlined assets for iframe srcdoc rendering. */
  public async bundleProject(projectPath: string): Promise<string> {
    const manifest = await this.readManifest(projectPath);
    if (!manifest?.entry) {
      throw new Error(`Widget manifest missing or invalid: ${projectPath}`);
    }

    const assetDataUrls = await this.resolveAssetDataUrls(manifest.assets ?? []);
    return this.bundler.bundle({
      projectPath,
      entryRelativePath: manifest.entry,
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

  /** Resolves `{root}/{conversation}/{widgetId}` from any file path inside a project. */
  private findProjectPathForFile(filePath: string): string | null {
    const normalized = normalizePath(filePath);
    const root = this.getWidgetsRootPath();
    if (!normalized.startsWith(`${root}/`)) {
      return null;
    }

    const relative = normalized.slice(root.length + 1);
    const segments = relative.split('/');
    if (segments.length < 2) {
      return null;
    }

    return normalizePath(`${root}/${segments[0]}/${segments[1]}`);
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

  private arrayBufferToBase64(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }
}
