import { tool } from 'ai';
import { z } from 'zod/v3';
import { getTranslation } from 'src/i18n';
import { type SuperAgent } from '../SuperAgent';
import { ArtifactType } from 'src/solutions/artifact';
import { DocWithPath } from 'src/types/types';
import { MoveOperationV2, OperationError } from 'src/tools/obsidianAPITools';
import { ToolCallPart } from '../../tools/types';
import { eventEmitter } from 'src/services/EventEmitter';
import { Events } from 'src/types/events';
import { AgentHandlerParams, AgentResult, IntentResultStatus } from '../../types';
import {
  createArtifactIdSchema,
  createFilesSchemaString,
  createFilePatternsSchema,
  createExplanationSchema,
} from './vaultOperationSchemas';

const moveToolSchema = z
  .object({
    artifactId: createArtifactIdSchema({
      description: `ID of the artifact containing the files or folders to move.`,
    }),
    files: createFilesSchemaString({
      description: `The list of files that must be moved.`,
    }),
    folders: z
      .array(
        z.object({
          path: z
            .string()
            .min(1)
            // Ensure folders don't have leading/trailing slashes
            .transform(path => path.replace(/^\/+|\/+$/g, ''))
            .describe('The full path of the folder to move.'),
        })
      )
      .optional()
      .refine(array => !array || array.length > 0, {
        message: 'folders array must include at least one entry when provided.',
      })
      .describe('Explicit list of folders to move.'),
    filePatterns: createFilePatternsSchema({
      description:
        'Pattern-based file selection for large file sets. Use this to avoid token limits.',
      patternsDescription: 'Array of RegExp patterns to match files for moving.',
    }),
    destinationFolder: z
      .string()
      .min(1)
      .describe('Destination folder path where the files or folders should be moved.'),
    explanation: createExplanationSchema({
      description: 'Short explanation of the move operation and why it is required.',
    }),
  })
  .refine(
    data =>
      Boolean(data.artifactId) ||
      Boolean(data.files && data.files.length > 0) ||
      Boolean(data.folders && data.folders.length > 0) ||
      Boolean(
        data.filePatterns && data.filePatterns.patterns && data.filePatterns.patterns.length > 0
      ),
    {
      message: 'Provide at least one of: artifactId, files, folders, or filePatterns.',
    }
  )
  .refine(
    data =>
      !(
        data.files &&
        data.files.length > 0 &&
        data.filePatterns &&
        data.filePatterns.patterns &&
        data.filePatterns.patterns.length > 0
      ),
    {
      message: 'Provide either files or filePatterns, not both.',
    }
  );

export type MoveToolArgs = z.infer<typeof moveToolSchema>;

type MoveOperationResult = {
  moved: string[];
  skipped: string[];
  errors: OperationError[];
  movePairs: Array<[string, string]>; // Array of [originalPath, movedPath] pairs
};

export class VaultMove {
  private static readonly moveTool = tool({ inputSchema: moveToolSchema });

  constructor(private readonly agent: SuperAgent) {}

  public static getMoveTool() {
    return VaultMove.moveTool;
  }

