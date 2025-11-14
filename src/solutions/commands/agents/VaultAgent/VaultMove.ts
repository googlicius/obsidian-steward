import { tool } from 'ai';
import { z } from 'zod';
import { getTranslation } from 'src/i18n';
import type VaultAgent from './VaultAgent';
import { ArtifactType } from 'src/solutions/artifact';
import { DocWithPath } from 'src/types/types';
import { MoveOperationV2 } from 'src/tools/obsidianAPITools';
import { ToolInvocation } from '../../tools/types';
import { eventEmitter } from 'src/services/EventEmitter';
import { Events } from 'src/types/events';
import { AgentHandlerParams, AgentResult, IntentResultStatus } from '../../types';

const moveToolSchema = z
  .object({
    artifactId: z
      .string()
      .min(1)
      .optional()
      .describe('ID of the artifact containing the files to move.'),
    files: z
      .array(
        z.object({
          path: z
            .string()
            .min(1)
            .describe('The full path (including extension) of the file to move.'),
        })
      )
      .optional()
      .refine(array => !array || array.length > 0, {
        message: 'files array must include at least one entry when provided.',
      })
      .describe('Explicit list of files to move.'),
    destinationFolder: z
      .string()
      .min(1)
      .describe('Destination folder path where the files should be moved.'),
    explanation: z
      .string()
      .min(1)
      .describe('Short explanation of the move operation and why it is required.'),
  })
  .refine(data => Boolean(data.artifactId) || Boolean(data.files && data.files.length > 0), {
    message: 'Provide either artifactId or files.',
  });

export type MoveToolArgs = z.infer<typeof moveToolSchema>;

type MoveOperationResult = {
  moved: string[];
  skipped: string[];
  errors: string[];
};

export class VaultMove {
  private static readonly moveTool = tool({ parameters: moveToolSchema });

  constructor(private readonly agent: VaultAgent) {}

  public static getMoveTool() {
    return VaultMove.moveTool;
  }

