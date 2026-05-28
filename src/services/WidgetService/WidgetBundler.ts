import { normalizePath } from 'obsidian';
import type StewardPlugin from 'src/main';

/** Prefix for vault asset references in widget HTML before base64 inlining. */
export const WIDGET_ASSET_PREFIX = 'asset:';

/** Matches asset:path references in HTML, CSS url(), and attribute values. */
const WIDGET_ASSET_PATH_PATTERN = /asset:([^\s"'<>)\]]+)/g;

const LINK_HREF_PATTERN = /<link\b[^>]*\bhref\s*=\s*["']([^"']+)["'][^>]*>/gi;
const SCRIPT_SRC_PATTERN = /<script\b[^>]*\bsrc\s*=\s*["']([^"']+)["'][^>]*>\s*<\/script>/gi;

/**
 * Inlines local CSS/JS from a widget project folder into a single HTML document for sandboxed iframe srcdoc.
 */
export class WidgetBundler {
  constructor(private readonly plugin: StewardPlugin) {}

  /**
   * Reads the entry HTML, inlines linked stylesheets and scripts, and replaces vault asset paths.
   */
  public async bundle(params: {
    projectPath: string;
    entryRelativePath: string;
    assetDataUrls: Record<string, string>;
  }): Promise<string> {
    const entryPath = normalizePath(`${params.projectPath}/${params.entryRelativePath}`);
    const entryContent = await this.readProjectFile(entryPath, params.projectPath);
    if (entryContent === null) {
      throw new Error(`Widget entry file not found: ${params.entryRelativePath}`);
    }

    let html = entryContent;
    html = await this.inlineStylesheets({
      html,
      projectPath: params.projectPath,
      entryFile: params.entryRelativePath,
    });
    html = await this.inlineScripts({
      html,
      projectPath: params.projectPath,
      entryFile: params.entryRelativePath,
    });

    html = this.applyAssetPaths(html, params.assetDataUrls);
    return html.trim();
  }

  /** Normalizes a vault-relative asset path from the assets array. */
  public static normalizeAssetPath(path: string): string {
    let trimmed = path.trim();
    if (trimmed.startsWith(WIDGET_ASSET_PREFIX)) {
      trimmed = trimmed.slice(WIDGET_ASSET_PREFIX.length);
    }
    return normalizePath(trimmed);
  }

  /** Builds the HTML lookup key for an asset path (asset:Images/photo.png). */
  public assetPathKey(vaultRelativePath: string): string {
    return `${WIDGET_ASSET_PREFIX}${normalizePath(vaultRelativePath)}`;
  }

  /** Collects unique vault-relative paths referenced via asset: in HTML or CSS content. */
  public extractAssetPaths(content: string): string[] {
    const paths = new Set<string>();
    const pattern = new RegExp(WIDGET_ASSET_PATH_PATTERN.source, WIDGET_ASSET_PATH_PATTERN.flags);
    let match: RegExpExecArray | null;

    while ((match = pattern.exec(content)) !== null) {
      paths.add(WidgetBundler.normalizeAssetPath(match[1]));
    }

    const result: string[] = [];
    for (const path of paths) {
      result.push(path);
    }
    result.sort();
    return result;
  }

  /** Returns asset: paths used in content but absent from the declared assets list. */
  public findMissingAssets(params: {
    content: string | string[];
    declaredAssets?: string[];
  }): string[] {
    const contents = Array.isArray(params.content) ? params.content : [params.content];
    const referenced = new Set<string>();

    for (let i = 0; i < contents.length; i++) {
      const paths = this.extractAssetPaths(contents[i]);
      for (let j = 0; j < paths.length; j++) {
        referenced.add(paths[j]);
      }
    }

    const declared = new Set<string>();
    const assets = params.declaredAssets ?? [];
    for (let i = 0; i < assets.length; i++) {
      declared.add(WidgetBundler.normalizeAssetPath(assets[i]));
    }

    const missing: string[] = [];
    for (const path of referenced) {
      if (!declared.has(path)) {
        missing.push(path);
      }
    }
    missing.sort();
    return missing;
  }

  /** Replaces asset:path references in HTML/CSS with bundled base64 data URLs. */
  public applyAssetPaths(html: string, assetDataUrls: Record<string, string>): string {
    const keys = Object.keys(assetDataUrls);
    if (keys.length === 0) {
      return html;
    }

    keys.sort((a, b) => b.length - a.length);

    let result = html;
    for (let i = 0; i < keys.length; i++) {
      const key = keys[i];
      result = result.split(key).join(assetDataUrls[key]);
    }
    return result;
  }

  private async readProjectFile(absolutePath: string, projectPath: string): Promise<string | null> {
    if (!this.isPathInsideProject(projectPath, absolutePath)) {
      return null;
    }
    const file = this.plugin.app.vault.getFileByPath(absolutePath);
    if (!file) {
      return null;
    }
    return this.plugin.app.vault.read(file);
  }

  /** Resolves a relative href/src against the entry file path; rejects external and parent escapes. */
  private resolveRelativePath(relativePath: string, fromFile: string): string | null {
    if (/^https?:\/\//i.test(relativePath) || relativePath.startsWith('data:')) {
      return null;
    }

    if (relativePath.startsWith('/') || /^[a-zA-Z]:/.test(relativePath)) {
      return null;
    }

    const fromDir = fromFile.includes('/') ? fromFile.slice(0, fromFile.lastIndexOf('/')) : '';

    const baseSegments = fromDir ? fromDir.split('/') : [];
    const relSegments = relativePath.split(/[/\\]/);
    const resolved: string[] = [...baseSegments];

    for (let i = 0; i < relSegments.length; i++) {
      const segment = relSegments[i];
      if (!segment || segment === '.') {
        continue;
      }
      if (segment === '..') {
        if (resolved.length === 0) {
          return null;
        }
        resolved.pop();
        continue;
      }
      resolved.push(segment);
    }

    return resolved.join('/');
  }

  private async inlineStylesheets(params: {
    html: string;
    projectPath: string;
    entryFile: string;
  }): Promise<string> {
    return this.replaceAsync(params.html, LINK_HREF_PATTERN, async (match, href: string) => {
      if (/^https?:\/\//i.test(href) || href.startsWith('data:')) {
        return match;
      }

      const resolved = this.resolveRelativePath(href, params.entryFile);
      if (!resolved) {
        return match;
      }

      const css = await this.readProjectFile(
        normalizePath(`${params.projectPath}/${resolved}`),
        params.projectPath
      );
      if (css === null) {
        return match;
      }

      return `<style>\n${css}\n</style>`;
    });
  }

  private async inlineScripts(params: {
    html: string;
    projectPath: string;
    entryFile: string;
  }): Promise<string> {
    return this.replaceAsync(params.html, SCRIPT_SRC_PATTERN, async (match, src: string) => {
      if (/^https?:\/\//i.test(src) || src.startsWith('data:')) {
        return match;
      }

      const resolved = this.resolveRelativePath(src, params.entryFile);
      if (!resolved) {
        return match;
      }

      const js = await this.readProjectFile(
        normalizePath(`${params.projectPath}/${resolved}`),
        params.projectPath
      );
      if (js === null) {
        return match;
      }

      return `<script>\n${this.escapeScriptContent(js)}\n</script>`;
    });
  }

  private escapeScriptContent(content: string): string {
    return content.replace(/<\/script/gi, '<\\/script');
  }

  private isPathInsideProject(projectPath: string, targetPath: string): boolean {
    const project = normalizePath(projectPath);
    const target = normalizePath(targetPath);
    return target === project || target.startsWith(`${project}/`);
  }

  private async replaceAsync(
    input: string,
    pattern: RegExp,
    replacer: (match: string, ...groups: string[]) => Promise<string>
  ): Promise<string> {
    const flags = pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`;
    const globalPattern = new RegExp(pattern.source, flags);
    let result = '';
    let lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = globalPattern.exec(input)) !== null) {
      result += input.slice(lastIndex, match.index);
      const replacement = await replacer(match[0], ...match.slice(1));
      result += replacement;
      lastIndex = globalPattern.lastIndex;
    }

    result += input.slice(lastIndex);
    return result;
  }
}