  public async handle(
    params: AgentHandlerParams,
    options: { toolCall: ToolCallPart<MoveToolArgs> }
  ): Promise<AgentResult> {
    const { toolCall } = options;

    if (!params.handlerId) {
      throw new Error('VaultMove.handle invoked without handlerId');
    }

    const t = getTranslation(params.lang);

    await this.agent.renderer.updateConversationNote({
      path: params.title,
      newContent: toolCall.input.explanation,
      command: 'vault_move',
      includeHistory: false,
      lang: params.lang,
      handlerId: params.handlerId,
      step: params.invocationCount,
    });

    const resolveResult = await this.resolveMoveDocs({
      title: params.title,
      toolCall,
      lang: params.lang,
      handlerId: params.handlerId,
      step: params.invocationCount,
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
      const message = t('move.destinationRequired');
      await this.respondAndSerializeMove({
        title: params.title,
        content: message,
        toolCall,
        lang: params.lang,
        handlerId: params.handlerId,
        step: params.invocationCount,
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
        title: params.title,
        content: message,
        toolCall,
        lang: params.lang,
        handlerId: params.handlerId,
        step: params.invocationCount,
      });

      const handlerId = params.handlerId;

      return {
        status: IntentResultStatus.NEEDS_CONFIRMATION,
        confirmationMessage: message,
        onConfirmation: async (_confirmationMessage: string) => {
          await this.agent.obsidianAPITools.ensureFolderExists(toolCall.input.destinationFolder);
          return this.handle(params, options);
        },
        onRejection: async (_rejectionMessage: string) => {
          const cancellationMessage = t('confirmation.operationCancelled');
          await this.respondAndSerializeMove({
            title: params.title,
            content: cancellationMessage,
            toolCall,
            lang: params.lang,
            handlerId,
            step: params.invocationCount,
          });
          return {
            status: IntentResultStatus.SUCCESS,
          };
        },
      };
    }

    const moveResult = await this.executeMoveOperation({
      title: params.title,
      docs,
      destinationFolder,
      explanation: toolCall.input.explanation,
      lang: params.lang,
    });

    const formattedMessage = this.formatMoveResult({
      result: moveResult,
      destinationFolder,
      explanation: toolCall.input.explanation,
      lang: params.lang,
    });

    const messageId = await this.agent.renderer.updateConversationNote({
      path: params.title,
      newContent: formattedMessage,
      command: 'vault_move',
      lang: params.lang,
      includeHistory: false,
      handlerId: params.handlerId,
      step: params.invocationCount,
    });

    // Store move results as an artifact if there are any moves
    if (moveResult.movePairs.length > 0) {
      const artifactId = `move_${Date.now()}`;
      await this.agent.plugin.artifactManagerV2.withTitle(params.title).storeArtifact({
        artifact: {
          artifactType: ArtifactType.MOVE_RESULTS,
          moves: moveResult.movePairs,
          id: artifactId,
          createdAt: Date.now(),
        },
      });
    }

    await this.agent.serializeInvocation({
      command: 'vault_move',
      title: params.title,
      handlerId: params.handlerId,
      step: params.invocationCount,
      toolCall,
      result: {
        type: 'text',
        value: messageId ? `messageRef:${messageId}` : formattedMessage,
      },
    });

    return {
      status: IntentResultStatus.SUCCESS,
    };
  }

  private async resolveMoveDocs(params: {
    title: string;
    toolCall: ToolCallPart<MoveToolArgs>;
    lang?: string | null;
    handlerId: string;
    step?: number;
  }): Promise<{ docs: DocWithPath[]; responseMessage?: string }> {
    const { title, toolCall, lang, handlerId } = params;
    const t = getTranslation(lang);

    const docs: DocWithPath[] = [];
    const noFilesMessage = t('common.noFilesFound');

    if (toolCall.input.artifactId) {
      const artifactManager = this.agent.plugin.artifactManagerV2.withTitle(title);
      const resolvedFiles = await artifactManager.resolveFilesFromArtifact(
        toolCall.input.artifactId
      );

      if (resolvedFiles.length === 0) {
        // No files found in artifact, continue to check other sources
        // The noFilesMessage will be handled at the end if no files are found
      } else {
        docs.push(...resolvedFiles);
      }
    }

    if (toolCall.input.files) {
      for (const filePath of toolCall.input.files) {
        const trimmedPath = filePath.trim();
        if (trimmedPath) {
          docs.push({ path: trimmedPath });
        }
      }
    }

    if (toolCall.input.folders) {
      for (const folder of toolCall.input.folders) {
        const trimmedPath = folder.path.trim();
        if (trimmedPath) {
          docs.push({ path: trimmedPath });
        }
      }
    }

    if (toolCall.input.filePatterns) {
      const patternMatchedPaths = this.agent.obsidianAPITools.resolveFilePatterns(
        toolCall.input.filePatterns.patterns,
        toolCall.input.filePatterns.folder
      );
      for (const path of patternMatchedPaths) {
        docs.push({ path });
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
    toolCall: ToolCallPart<MoveToolArgs>;
    lang?: string | null;
    handlerId: string;
    step?: number;
  }): Promise<string> {
    const messageId = await this.agent.renderer.updateConversationNote({
      path: params.title,
      newContent: params.content,
      command: 'vault_move',
      lang: params.lang,
      handlerId: params.handlerId,
      step: params.step,
      includeHistory: false,
    });

    await this.agent.serializeInvocation({
      command: 'vault_move',
      title: params.title,
      handlerId: params.handlerId,
      step: params.step,
      toolCall: params.toolCall,
      result: {
        type: 'text',
        value: messageId ? `messageRef:${messageId}` : params.content,
      },
    });

    return params.content;
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
      filesByOperation,
      lang
    );

    // Convert errors to strings for event emission (backward compatibility)
    eventEmitter.emit(Events.MOVE_OPERATION_COMPLETED, {
      title,
      operations: result.operations.map(op => ({
        ...op,
        errors: op.errors.map(err => `${err.path}: ${err.message}`),
      })),
    });

    const moved: string[] = [];
    const skipped: string[] = [];
    const errors: OperationError[] = [];

    for (const operation of result.operations) {
      for (const movedPath of operation.moved) {
        moved.push(movedPath);
      }

      for (const skippedPath of operation.skipped) {
        skipped.push(skippedPath);
      }

      for (const error of operation.errors) {
        errors.push(error);
      }
    }

    if (moved.length === 0 && skipped.length === 0 && errors.length === 0) {
      const t = getTranslation(lang);
      errors.push({ path: '', message: t('move.noSearchResultsFoundAbortMove') });
    }

    return {
      moved,
      skipped,
      errors,
      movePairs: result.movePairs,
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
      for (const path of moved) {
        const isFile = Boolean(this.agent.app.vault.getFileByPath(path));
        if (isFile) {
          response += `\n- [[${path}]]`;
        } else {
          response += `\n- \`${path}\``;
        }
      }
    }

    if (skipped.length > 0) {
      response += `\n\n**${t('move.skipped', { count: skipped.length })}**`;
      for (const path of skipped) {
        const isFile = Boolean(this.agent.app.vault.getFileByPath(path));
        if (isFile) {
          response += `\n- [[${path}]]`;
        } else {
          response += `\n- \`${path}\``;
        }
      }
    }

    if (errors.length > 0) {
      response += `\n\n**${t('move.failed', { count: errors.length })}**`;
      for (const error of errors) {
        const errorString = error.path ? `${error.path}: ${error.message}` : error.message;
        response += `\n- ${errorString}`;
      }
    }

    return response;
  }
}
