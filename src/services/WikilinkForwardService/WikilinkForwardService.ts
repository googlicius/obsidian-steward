import type StewardPlugin from 'src/main';
import { TWO_SPACES_PREFIX } from 'src/constants';
import { logger } from 'src/utils/logger';
import { TFile } from 'obsidian';

/** Conversation notes whose basename begins with this prefix are CLI interactive terminals. */
const CLI_INTERACTIVE_PREFIX = 'cli_interactive';

/** Frontmatter keys that declare a forwarding target. `continued_to` wins over `forwarded_to` when both exist. */
const FORWARD_KEYS = ['continued_to', 'forwarded_to'] as const;

/** Max hops when following a chain of `forwarded_to` / `continued_to` (cycle + depth guard). */
const MAX_FORWARD_CHAIN_HOPS = 16;

export interface SetForwardedToParams {
  sourceConversationTitle: string;
  targetConversationTitle: string;
  /** Frontmatter key to set. Defaults to `forwarded_to`. */
  key?: (typeof FORWARD_KEYS)[number];
}

/**
 * Primitives for conversation-forward resolution (`continued_to` / `forwarded_to`)
 * and the `/ ` input-line rule, scoped to notes under `${stewardFolder}/Conversations`.
 *
 * When {@link registerEvents} is called, the service watches `metadataCache.changed` and
 * automatically rewrites `![[source]]` embeds to `![[target]]` in files that reference
 * the source note. Callers only need to set the forward frontmatter (via
 * {@link setForwardedTo}); the rewrite happens on the resulting metadata change event.
 */
export class WikilinkForwardService {
  /** Tracks the last observed forward target per source path so we only rewrite on transitions. */
  private readonly lastSeenForwardTarget = new Map<string, string | null>();
  private eventsRegistered = false;

  constructor(private readonly plugin: StewardPlugin) {}

  private get conversationsFolder(): string {
    return `${this.plugin.settings.stewardFolder}/Conversations`;
  }

  /**
   * Register the `metadataCache.changed` listener. Safe to call multiple times — subsequent
   * invocations are no-ops. Should be invoked from {@link StewardPlugin.onload}.
   */
  public registerEvents(): void {
    if (this.eventsRegistered) {
      return;
    }
    this.eventsRegistered = true;
    this.plugin.registerEvent(
      this.plugin.app.metadataCache.on('changed', file => {
        this.handleMetadataChanged(file);
      })
    );
  }

  /** Vault path (no `.md`) for the given conversation title under the Steward folder. */
  public getConversationEmbedPath(conversationTitle: string): string {
    const sanitized = conversationTitle.replace(/\.md$/, '');
    return `${this.conversationsFolder}/${sanitized}`;
  }

  /**
   * Get the conversation `TFile` for a title or full path, returning null if the
   * file is missing or does not live under `Steward/Conversations`.
   */
  public getConversationFile(titleOrPath: string): TFile | null {
    if (!titleOrPath || titleOrPath.trim().length === 0) {
      return null;
    }
    const normalized = titleOrPath.replace(/\.md$/, '');

    const direct = normalized.includes('/')
      ? this.plugin.app.vault.getFileByPath(`${normalized}.md`)
      : null;
    if (direct) {
      return this.isUnderConversationsFolder(direct) ? direct : null;
    }

    const asTitlePath = `${this.conversationsFolder}/${normalized.split('/').pop()}.md`;
    const byTitle = this.plugin.app.vault.getFileByPath(asTitlePath);
    return byTitle ?? null;
  }

  private isUnderConversationsFolder(file: TFile): boolean {
    return file.path.startsWith(`${this.conversationsFolder}/`);
  }

  /**
   * Read the forwarding frontmatter on `sourceConversationTitle` and return the target
   * conversation title if any. `continued_to` takes precedence over `forwarded_to`.
   * Values are plain title strings (see {@link setForwardedTo}).
   *
   * Returns null when no forward target exists or when the note is missing / outside scope.
   */
  public resolveForwardedConversationTitle(sourceConversationTitle: string): string | null {
    const sourceFile = this.getConversationFile(sourceConversationTitle);
    if (!sourceFile) {
      return null;
    }
    return this.resolveForwardedTitleForFile(sourceFile);
  }