  public async handle(
    params: AgentHandlerParams,
    options: { toolCall: ToolInvocation<unknown, MoveToolArgs> }
  ): Promise<AgentResult> {
    const { title, lang } = params;
    const handlerId = params.handlerId;
    const { toolCall } = options;

    if (!handlerId) {
      throw new Error('VaultMove.handle invoked without handlerId');
    }

    const t = getTranslation(lang);

    await this.agent.renderer.updateConversationNote({
      path: title,
      newContent: toolCall.args.explanation,
      agent: 'vault',
      command: 'vault_move',
      includeHistory: false,
      lang,
      handlerId,
    });

    const resolveResult = await this.resolveMoveDocs({
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
    const destinationFolder = toolCall.args.destinationFolder.trim();

    if (!destinationFolder) {
      const message = t('move.destinationRequired');
      await this.respondAndSerializeMove({
        title,
        content: message,
        toolCall,
        lang,
        handlerId,
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
      const message = `${t('move.createFoldersHeader')}\n- \`${destinationFolder}\`\n\n${t(
        'move.createFoldersQuestion'
      )}`;

      await this.respondAndSerializeMove({
        title,
        content: message,
        toolCall,
        lang,
        handlerId,
      });

      return {
        status: IntentResultStatus.NEEDS_CONFIRMATION,
        confirmationMessage: message,
        onConfirmation: async (_confirmationMessage: string) => {
          await this.agent.obsidianAPITools.ensureFolderExists(toolCall.args.destinationFolder);
          return this.handle(params, options);
        },
        onRejection: async (_rejectionMessage: string) => {
          const cancellationMessage = t('confirmation.operationCancelled');
          await this.respondAndSerializeMove({
            title,
            content: cancellationMessage,
            toolCall,
            lang,
            handlerId,
          });
          return {
            status: IntentResultStatus.SUCCESS,
          };
        },
      };
    }

    const moveResult = await this.executeMoveOperation({
      title,
      docs,
      destinationFolder,
      explanation: toolCall.args.explanation,
      lang,
    });

    const formattedMessage = this.formatMoveResult({
      result: moveResult,
      destinationFolder,
      explanation: toolCall.args.explanation,
      lang,
    });

    const messageId = await this.agent.renderer.updateConversationNote({
      path: title,
      newContent: formattedMessage,
      agent: 'vault',
      command: 'vault_move',
      lang,
      handlerId,
    });

    await this.serializeMoveInvocation({
      title,
      handlerId,
      toolCall,
      result: messageId ? `messageRef:${messageId}` : formattedMessage,
    });

    return {
      status: IntentResultStatus.SUCCESS,
    };
  }

  private async resolveMoveDocs(params: {
    title: string;
    toolCall: ToolInvocation<unknown, MoveToolArgs>;
    lang?: string | null;
    handlerId: string;
  }): Promise<{ docs: DocWithPath[]; responseMessage?: string }> {
    const { title, toolCall, lang, handlerId } = params;
    const args = toolCall.args;
    const t = getTranslation(lang);

    const docs: DocWithPath[] = [];
    const noFilesMessage = t('common.noFilesFound');

    if (args.artifactId) {
      const artifact = await this.agent.plugin.artifactManagerV2
        .withTitle(title)
        .getArtifactById(args.artifactId);

      if (!artifact) {
        const message = t('common.noRecentOperations');
        const responseMessage = await this.respondAndSerializeMove({
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
      } else if (artifact.artifactType === ArtifactType.READ_CONTENT) {
        const file = artifact.readingResult.file;
        if (file) {
          docs.push({ path: file.path });
        }
      } else {
        const message = t('move.cannotMoveThisType', { type: artifact.artifactType });
        const responseMessage = await this.respondAndSerializeMove({
          title,
          content: message,
          toolCall,
          lang,
          handlerId,
        });
        return { docs: [], responseMessage };
      }
    }

    if (args.files) {
      for (const file of args.files) {
        const trimmedPath = file.path.trim();
        if (trimmedPath) {
          docs.push({ path: trimmedPath });
        }
      }
    }

    if (docs.length === 0) {
      const responseMessage = await this.respondAndSerializeMove({
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

  private async respondAndSerializeMove(params: {
    title: string;
    content: string;
    toolCall: ToolInvocation<unknown, MoveToolArgs>;
    lang?: string | null;
    handlerId: string;
  }): Promise<string> {
    const { title, content, toolCall, lang, handlerId } = params;
    const messageId = await this.agent.renderer.updateConversationNote({
      path: title,
      newContent: content,
      agent: 'vault',
      command: 'vault_move',
      lang,
      handlerId,
      includeHistory: false,
    });

    await this.serializeMoveInvocation({
      title,
      handlerId,
      toolCall,
      result: messageId ? `messageRef:${messageId}` : content,
    });

    return content;
  }

  private async executeMoveOperation(params: {
    title: string;
    docs: DocWithPath[];
    destinationFolder: string;
    explanation: string;
    lang?: string | null;
  }): Promise<MoveOperationResult> {
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

    const result = await this.agent.obsidianAPITools.moveByOperations(
      moveOperations,
      filesByOperation
    );

    eventEmitter.emit(Events.MOVE_OPERATION_COMPLETED, {
      title,
      operations: result.operations,
    });

    const moved: string[] = [];
    const skipped: string[] = [];
    const errors: string[] = [];

    for (const operation of result.operations) {
      for (const movedPath of operation.moved) {
        moved.push(movedPath);
      }

      for (const skippedPath of operation.skipped) {
        skipped.push(skippedPath);
      }

      for (const errorPath of operation.errors) {
        errors.push(errorPath);
      }
    }

    if (moved.length === 0 && skipped.length === 0 && errors.length === 0) {
      const t = getTranslation(lang);
      errors.push(t('move.noSearchResultsFoundAbortMove'));
    }

    return {
      moved,
      skipped,
      errors,
    };
  }

  private formatMoveResult(params: {
    result: MoveOperationResult;
    destinationFolder: string;
    explanation: string;
    lang?: string | null;
  }): string {
    const { result, destinationFolder, explanation, lang } = params;
    const { moved, skipped, errors } = result;
    const totalCount = moved.length + skipped.length + errors.length;

    const t = getTranslation(lang);
    let response = t('move.foundFiles', { count: totalCount });
    response += `\n\n${t('move.operation', { num: 1, query: explanation, folder: destinationFolder })}`;

    if (moved.length > 0) {
      response += `\n\n**${t('move.successfullyMoved', { count: moved.length })}**`;
      for (const file of moved) {
        response += `\n- [[${file}]]`;
      }
    }

    if (skipped.length > 0) {
      response += `\n\n**${t('move.skipped', { count: skipped.length })}**`;
      for (const file of skipped) {
        response += `\n- [[${file}]]`;
      }
    }

    if (errors.length > 0) {
      response += `\n\n**${t('move.failed', { count: errors.length })}**`;
      for (const file of errors) {
        response += `\n- ${file}`;
      }
    }

    return response;
  }

  private async serializeMoveInvocation(params: {
    title: string;
    handlerId: string;
    toolCall: ToolInvocation<unknown, MoveToolArgs>;
    result: string;
  }): Promise<void> {
    const { title, handlerId, toolCall, result } = params;

    await this.agent.renderer.serializeToolInvocation({
      path: title,
      agent: 'vault',
      command: 'vault_move',
      handlerId,
      toolInvocations: [
        {
          ...toolCall,
          result,
        },
      ],
    });
  }
}
