import { z } from 'zod/v3';
import { getBundledLib } from 'src/utils/bundledLibs';
import { normalizePath } from 'obsidian';
import { getBundledInternal } from 'src/utils/bundledInternals';
import type { AgentHandlerContext } from '../AgentHandlerContext';
import type { HandlerInvocationContext } from '../HandlerInvocationContext';
import { ToolCallPart } from '../../tools/types';
import { ArtifactType } from 'src/solutions/artifact';
import { DocWithPath } from 'src/types/types';
import { MoveOperation, OperationError } from 'src/tools/obsidianAPITools';
import { eventEmitter } from 'src/services/EventEmitter';
import { Events } from 'src/types/events';
import { AgentResult, IntentResultStatus } from '../../types';

const { getTranslation } = getBundledInternal('i18n');

const copyToolSchema = z
  .object({
    artifactId: z
      .string()
      .min(1)
      .optional()
      .describe('ID of the artifact containing the files to copy.'),
    files: z
      .array(
        z.object({
          path: z
            .string()
            .min(1)
            .describe('The full path (including extension) of the file to copy.'),
        })
      )
      .optional()
      .refine(array => !array || array.length > 0, {
        message: 'files array must include at least one entry when provided.',
      })
      .describe('Explicit list of files to copy.'),
    destinationFolder: z
      .string()
      .min(1)
      .describe('Destination folder path where the files should be copied.'),
  })
  .refine(data => Boolean(data.artifactId) || Boolean(data.files && data.files.length > 0), {
    message: 'Provide either artifactId or files.',
  });

export type CopyToolArgs = z.infer<typeof copyToolSchema>;

type CopyOperationResult = {
  copied: string[];
  skipped: string[];
  errors: OperationError[];
};

export class VaultCopy {
  constructor(private readonly agent: AgentHandlerContext) {}

  public extractPathsForGuardrails(input: CopyToolArgs): string[] {
    const paths: string[] = [normalizePath(input.destinationFolder)];
    if (input.files) {
      for (const f of input.files) {
        paths.push(normalizePath(f.path));
      }
    }
    return paths;
  }

  public static async getCopyTool() {
    const { tool } = await getBundledLib('ai');
    return tool({ inputSchema: copyToolSchema });
  }

  public async handle(
    ctx: HandlerInvocationContext,
    options: { toolCall: ToolCallPart<CopyToolArgs> }
  ): Promise<AgentResult> {
    const { toolCall } = options;
    const t = getTranslation(ctx.lang);

    const resolveResult = await this.resolveCopyDocs(ctx, toolCall);

    if (resolveResult.responseMessage) {
      return {
        status: IntentResultStatus.ERROR,
        error: new Error(resolveResult.responseMessage),
      };
    }

    const docs = resolveResult.docs;

    const destinationFolder = toolCall.input.destinationFolder.trim();
    if (!destinationFolder) {
      const message = t('copy.noDestination');
      const messageId = await ctx.updateConversationNote({
        newContent: message,
        command: 'vault_copy',
        includeHistory: false,
      });

      await ctx.serializeInvocation({
        command: 'vault_copy',
        toolCall,
        result: {
          type: 'text',
          value: messageId ? `messageRef:${messageId}` : message,
        },
      });
      return {
        status: IntentResultStatus.ERROR,
        error: new Error(message),
      };
    }

    const destinationFolderExists = Boolean(
      this.agent.app.vault.getFolderByPath(destinationFolder)
    );
    if (!destinationFolderExists) {
      const message = `${t('copy.createFoldersHeader')}\n- \`${destinationFolder}\`\n\n${t(
        'copy.createFoldersQuestion'
      )}`;
      const messageId = await ctx.updateConversationNote({
        newContent: message,
        command: 'vault_copy',
        includeHistory: false,
      });

      await ctx.serializeInvocation({
        command: 'vault_copy',
        toolCall,
        result: {
          type: 'text',
          value: messageId ? `messageRef:${messageId}` : message,
        },
      });
      return {
        status: IntentResultStatus.ERROR,
        error: new Error(message),
      };
    }

    if (!destinationFolderExists) {
      await this.agent.obsidianAPITools.ensureFolderExists(destinationFolder);
    }

    const copyResult = await this.executeCopyOperation({
      title: ctx.title,
      docs,
      destinationFolder,
      lang: ctx.lang,
    });

    const formattedMessage = this.formatCopyResult({
      result: copyResult,
      destinationFolder,
      lang: ctx.lang,
    });

    const resultMessageId = await ctx.updateConversationNote({
      newContent: formattedMessage,
      command: 'vault_copy',
    });

    await ctx.serializeInvocation({
      command: 'vault_copy',
      toolCall,
      result: {
        type: 'text',
        value: resultMessageId ? `messageRef:${resultMessageId}` : formattedMessage,
      },
    });

    return {
      status: IntentResultStatus.SUCCESS,
    };
  }

