import { ToolName } from '../ToolRegistry';
import { ToolContentDelta } from 'src/utils/textStreamer';
import { PartialJsonFieldExtractor } from './SuperAgent/partialJsonFieldExtractor';
import { logger } from 'src/utils/logger';
import type { App } from 'obsidian';
import type { ConversationRenderer } from 'src/services/ConversationRenderer';
import type StewardPlugin from 'src/main';

export interface ToolContentStreamInfo {
  toolCallId: string;
  toolName: string;
  tempFilePath: string;
}

export interface ToolContentStreamConsumerHost {
  plugin: StewardPlugin;
  renderer: ConversationRenderer;
  obsidianAPITools: {
    ensureFolderExists(path: string): Promise<void>;
  };
  app: App;
}

export const TOOL_CONTENT_STREAM_CONSUMER_SYMBOL = Symbol('ToolContentStreamConsumer');

export interface ToolContentStreamConsumer {
  [TOOL_CONTENT_STREAM_CONSUMER_SYMBOL]: true;
  createToolContentExtractor(toolName: string): { feed: (delta: string) => string };
  consumeToolContentStream(params: {
    title: string;
    toolContentStream: AsyncGenerator<ToolContentDelta, void, unknown>;
    handlerId?: string;
    lang?: string | null;
  }): Promise<ToolContentStreamInfo | undefined>;
}

function asHost(instance: ToolContentStreamConsumer): ToolContentStreamConsumerHost {
  return instance as unknown as ToolContentStreamConsumerHost;
}

export class ToolContentStreamConsumer {
  public [TOOL_CONTENT_STREAM_CONSUMER_SYMBOL] = true as const;

  private get tmpFolderPath(): string {
    return `${asHost(this).plugin.settings.stewardFolder}/tmp`;
  }

  public createToolContentExtractor(toolName: string): { feed: (delta: string) => string } {
    if (toolName === ToolName.EDIT) {
      return new PartialJsonFieldExtractor('content', { requiredMode: 'replace_by_lines' });
    }
    return new PartialJsonFieldExtractor('content');
  }

  private async createTempStreamFile(toolCallId: string): Promise<string> {
    const host = asHost(this);
    const folderPath = this.tmpFolderPath;
    await host.obsidianAPITools.ensureFolderExists(folderPath);
    const filePath = `${folderPath}/stw_stream_${toolCallId}.md`;
    await host.app.vault.create(filePath, '');
    return filePath;
  }

  private async appendToTempFile(filePath: string, content: string): Promise<void> {
    const host = asHost(this);
    const file = host.app.vault.getFileByPath(filePath);
    if (!file) return;
    await host.app.vault.process(file, current => current + content);
  }

  public async deleteTempStreamFile(filePath: string): Promise<void> {
    const host = asHost(this);
    const file = host.app.vault.getFileByPath(filePath);
    if (file) {
      await host.app.vault.delete(file);
    }
  }

  public async cleanupTempFiles(): Promise<void> {
    const host = asHost(this);
    const folder = host.app.vault.getFolderByPath(this.tmpFolderPath);
    if (!folder) return;

    const files = folder.children.filter(f => f.name.startsWith('stw_stream_'));
    for (const file of files) {
      try {
        await host.app.vault.delete(file);
      } catch {
        // Ignore deletion errors during cleanup
      }
    }
  }

  public async consumeToolContentStream(params: {
    title: string;
    toolContentStream: AsyncGenerator<ToolContentDelta, void, unknown>;
    handlerId?: string;
    lang?: string | null;
  }): Promise<ToolContentStreamInfo | undefined> {
    const { title, toolContentStream, handlerId, lang } = params;
    const host = asHost(this);

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

          await host.renderer.updateConversationNote({
            path: title,
            newContent: host.plugin.noteContentService.formatCallout(
              `![[${tempFilePath}]]`,
              'stw-review',
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

export function isToolContentStreamConsumer(obj: unknown): obj is ToolContentStreamConsumer {
  return (
    typeof obj === 'object' &&
    obj !== null &&
    TOOL_CONTENT_STREAM_CONSUMER_SYMBOL in obj &&
    obj[TOOL_CONTENT_STREAM_CONSUMER_SYMBOL] === true
  );
}
