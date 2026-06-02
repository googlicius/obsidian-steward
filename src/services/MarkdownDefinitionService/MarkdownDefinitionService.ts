import { dump as yamlDump } from 'js-yaml';
import { parseYaml, SectionCache, TFile } from 'obsidian';
import type StewardPlugin from 'src/main';
import type { ParsedYamlFenceBlock, YamlFenceReplacement } from './types';

const YAML_OPENING_FENCE_PATTERN = /^```(?:ya?ml)(?:\s|$)/i;

/** Serializes a plain object as YAML for fenced blocks. */
export function stringifyYamlFence(data: Record<string, unknown>): string {
  return yamlDump(data, {
    lineWidth: -1,
    noRefs: true,
    sortKeys: false,
  });
}

/**
 * Shared service for walking markdown YAML code fences via Obsidian's section cache.
 */
export class MarkdownDefinitionService {
  private static instance: MarkdownDefinitionService | null = null;

  private constructor(private plugin: StewardPlugin) {}

  public static getInstance(plugin?: StewardPlugin): MarkdownDefinitionService {
    if (plugin) {
      MarkdownDefinitionService.instance = new MarkdownDefinitionService(plugin);
      return MarkdownDefinitionService.instance;
    }

    if (!MarkdownDefinitionService.instance) {
      throw new Error('MarkdownDefinitionService must be initialized with a plugin');
    }

    return MarkdownDefinitionService.instance;
  }

  /** Formats inner YAML as a standard ```yaml fence block. */
  public buildYamlFence(inner: string): string {
    return ['```yaml', inner.trimEnd(), '```'].join('\n');
  }

  /**
   * Walk Obsidian section cache and collect YAML fence blocks matching `isMatch`.
   */
  public collectYamlBlocks(params: {
    file: TFile;
    content: string;
    isMatch: (data: Record<string, unknown>) => boolean;
    walkState?: unknown;
    onHeadingSection?: (params: {
      section: SectionCache;
      lines: string[];
      walkState: unknown;
    }) => void;
    shouldSkipCodeSection?: (walkState: unknown) => boolean;
    onBlockMatched?: (block: ParsedYamlFenceBlock, walkState: unknown) => void;
  }): ParsedYamlFenceBlock[] {
    const cache = this.plugin.app.metadataCache.getFileCache(params.file);
    if (!cache?.sections) {
      return [];
    }

    const lines = params.content.split('\n');
    const matchedBlocks: ParsedYamlFenceBlock[] = [];

    for (const section of cache.sections) {
      if (section.type === 'heading') {
        if (params.onHeadingSection) {
          params.onHeadingSection({
            section,
            lines,
            walkState: params.walkState,
          });
        }
        continue;
      }

      if (section.type !== 'code') {
        continue;
      }

      if (params.shouldSkipCodeSection?.(params.walkState)) {
        continue;
      }

      const parsedBlock = this.parseYamlFenceSection(lines, section);
      if (!parsedBlock) {
        continue;
      }

      if (!params.isMatch(parsedBlock.data)) {
        continue;
      }

      matchedBlocks.push(parsedBlock);
      params.onBlockMatched?.(parsedBlock, params.walkState);
    }

    return matchedBlocks;
  }

  /**
   * Collect every YAML fence block in a note, including parse failures for yaml fences.
   */
  public collectAllYamlBlocks(params: { file: TFile; content: string }): {
    blocks: ParsedYamlFenceBlock[];
    parseErrors: Array<{ line: number; message: string }>;
  } {
    const cache = this.plugin.app.metadataCache.getFileCache(params.file);
    if (!cache?.sections) {
      return { blocks: [], parseErrors: [] };
    }

    const lines = params.content.split('\n');
    const blocks: ParsedYamlFenceBlock[] = [];
    const parseErrors: Array<{ line: number; message: string }> = [];

    for (let i = 0; i < cache.sections.length; i++) {
      const section = cache.sections[i];
      if (section.type !== 'code') {
        continue;
      }

      const startLine = section.position.start.line;
      const openingFence = lines[startLine]?.trim() ?? '';
      if (!YAML_OPENING_FENCE_PATTERN.test(openingFence)) {
        continue;
      }

      const parsedBlock = this.parseYamlFenceSection(lines, section);
      if (!parsedBlock) {
        parseErrors.push({
          line: startLine + 1,
          message: 'invalid or unparsable YAML',
        });
        continue;
      }

      blocks.push(parsedBlock);
    }

    return { blocks, parseErrors };
  }

  /** Replaces inner YAML for one or more fence blocks (bottom-up to preserve line indices). */
  public replaceYamlFenceContents(content: string, replacements: YamlFenceReplacement[]): string {
    const lines = content.split('\n');
    const sortedReplacements = [...replacements].sort(
      (a, b) => b.block.startLine - a.block.startLine
    );

    for (const replacement of sortedReplacements) {
      lines.splice(
        replacement.block.startLine,
        replacement.block.endLine - replacement.block.startLine + 1,
        '```yaml',
        ...replacement.newInner.trimEnd().split('\n'),
        '```'
      );
    }

    return lines.join('\n');
  }

  private parseYamlFenceSection(
    lines: string[],
    section: SectionCache
  ): ParsedYamlFenceBlock | null {
    const startLine = section.position.start.line;
    const endLine = section.position.end.line;
    const openingFence = lines[startLine]?.trim() ?? '';
    if (!YAML_OPENING_FENCE_PATTERN.test(openingFence)) {
      return null;
    }

    const yamlBlock = {
      startLine,
      endLine,
      content: lines.slice(startLine + 1, endLine).join('\n'),
    };

    let parsed: unknown;
    try {
      parsed = parseYaml(yamlBlock.content);
    } catch {
      return null;
    }

    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return null;
    }

    return {
      ...yamlBlock,
      data: parsed as Record<string, unknown>,
    };
  }
}
