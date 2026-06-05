import { normalizePath } from 'obsidian';
import type StewardPlugin from 'src/main';
import { isPathUnderPrefix } from 'src/utils/pathUtils';

/** Prefix for vault asset references in widget HTML before URL resolution. */
export const WIDGET_ASSET_PREFIX = 'asset:';

/** Matches asset:path references in HTML, CSS url(), and attribute values. */
const WIDGET_ASSET_PATH_PATTERN = /asset:([^\s"'<>)\]]+)/g;

const LINK_HREF_PATTERN = /<link\b[^>]*\bhref\s*=\s*["']([^"']+)["'][^>]*>/gi;
const SCRIPT_SRC_PATTERN = /<script\b[^>]*\bsrc\s*=\s*["']([^"']+)["'][^>]*>\s*<\/script>/gi;
const ASSET_ATTR_PLACEHOLDER_PATTERN = /\b(src|href)=(["'])asset:([^"']+)\2/gi;
const ASSET_POSTER_PLACEHOLDER_PATTERN = /\bposter=(["'])asset:([^"']+)\1/gi;

/**
 * Inlines local CSS/JS from a widget project folder into a single HTML document for sandboxed iframe srcdoc.
 */
export class WidgetBundler {
  constructor(private readonly plugin: StewardPlugin) {}

  public async bundle(params: {
    projectPath: string;
    entryRelativePath: string;
  }): Promise<string> {
    const entryPath = normalizePath(`${params.projectPath}/${params.entryRelativePath}`);
    const entryContent = await this.readProjectFile(entryPath, params.projectPath);
    if (entryContent === null) {
      throw new Error(`Widget entry file not found: ${params.entryRelativePath}`);
    }

    let html = entryContent;
    html = await this.inlineResourceTags({
      html,
      pattern: LINK_HREF_PATTERN,
      projectPath: params.projectPath,
      entryFile: params.entryRelativePath,
      wrap: css => `<style>\n${css}\n</style>`,
    });
    html = await this.inlineResourceTags({
      html,
      pattern: SCRIPT_SRC_PATTERN,
      projectPath: params.projectPath,
      entryFile: params.entryRelativePath,
      wrap: js => `<script>\n${js.replace(/<\/script/gi, '<\\/script')}\n</script>`,
    });

    html = this.prepareAssetPlaceholders(html);
    return html.trim();
  }

  /**
   * Replaces asset: attribute values with data-stw-asset placeholders for iframe hydration.
   * Avoids the browser fetching invalid asset: URLs before window.stw hydrates them.
   */
  public prepareAssetPlaceholders(html: string): string {
    let output = html.replace(
      ASSET_POSTER_PLACEHOLDER_PATTERN,
      'data-stw-asset=$1$2$1 data-stw-target-attr="poster"'
    );
    output = output.replace(ASSET_ATTR_PLACEHOLDER_PATTERN, 'data-stw-asset=$2$3$2');
    return output;
  }

  public static normalizeAssetPath(path: string): string {
    let trimmed = path.trim();
    if (trimmed.startsWith(WIDGET_ASSET_PREFIX)) {
      trimmed = trimmed.slice(WIDGET_ASSET_PREFIX.length);
    }
    return normalizePath(trimmed);
  }

  public static assetPathKey(vaultRelativePath: string): string {
    return `${WIDGET_ASSET_PREFIX}${normalizePath(vaultRelativePath)}`;
  }

  public extractAssetPaths(content: string): string[] {
    const paths = new Set<string>();
    for (const match of content.matchAll(WIDGET_ASSET_PATH_PATTERN)) {
      paths.add(WidgetBundler.normalizeAssetPath(match[1]));
    }
    return [...paths].sort();
  }

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

  public applyAssetPaths(html: string, assetUrls: Record<string, string>): string {
    if (Object.keys(assetUrls).length === 0) {
      return html;
    }

    return html.replace(WIDGET_ASSET_PATH_PATTERN, (match, pathPart: string) => {
      const replacement = assetUrls[match] ?? assetUrls[WidgetBundler.assetPathKey(pathPart)];
      return replacement ?? match;
    });
  }

  private async readProjectFile(absolutePath: string, projectPath: string): Promise<string | null> {
    const project = normalizePath(projectPath);
    const target = normalizePath(absolutePath);
    if (!isPathUnderPrefix(project, target)) {
      return null;
    }
    const file = this.plugin.app.vault.getFileByPath(absolutePath);
    if (!file) {
      return null;
    }
    return this.plugin.app.vault.read(file);
  }

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

  private async inlineResourceTags(params: {
    html: string;
    pattern: RegExp;
    projectPath: string;
    entryFile: string;
    wrap: (content: string) => string;
  }): Promise<string> {
    return this.replaceAsync(params.html, params.pattern, async (match, url: string) => {
      const resolved = this.resolveRelativePath(url, params.entryFile);
      if (!resolved) {
        return match;
      }

      const content = await this.readProjectFile(
        normalizePath(`${params.projectPath}/${resolved}`),
        params.projectPath
      );
      if (content === null) {
        return match;
      }

      return params.wrap(content);
    });
  }

  private async replaceAsync(
    input: string,
    pattern: RegExp,
    replacer: (match: string, captured: string) => Promise<string>
  ): Promise<string> {
    const flags = pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`;
    const globalPattern = new RegExp(pattern.source, flags);
    const parts: string[] = [];
    let lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = globalPattern.exec(input)) !== null) {
      parts.push(input.slice(lastIndex, match.index));
      parts.push(await replacer(match[0], match[1]));
      lastIndex = globalPattern.lastIndex;
    }

    parts.push(input.slice(lastIndex));
    return parts.join('');
  }
}
