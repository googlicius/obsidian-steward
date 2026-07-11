import type { Vault } from 'obsidian';
import type StewardPlugin from 'src/main';
import { logger } from 'src/utils/logger';
import { getBundledInternal } from 'src/utils/bundledInternals';
import type { ConversationRenderer } from 'src/services/ConversationRenderer/ConversationRenderer';
import { MAX_INLINE_ARCHIVED_OUTPUT_LINES } from './constants';

const { i18next } = getBundledInternal('i18n');

const SHELL_FILE_SUFFIX = '__shell';

const STREAM_MARKER_RE = /<!--stw-cli-stream(?:-hide)?-->/g;

const CLI_SHELL_FENCE_RE = /```(?:cli-model|cli-transcript)\s*\n[\s\S]*?\n```/;
const CLI_SHELL_FENCE_LANG_RE = /```(cli-model|cli-transcript)\s*\n([\s\S]*?)\n```/;

export interface HeadingRef {
  path: string;
  headingText: string;
}

export class ShellOutputArchiveService {
  constructor(private readonly plugin: StewardPlugin) {}

  private get vault(): Vault {
    return this.plugin.app.vault;
  }

  private get stewardFolder(): string {
    return this.plugin.settings.stewardFolder;
  }

  private get renderer(): ConversationRenderer {
    return this.plugin.conversationRenderer;
  }

  getShellOutputFilePath(conversationTitle: string): string {
    const sanitized = this.sanitizeTitle(conversationTitle);
    return `${this.stewardFolder}/Conversations/${sanitized}${SHELL_FILE_SUFFIX}.md`;
  }

  async appendSection(params: {
    conversationTitle: string;
    messageId: string;
    outputText: string;
  }): Promise<void> {
    const filePath = this.getShellOutputFilePath(params.conversationTitle);
    const section = `## ${params.messageId}\n\n${params.outputText}\n`;

    let file = this.vault.getFileByPath(filePath);
    if (!file) {
      const frontmatter = `---\nconversation_title: ${params.conversationTitle}\n---\n\n`;
      const dir = filePath.substring(0, filePath.lastIndexOf('/'));
      if (!(await this.vault.adapter.exists(dir))) {
        await this.vault.createFolder(dir);
      }
      file = await this.vault.create(filePath, frontmatter + section);
      return;
    }

    await this.vault.process(file, content => {
      return content.trimEnd() + '\n\n' + section;
    });
  }

  async archiveMessageOutput(params: {
    conversationTitle: string;
    messageId: string;
  }): Promise<HeadingRef | null> {
    try {
      const archivedFence = await this.extractFenceFromMessage(
        params.conversationTitle,
        params.messageId
      );

      if (!archivedFence) {
        logger.warn('ShellOutputArchive: no fence found for message', params.messageId);
        return null;
      }

      const lineCount = this.countFenceBodyLines(archivedFence);

      await this.appendSection({
        conversationTitle: params.conversationTitle,
        messageId: params.messageId,
        outputText: archivedFence,
      });

      const shellFilePath = this.getShellOutputFilePath(params.conversationTitle);
      const vaultRelativePath = shellFilePath;
      const stub = this.buildCalloutStub(vaultRelativePath, params.messageId, lineCount);

      await this.renderer.replaceMessageContent(params.conversationTitle, params.messageId, stub);

      return { path: vaultRelativePath, headingText: params.messageId };
    } catch (error) {
      logger.error('ShellOutputArchive: archiveMessageOutput failed:', error);
      return null;
    }
  }

  /**
   * Read a shell output section at the given heading
   */
  async readSection(filePath: string, headingText: string): Promise<string> {
    const section = await this.plugin.noteContentService.extractContentUnderHeading(
      filePath,
      headingText
    );
    if (!section) {
      return '';
    }

    const match = section.match(CLI_SHELL_FENCE_LANG_RE);
    return match ? match[2].trim() : section;
  }

  private async extractFenceFromMessage(
    conversationTitle: string,
    messageId: string
  ): Promise<string | null> {
    const message = await this.renderer.getMessageById(conversationTitle, messageId);
    if (!message) return null;

    const match = message.content.match(CLI_SHELL_FENCE_RE);
    if (!match) return null;

    return this.stripStreamMarkers(match[0]);
  }

  private countFenceBodyLines(fence: string): number {
    const match = fence.match(CLI_SHELL_FENCE_LANG_RE);
    if (!match) return 0;
    return match[2].split('\n').length;
  }

  private stripStreamMarkers(text: string): string {
    return text.replace(STREAM_MARKER_RE, '').trim();
  }

  private buildCalloutStub(
    vaultRelativePath: string,
    messageId: string,
    lineCount: number
  ): string {
    const intro = i18next.t('cli.shellTranscriptIntro');
    const commandOutput = i18next.t('common.commandOutput');
    const linesLabel = i18next.t('common.lines', { number: lineCount });
    const toggleText = `${commandOutput} (${linesLabel})`;
    const metadataHeader = `>[!stw-shell] output_file:${vaultRelativePath},output_anchor:${messageId},lines:${lineCount}`;

    if (lineCount > MAX_INLINE_ARCHIVED_OUTPUT_LINES) {
      const wikilinkPath = vaultRelativePath.replace(/\.md$/, '');
      return (
        `<small>*${intro}*</small>\n\n` +
        `${metadataHeader}\n` +
        `> [[${wikilinkPath}#${messageId}|${toggleText}]]\n`
      );
    }

    return (
      `<small>*${intro}*</small>\n\n` +
      `${metadataHeader}\n` +
      `> <a class="stw-toggle-block">${toggleText}</a>\n`
    );
  }

  private sanitizeTitle(rawTitle: string): string {
    const invalidChars = /[*"<>:\\/|?]/g;
    const collapsed = rawTitle.replace(invalidChars, '').replace(/\s+/g, ' ').trim();
    return collapsed.length > 0 ? collapsed : 'cli_interactive';
  }
}
