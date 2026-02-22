import { ToolName } from '../../ToolRegistry';
import { ToolContentDelta } from 'src/utils/textStreamer';
import { PartialJsonFieldExtractor } from './partialJsonFieldExtractor';
import { logger } from 'src/utils/logger';
import type { SuperAgent } from '../SuperAgent';

export interface ToolContentStreamInfo {
  toolCallId: string;
  toolName: string;
  tempFilePath: string;
}

/**
 * Casts the mixin instance to SuperAgent.
 * Safe because SuperAgentToolContentStream is only used as a mixin for SuperAgent.
 */
function asSuperAgent(instance: SuperAgentToolContentStream): SuperAgent {
  return instance as unknown as SuperAgent;
}

export class SuperAgentToolContentStream {
  private get tmpFolderPath(): string {
    return `${asSuperAgent(this).plugin.settings.stewardFolder}/tmp`;
  }

  /**
   * Creates a PartialJsonFieldExtractor appropriate for the given tool.
   * Edit tool requires mode=replace_by_lines; create tool extracts content unconditionally.
   */
  public createToolContentExtractor(toolName: string): { feed: (delta: string) => string } {
    if (toolName === ToolName.EDIT) {
      return new PartialJsonFieldExtractor('content', { requiredMode: 'replace_by_lines' });
    }
    return new PartialJsonFieldExtractor('content');
  }

  /**
   * Creates a temporary streaming file and returns its vault path.
   */
  private async createTempStreamFile(toolCallId: string): Promise<string> {
    const agent = asSuperAgent(this);
    const folderPath = this.tmpFolderPath;
    await agent.obsidianAPITools.ensureFolderExists(folderPath);
    const filePath = `${folderPath}/stw_stream_${toolCallId}.md`;
    await agent.app.vault.create(filePath, '');
    return filePath;
  }

  /**
   * Appends content to a temporary streaming file.
   */
  private async appendToTempFile(filePath: string, content: string): Promise<void> {
    const file = asSuperAgent(this).app.vault.getFileByPath(filePath);
    if (!file) return;
    await asSuperAgent(this).app.vault.process(file, current => current + content);
  }

  /**
   * Deletes a temporary streaming file if it exists.
   */
  public async deleteTempStreamFile(filePath: string): Promise<void> {
    const file = asSuperAgent(this).app.vault.getFileByPath(filePath);
    if (file) {
      await asSuperAgent(this).app.vault.delete(file);
    }
  }

  /**
   * Cleans up all orphaned temp streaming files in the tmp folder.
   */
  public async cleanupTempFiles(): Promise<void> {
    const folder = asSuperAgent(this).app.vault.getFolderByPath(this.tmpFolderPath);
    if (!folder) return;

    const files = folder.children.filter(f => f.name.startsWith('stw_stream_'));
    for (const file of files) {
      try {
        await asSuperAgent(this).app.vault.delete(file);
      } catch {
        // Ignore deletion errors during cleanup
      }
    }
  }

  /**
   * Consumes the toolContentStream in background: creates a temp file on first delta,
   * renders a preview callout with an embed, and appends subsequent deltas.
   * Returns a promise that resolves with the stream info when consumption is done.
   */
  public async consumeToolContentStream(params: {
    title: string;
    toolContentStream: AsyncGenerator<ToolContentDelta, void, unknown>;
    handlerId?: string;
    lang?: string | null;
  }): Promise<ToolContentStreamInfo | undefined> {
    const { title, toolContentStream, handlerId, lang } = params;
    const agent = asSuperAgent(this);

    try {
      let info: ToolContentStreamInfo | undefined;

      for await (const delta of toolContentStream) {
        if (!info) {
          const tempFilePath = await this.createTempStreamFile(delta.toolCallId);
          info = {
            toolCallId: delta.toolCallId,
            toolName: delta.toolName,
            tempFilePath,
          };

          await agent.renderer.updateConversationNote({
            path: title,
            newContent: agent.plugin.noteContentService.formatCallout(
              `![[${tempFilePath}]]`,
              'stw-edit-preview',
              { streaming: 'true' }
            ),
            handlerId,
            includeHistory: false,
            lang,
          });
        }

        await this.appendToTempFile(info.tempFilePath, delta.contentDelta);
      }

      return info;
    } catch (err) {
      logger.error('Error consuming tool content stream:', err);
      return undefined;
    }
  }
}