  private async resolveCopyDocs(
    ctx: HandlerInvocationContext,
    toolCall: ToolCallPart<CopyToolArgs>
  ): Promise<{ docs: DocWithPath[]; responseMessage?: string }> {
    const t = getTranslation(ctx.lang);

    const docs: DocWithPath[] = [];
    const noFilesMessage = t('common.noFilesFound');

    if (toolCall.input.artifactId) {
      const artifact = await this.agent.plugin.artifactManagerV2
        .withTitle(ctx.title)
        .getArtifactById(toolCall.input.artifactId);

      if (!artifact) {
        const message = t('common.noRecentOperations');
        const responseMessage = await this.respondAndSerializeCopy(ctx, {
          content: message,
          toolCall,
        });
        return { docs: [], responseMessage };
      }

      if (artifact.artifactType === ArtifactType.SEARCH_RESULTS) {
        for (const result of artifact.originalResults) {
          docs.push({ path: result.document.path });
        }
      } else if (artifact.artifactType === ArtifactType.CREATED_PATHS) {
        for (const path of artifact.paths) {
          docs.push({ path });
        }
      } else {
        const message = t('copy.cannotCopyThisType', { type: artifact.artifactType });
        const responseMessage = await this.respondAndSerializeCopy(ctx, {
          content: message,
          toolCall,
        });
        return { docs: [], responseMessage };
      }
    }

    if (toolCall.input.files) {
      for (const file of toolCall.input.files) {
        const trimmedPath = file.path.trim();
        if (trimmedPath) {
          docs.push({ path: trimmedPath });
        }
      }
    }

    if (docs.length === 0) {
      const responseMessage = await this.respondAndSerializeCopy(ctx, {
        content: noFilesMessage,
        toolCall,
      });
      return { docs: [], responseMessage };
    }

    return { docs };
  }

  private async respondAndSerializeCopy(
    ctx: HandlerInvocationContext,
    params: {
      content: string;
      toolCall: ToolCallPart<CopyToolArgs>;
    }
  ): Promise<string> {
    const { content, toolCall } = params;
    const messageId = await ctx.updateConversationNote({
      newContent: content,
      command: 'vault_copy',
      includeHistory: false,
    });

    await ctx.serializeInvocation({
      command: 'vault_copy',
      toolCall,
      result: {
        type: 'text',
        value: messageId ? `messageRef:${messageId}` : content,
      },
    });

    return content;
  }

  private async executeCopyOperation(params: {
    title: string;
    docs: DocWithPath[];
    destinationFolder: string;
    lang?: string | null;
  }): Promise<CopyOperationResult> {
    const { title, docs, destinationFolder, lang } = params;

    const moveOperations: MoveOperation[] = [
      {
        destinationFolder,
      },
    ];

    const filesByOperation = new Map<number, DocWithPath[]>();
    filesByOperation.set(0, docs);

    const result = await this.agent.obsidianAPITools.copyByOperations(
      moveOperations,
      filesByOperation
    );

    // Convert errors to strings for event emission (backward compatibility)
    eventEmitter.emit(Events.COPY_OPERATION_COMPLETED, {
      title,
      operations: result.operations.map(op => ({
        ...op,
        errors: op.errors.map(err => `${err.path}: ${err.message}`),
      })),
    });

    const copied: string[] = [];
    const skipped: string[] = [];
    const errors: OperationError[] = [];

    for (const operation of result.operations) {
      copied.push(...operation.copied);
      skipped.push(...operation.skipped);
      errors.push(...operation.errors);
    }

    if (copied.length === 0 && skipped.length === 0 && errors.length === 0) {
      const tInner = getTranslation(lang);
      errors.push({ path: '', message: tInner('copy.noSearchResultsFoundAbortCopy') });
    }

    return {
      copied,
      skipped,
      errors,
    };
  }

  private formatCopyResult(params: {
    result: CopyOperationResult;
    destinationFolder: string;
    lang?: string | null;
  }): string {
    const { result, destinationFolder, lang } = params;
    const { copied, skipped, errors } = result;
    const totalCount = copied.length + skipped.length + errors.length;

    const t = getTranslation(lang);
    let response = t('copy.foundFiles', { count: totalCount });
    response += `\n\n${t('copy.operation', { num: 1, folder: destinationFolder })}`;

    if (copied.length > 0) {
      response += `\n\n**${t('copy.successfullyCopied', { count: copied.length })}**`;
      for (const file of copied) {
        response += `\n- [[${file}]]`;
      }
    }

    if (skipped.length > 0) {
      response += `\n\n**${t('copy.skipped', { count: skipped.length })}**`;
      for (const file of skipped) {
        response += `\n- [[${file}]]`;
      }
    }

    if (errors.length > 0) {
      response += `\n\n**${t('copy.failed', { count: errors.length })}**`;
      for (const error of errors) {
        const errorString = error.path ? `${error.path}: ${error.message}` : error.message;
        response += `\n- ${errorString}`;
      }
    }

    return response;
  }
}
