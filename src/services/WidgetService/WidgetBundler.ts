import { normalizePath } from 'obsidian';
import type StewardPlugin from 'src/main';
import type { WidgetBundlerAssetData, WidgetManifestAsset } from './types';

const LINK_HREF_PATTERN = /<link\b[^>]*\bhref\s*=\s*["']([^"']+)["'][^>]*>/gi;
const SCRIPT_SRC_PATTERN = /<script\b[^>]*\bsrc\s*=\s*["']([^"']+)["'][^>]*>\s*<\/script>/gi;

/**
 * Inlines local CSS/JS from a widget project folder into a single HTML document for sandboxed iframe srcdoc.
 */
export class WidgetBundler {
  constructor(private readonly plugin: StewardPlugin) {}

  /**
   * Reads the entry HTML, inlines linked stylesheets and scripts, and applies manifest asset placeholders.
   */
  public async bundle(params: {
    projectPath: string;
    entryRelativePath: string;
    assetData: WidgetBundlerAssetData;
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

    const injectionScript = this.buildDataInjectionScript(params.assetData.globals);
    if (injectionScript) {
      if (/<head[\s>]/i.test(html)) {
        html = html.replace(/<head([\s>])/i, `<head$1${injectionScript}`);
      } else if (/<html[\s>]/i.test(html)) {
        html = html.replace(/<html([\s>])/i, `<html$1<head>${injectionScript}</head>`);
      } else {
        html = `${injectionScript}${html}`;
      }
    }

    html = this.applyDataUrlPlaceholders(html, params.assetData.dataUrls);
    return html.trim();
  }

  /** Converts tool asset bindings into manifest.json asset entries. */
  public static manifestAssetsFromBindings(
    bindings: Array<{
      key: string;
      source: string;
      inject: WidgetManifestAsset['inject'];
      globalName?: string;
    }>
  ): Record<string, WidgetManifestAsset> {
    const assets: Record<string, WidgetManifestAsset> = {};
    for (let i = 0; i < bindings.length; i++) {
      const binding = bindings[i];
      assets[binding.key] = {
        source: binding.source.startsWith('vault:') ? binding.source : `vault:${binding.source}`,
        inject: binding.inject,
        globalName: binding.globalName,
      };
    }
    return assets;
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

  private buildDataInjectionScript(globals: Record<string, unknown>): string {
    if (Object.keys(globals).length === 0) {
      return '';
    }

    const serialized = JSON.stringify(globals);
    return `<script>window.__WIDGET_DATA__ = Object.assign(window.__WIDGET_DATA__ || {}, ${serialized});</script>`;
  }

  private applyDataUrlPlaceholders(html: string, dataUrls: Record<string, string>): string {
    let result = html;
    const keys = Object.keys(dataUrls);
    for (let i = 0; i < keys.length; i++) {
      const key = keys[i];
      const placeholder = `{{widget-asset:${key}}}`;
      result = result.split(placeholder).join(dataUrls[key]);
    }
    return result;
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
