import { tool } from 'ai';
import { z } from 'zod/v3';
import { getTranslation } from 'src/i18n';
import { type SuperAgent } from '../SuperAgent';
import { ToolCallPart } from '../../tools/types';
import { ArtifactType } from 'src/solutions/artifact';
import { DocWithPath } from 'src/types/types';
import { MoveOperationV2, OperationError } from 'src/tools/obsidianAPITools';
import { eventEmitter } from 'src/services/EventEmitter';
import { Events } from 'src/types/events';
import { AgentHandlerParams, AgentResult, IntentResultStatus } from '../../types';

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
    explanation: z
      .string()
      .min(1)
      .describe('Short explanation of the copy operation and why it is required.'),
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
  private static readonly copyTool = tool({ inputSchema: copyToolSchema });

  constructor(private readonly agent: SuperAgent) {}

  public static getCopyTool() {
    return VaultCopy.copyTool;
  }

  public async handle(
    params: AgentHandlerParams,
    options: { toolCall: ToolCallPart<CopyToolArgs> }
  ): Promise<AgentResult> {
    const { title, lang, handlerId } = params;
    const { toolCall } = options;
    const t = getTranslation(lang);

    if (!handlerId) {
      throw new Error('VaultCopy.handle invoked without handlerId');
    }

    await this.agent.renderer.updateConversationNote({
      path: title,
      newContent: toolCall.input.explanation,
      command: 'vault_copy',
      includeHistory: false,
      lang,
      handlerId,
    });

    const resolveResult = await this.resolveCopyDocs({
      title,
      toolCall,
      lang,
      handlerId,
    });

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
      const messageId = await this.agent.renderer.updateConversationNote({
        path: title,
        newContent: message,
        command: 'vault_copy',
        lang,
        handlerId,
        includeHistory: false,
      });

      await this.agent.serializeInvocation({
        command: 'vault_copy',
        title,
        handlerId,
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
      const messageId = await this.agent.renderer.updateConversationNote({
        path: title,
        newContent: message,
        command: 'vault_copy',
        lang,
        handlerId,
        includeHistory: false,
      });

      await this.agent.serializeInvocation({
        command: 'vault_copy',
        title,
        handlerId,
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
      title,
      docs,
      destinationFolder,
      explanation: toolCall.input.explanation,
      lang,
    });

    const formattedMessage = this.formatCopyResult({
      result: copyResult,
      destinationFolder,
      explanation: toolCall.input.explanation,
      lang,
    });

    const resultMessageId = await this.agent.renderer.updateConversationNote({
      path: title,
      newContent: formattedMessage,
      command: 'vault_copy',
      lang,
      handlerId,
    });

    await this.agent.serializeInvocation({
      command: 'vault_copy',
      title,
      handlerId,
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

  private async resolveCopyDocs(params: {
    title: string;
    toolCall: ToolCallPart<CopyToolArgs>;
    lang?: string | null;
    handlerId: string;
  }): Promise<{ docs: DocWithPath[]; responseMessage?: string }> {
    const { title, toolCall, lang, handlerId } = params;
    const t = getTranslation(lang);

    const docs: DocWithPath[] = [];
    const noFilesMessage = t('common.noFilesFound');

    if (toolCall.input.artifactId) {
      const artifact = await this.agent.plugin.artifactManagerV2
        .withTitle(title)
        .getArtifactById(toolCall.input.artifactId);

      if (!artifact) {
        const message = t('common.noRecentOperations');
        const responseMessage = await this.respondAndSerializeCopy({
          title,
          content: message,
          toolCall,
          lang,
          handlerId,
        });
        return { docs: [], responseMessage };
      }

      if (artifact.artifactType === ArtifactType.SEARCH_RESULTS) {
        for (const result of artifact.originalResults) {
          docs.push({ path: result.document.path });
        }
      } else if (artifact.artifactType === ArtifactType.CREATED_NOTES) {
        for (const path of artifact.paths) {
          docs.push({ path });
        }
      } else {
        const message = t('copy.cannotCopyThisType', { type: artifact.artifactType });
        const responseMessage = await this.respondAndSerializeCopy({
          title,
          content: message,
          toolCall,
          lang,
          handlerId,
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
      const responseMessage = await this.respondAndSerializeCopy({
        title,
        content: noFilesMessage,
        toolCall,
        lang,
        handlerId,
      });
      return { docs: [], responseMessage };
    }

    return { docs };
  }

  private async respondAndSerializeCopy(params: {
    title: string;
    content: string;
    toolCall: ToolCallPart<CopyToolArgs>;
    lang?: string | null;
    handlerId: string;
  }): Promise<string> {
    const { title, content, toolCall, lang, handlerId } = params;
    const messageId = await this.agent.renderer.updateConversationNote({
      path: title,
      newContent: content,
      command: 'vault_copy',
      lang,
      handlerId,
      includeHistory: false,
    });

    await this.agent.serializeInvocation({
      command: 'vault_copy',
      title,
      handlerId,
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
    explanation: string;
    lang?: string | null;
  }): Promise<CopyOperationResult> {
    const { title, docs, destinationFolder, explanation, lang } = params;

    const moveOperations: MoveOperationV2[] = [
      {
        keywords: [explanation],
        filenames: [],
        folders: [],
        destinationFolder,
        properties: [],
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
      const t = getTranslation(lang);
      errors.push({ path: '', message: t('copy.noSearchResultsFoundAbortCopy') });
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
    explanation: string;
    lang?: string | null;
  }): string {
    const { result, destinationFolder, explanation, lang } = params;
    const { copied, skipped, errors } = result;
    const totalCount = copied.length + skipped.length + errors.length;

    const t = getTranslation(lang);
    let response = t('copy.foundFiles', { count: totalCount });
    response += `\n\n${t('copy.operation', { num: 1, query: explanation, folder: destinationFolder })}`;

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