  /**
   * Single-hop: next note title, or null when none.
   * Multi-hop: follow that chain until there is no next forward, a cycle appears, or
   * {@link MAX_FORWARD_CHAIN_HOPS} is reached — return the last title in the chain.
   *
   * If `startConversationTitle` is missing/empty or the start file is not found, returns
   * the trimmed start string (possibly empty), matching “no embed rewrite” behavior at call sites.
   */
  public resolveForwardedChainTerminalTitle(startConversationTitle: string): string {
    let current = startConversationTitle.trim();
    if (!current) {
      return '';
    }

    const visited = new Set<string>();
    for (let hop = 0; hop < MAX_FORWARD_CHAIN_HOPS; hop++) {
      if (visited.has(current)) {
        break;
      }
      visited.add(current);
      const next = this.resolveForwardedConversationTitle(current);
      if (!next) {
        break;
      }
      current = next;
    }
    return current;
  }

  private resolveForwardedTitleForFile(sourceFile: TFile): string | null {
    const frontmatter = this.plugin.app.metadataCache.getFileCache(sourceFile)?.frontmatter;
    if (!frontmatter) {
      return null;
    }

    for (const key of FORWARD_KEYS) {
      const value = frontmatter[key];
      if (typeof value !== 'string') {
        continue;
      }
      const title = value.trim();
      if (title.length > 0) {
        return title;
      }
    }

    return null;
  }

  /**
   * Whether a command-input line (`/ `) should appear below a conversation embed for
   * the given target. Returns false when the target's basename starts with `cli_interactive`
   * or its frontmatter declares a `trigger` key (any value).
   */
  public shouldAppendInputLineForConversation(targetConversationTitle: string): boolean {
    const file = this.getConversationFile(targetConversationTitle);
    if (!file) {
      return true;
    }
    if (file.basename.startsWith(CLI_INTERACTIVE_PREFIX)) {
      return false;
    }
    const frontmatter = this.plugin.app.metadataCache.getFileCache(file)?.frontmatter;
    if (frontmatter && Object.prototype.hasOwnProperty.call(frontmatter, 'trigger')) {
      return false;
    }
    return true;
  }

  /**
   * Write a forwarding frontmatter key (defaults to `forwarded_to`) on the source
   * conversation note, pointing at the given target as a wiki-link. The resulting
   * metadata change triggers the automatic embed rewrite via {@link registerEvents}.
   *
   * Any existing forward keys on the target note are cleared as part of the same call,
   * because the target is the new terminus of the forward chain — leaving a stale
   * `forwarded_to` on it would re-route embeds back and create a redirect loop after
   * the next metadata refresh (or plugin reload).
   */
  public async setForwardedTo(params: SetForwardedToParams): Promise<void> {
    const sourceFile = this.getConversationFile(params.sourceConversationTitle);
    if (!sourceFile) {
      logger.warn('WikilinkForwardService.setForwardedTo: source not found', {
        source: params.sourceConversationTitle,
      });
      return;
    }
    const key = params.key ?? 'forwarded_to';
    await this.plugin.app.fileManager.processFrontMatter(sourceFile, frontmatter => {
      (frontmatter as Record<string, unknown>)[key] = params.targetConversationTitle;
    });

    const targetFile = this.getConversationFile(params.targetConversationTitle);
    if (targetFile && targetFile.path !== sourceFile.path) {
      await this.clearForwardFrontmatter(targetFile);
    }
  }

  private async clearForwardFrontmatter(file: TFile): Promise<void> {
    await this.plugin.app.fileManager.processFrontMatter(file, frontmatter => {
      const record = frontmatter as Record<string, unknown>;
      for (const key of FORWARD_KEYS) {
        delete record[key];
      }
    });
    this.lastSeenForwardTarget.set(file.path, null);
  }

  private handleMetadataChanged(file: TFile): void {
    if (!this.isUnderConversationsFolder(file)) {
      return;
    }

    const currentTarget = this.resolveForwardedTitleForFile(file);
    const previousTarget = this.lastSeenForwardTarget.get(file.path) ?? null;
    if (currentTarget === previousTarget) {
      return;
    }
    this.lastSeenForwardTarget.set(file.path, currentTarget);

    if (!currentTarget) {
      return;
    }

    try {
      this.rewriteEmbedInActiveEditor({
        sourceTitle: file.basename,
        targetTitle: currentTarget,
      });
    } catch (error) {
      logger.error('WikilinkForwardService.handleMetadataChanged failed:', error);
    }
  }

  /**
   * Rewrite `![[sourceTitle]]` → `![[targetTitle]]` in the currently active editor
   * (`plugin.editor`). In practice the only place conversation embeds live is the
   * Steward chat view, which is always the active markdown editor when forwarding
   * kicks in, so a single editor pass is sufficient — and it avoids both stale
   * backlink-index reads and expensive full-vault sweeps.
   */
  private rewriteEmbedInActiveEditor(params: { sourceTitle: string; targetTitle: string }): void {
    const editor = this.plugin.editor;
    if (!editor) {
      return;
    }
    const transformed = this.replaceEmbed({
      content: editor.getValue(),
      sourceTitle: params.sourceTitle,
      targetTitle: params.targetTitle,
      addInputBelow: this.shouldAppendInputLineForConversation(params.targetTitle),
    });
    if (transformed.didReplace) {
      editor.setValue(transformed.updatedContent);
    }
  }

  /**
   * Replace the first `![[...sourceTitle...]]` embed in `content` with an embed pointing at
   * `targetTitle`.
   *
   * When `addInputBelow` is true, ensures a `/ ` input line follows the embed (kept if
   * already present). When false, strips any existing trailing `/ ` input line together
   * with its two-space-indented continuation lines — this is the behavior used when
   * forwarding into a terminal or trigger note that should not display a user prompt.
   */
  private replaceEmbed(params: {
    content: string;
    sourceTitle: string;
    targetTitle: string;
    addInputBelow?: boolean;
  }): { updatedContent: string; didReplace: boolean } {
    const escapedSource = this.escapeRegExp(params.sourceTitle);
    const escapedFolder = this.escapeRegExp(this.plugin.settings.stewardFolder);
    const pattern = new RegExp(
      `!\\[\\[(?:${escapedFolder}\\/Conversations\\/)?${escapedSource}(?:\\.md)?\\]\\]`
    );
    const match = pattern.exec(params.content);
    if (!match || typeof match.index !== 'number') {
      return { updatedContent: params.content, didReplace: false };
    }

    const replacementEmbed = `![[${this.getConversationEmbedPath(params.targetTitle)}]]`;
    const embedStart = match.index;
    const embedEnd = match.index + match[0].length;
    const before = params.content.slice(0, embedStart);

    if (!params.addInputBelow) {
      const removeEnd = this.findTrailingInputBlockEnd(params.content, embedEnd);
      const after = params.content.slice(removeEnd);
      return { updatedContent: `${before}${replacementEmbed}${after}`, didReplace: true };
    }

    const after = params.content.slice(embedEnd);
    const trimmedAfterStart = after.trimStart();
    if (trimmedAfterStart.startsWith('/')) {
      return { updatedContent: `${before}${replacementEmbed}${after}`, didReplace: true };
    }

    return {
      updatedContent: `${before}${replacementEmbed}\n\n/ ${after}`,
      didReplace: true,
    };
  }

  /**
   * Starting at `embedEnd`, skip trailing whitespace, then — if the following line starts
   * with `/` — consume that line plus any subsequent lines prefixed with two spaces (the
   * continuation syntax for multiline command input). Returns the index at which the
   * input block ends, or `embedEnd` when no trailing input block is present.
   */
  private findTrailingInputBlockEnd(content: string, embedEnd: number): number {
    let cursor = embedEnd;
    while (cursor < content.length) {
      const char = content.charAt(cursor);
      if (char !== '\n' && char !== '\r' && char !== ' ' && char !== '\t') {
        break;
      }
      cursor += 1;
    }

    const lineStart = cursor;
    if (lineStart >= content.length || content.charAt(lineStart) !== '/') {
      return embedEnd;
    }

    const firstLineBreak = content.indexOf('\n', lineStart);
    let removeEnd = firstLineBreak === -1 ? content.length : firstLineBreak + 1;

    while (removeEnd < content.length) {
      const nextLineEndRaw = content.indexOf('\n', removeEnd);
      const nextLineEnd = nextLineEndRaw === -1 ? content.length : nextLineEndRaw;
      const rawLine = content.slice(removeEnd, nextLineEnd).replace(/\r$/, '');
      if (!rawLine.startsWith(TWO_SPACES_PREFIX)) {
        break;
      }
      removeEnd = nextLineEndRaw === -1 ? nextLineEnd : nextLineEnd + 1;
    }

    return removeEnd;
  }

  private escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
}
