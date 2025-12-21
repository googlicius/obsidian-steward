import { tool } from 'ai';
import { z } from 'zod';
import { getTranslation } from 'src/i18n';
import { ArtifactType } from 'src/solutions/artifact';
import { type SuperAgent } from '../SuperAgent';
import { ToolInvocation } from '../../tools/types';
import { AgentHandlerParams, AgentResult, IntentResultStatus } from '../../types';
import { logger } from 'src/utils/logger';
import { DataAwarenessAgent } from '../DataAwarenessAgent';

const renamesSchema = z.array(
  z.object({
    path: z.string().min(1).describe('The full path of the file to rename.'),
    newPath: z.string().min(1).describe('The new full path for the renamed file.'),
  })
);

const dataAwarenessAgentSchema = z.object({
  files: renamesSchema,
});

const renameToolSchema = z.object({
  files: renamesSchema.optional()
    .describe(`List of files to rename along with their destination paths.
DO NOT use this for a paginated list, where the files number is smaller than the total count.`),
  delegateToAgent: z
    .object({
      artifactId: z.string().min(1).describe('ID of the artifact containing files to rename.'),
      query: z
        .string()
        .min(1)
        .describe('Query describing what rename operations to perform on the files.'),
    })
    .optional()
    .describe(
      `Delegate to DataAwarenessAgent to process files in small batches from an artifact. Use this for large file sets to avoid token limits.
- Use this when: 1. Provided artifact ID (By user, tool call results), 2. The files is a part of a larger list.`
    ),
  explanation: z
    .string()
    .min(1)
    .describe('Short explanation of the rename operation and why it is required.'),
});

export type RenameToolArgs = z.infer<typeof renameToolSchema>;

type RenameInstructions = z.infer<typeof renamesSchema>;

type RenameOperationResult = {
  renamed: Array<{ from: string; to: string }>;
  skippedSamePath: string[];
  missingFiles: string[];
  conflicts: string[];
  errors: Array<{ path: string; message: string }>;
};

export class VaultRename {
  private static readonly renameTool = tool({ parameters: renameToolSchema });
  private _dataAwarenessAgent: DataAwarenessAgent;

  constructor(private readonly agent: SuperAgent) {}

  public static getRenameTool() {
    return VaultRename.renameTool;
  }

  private get dataAwarenessAgent(): DataAwarenessAgent {
    if (!this._dataAwarenessAgent) {
      this._dataAwarenessAgent = new DataAwarenessAgent({
        plugin: this.agent.plugin,
        systemPrompt: `You are a helpful assistant that analyzes files to determine appropriate new names for renaming operations.`,
        responseSchema: dataAwarenessAgentSchema,
        extractResults: <T>(object: { files: T[] }): T[] => {
          // The response schema is an array, so we expect an array directly
          return object.files;
        },
      });
    }

    return this._dataAwarenessAgent;
  }

  public async handle(
    params: AgentHandlerParams,
    options: { toolCall: ToolInvocation<unknown, RenameToolArgs> }
  ): Promise<AgentResult> {
    const { title, lang } = params;
    const handlerId = params.handlerId;
    const { toolCall } = options;

    if (!handlerId) {
      throw new Error('VaultRename.handle invoked without handlerId');
    }

    const t = getTranslation(lang);

    await this.agent.renderer.updateConversationNote({
      path: title,
      newContent: toolCall.args.explanation,
      command: 'vault_rename',
      includeHistory: false,
      lang,
      handlerId,
    });

    // Handle delegation to DataAwarenessAgent
    if (toolCall.args.delegateToAgent) {
      return this.handleDataAwarenessDelegation(params, {
        toolCall,
      });
    }

    // Validate that files are provided when not delegating
    if (!toolCall.args.files || toolCall.args.files.length === 0) {
      const message = t('rename.noInstructions');
      await this.respondAndSerializeRename({
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

    const normalization = this.normalizeInstructions({ files: toolCall.args.files });
    if (normalization.hasInvalid) {
      const message = t('rename.invalidInstruction');
      await this.respondAndSerializeRename({
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

    if (normalization.instructions.length === 0) {
      const message = t('rename.noInstructions');
      await this.respondAndSerializeRename({
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

    const instructions = normalization.instructions;

    const missingFolders = this.collectMissingFolders({ instructions });
    if (missingFolders.length > 0) {
      const folderList = missingFolders.map(folder => `- \`${folder}\``).join('\n');
      const message = `${t('rename.createFoldersHeader')}\n${folderList}\n\n${t(
        'rename.createFoldersQuestion'
      )}`;

      await this.respondAndSerializeRename({
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
          for (const folder of missingFolders) {
            await this.agent.obsidianAPITools.ensureFolderExists(folder);
          }

          return this.finishRename(params, { instructions, toolCall });
        },
        onRejection: async (_rejectionMessage: string) => {
          const cancellationMessage = t('confirmation.operationCancelled');
          await this.respondAndSerializeRename({
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

    return this.finishRename(params, { instructions, toolCall });
  }

  private normalizeInstructions(params: { files: RenameToolArgs['files'] }): {
    instructions: RenameInstructions;
    hasInvalid: boolean;
  } {
    const instructions: RenameInstructions = [];
    let hasInvalid = false;

    if (!params.files) {
      return { instructions, hasInvalid: true };
    }

    for (const entry of params.files) {
      const normalizedPath = this.normalizePath(entry.path);
      const normalizedNewPath = this.normalizePath(entry.newPath);

      if (!normalizedPath || !normalizedNewPath) {
        hasInvalid = true;
        continue;
      }

      instructions.push({
        path: normalizedPath,
        newPath: normalizedNewPath,
      });
    }

    return { instructions, hasInvalid };
  }

  private normalizePath(path: string): string {
    return path.trim().replace(/\\/g, '/').replace(/\/+/g, '/');
  }

  private collectMissingFolders(params: { instructions: RenameInstructions }): string[] {
    const missingFolders = new Set<string>();

    for (const instruction of params.instructions) {
      const folderPath = this.getFolderPath(instruction.newPath);
      if (!folderPath) {
        continue;
      }

      if (!this.agent.app.vault.getFolderByPath(folderPath)) {
        missingFolders.add(folderPath);
      }
    }

    return [...missingFolders];
  }

  private getFolderPath(path: string): string | null {
    const segments = path.split('/');
    if (segments.length <= 1) {
      return null;
    }

    segments.pop();
    const folder = segments.join('/');
    return folder.length > 0 ? folder : null;
  }

  private async executeRenameOperations(params: {
    instructions: RenameInstructions;
    lang?: string | null;
  }): Promise<RenameOperationResult> {
    const { instructions, lang } = params;
    const t = getTranslation(lang);

    const renamed: Array<{ from: string; to: string }> = [];
    const skippedSamePath: string[] = [];
    const missingFiles: string[] = [];
    const conflicts: string[] = [];
    const errors: Array<{ path: string; message: string }> = [];

    for (const instruction of instructions) {
      const { path, newPath } = instruction;
      const file = this.agent.app.vault.getFileByPath(path);

      if (!file) {
        missingFiles.push(path);
        continue;
      }

      if (path === newPath) {
        skippedSamePath.push(path);
        continue;
      }

      const existing = this.agent.app.vault.getAbstractFileByPath(newPath);
      if (existing) {
        conflicts.push(newPath);
        continue;
      }

      try {
        await this.agent.app.fileManager.renameFile(file, newPath);
        renamed.push({ from: path, to: newPath });
      } catch (error) {
        const errorMessage =
          error instanceof Error
            ? error.message
            : typeof error === 'string'
              ? error
              : t('rename.unknownError');
        errors.push({ path, message: errorMessage || t('rename.unknownError') });
      }
    }

    return {
      renamed,
      skippedSamePath,
      missingFiles,
      conflicts,
      errors,
    };
  }

  private formatRenameResult(params: {
    instructionsCount: number;
    result: RenameOperationResult;
    lang?: string | null;
  }): string {
    const { instructionsCount, result, lang } = params;
    const t = getTranslation(lang);
    const { renamed, skippedSamePath, missingFiles, conflicts, errors } = result;

    let response = t('rename.processed', { count: instructionsCount });

    if (renamed.length > 0) {
      response += `\n\n**${t('rename.success', { count: renamed.length })}**`;
      // Wrap the list of renames in a tool-hidden section, we don't need to send it to the tool call result
      response += `\n<!--stw-tool-hidden-start-->`;
      for (const entry of renamed) {
        response += `\n- [[${entry.from}]] → [[${entry.to}]]`;
      }
      response += `\n<!--stw-tool-hidden-end-->`;
    }

    if (skippedSamePath.length > 0) {
      response += `\n\n**${t('rename.samePath', { count: skippedSamePath.length })}**`;
      for (const path of skippedSamePath) {
        response += `\n- [[${path}]]`;
      }
    }

    if (missingFiles.length > 0) {
      response += `\n\n**${t('rename.fileMissing', { count: missingFiles.length })}**`;
      for (const path of missingFiles) {
        response += `\n- [[${path}]]`;
      }
    }

    if (conflicts.length > 0) {
      response += `\n\n**${t('rename.targetExists', { count: conflicts.length })}**`;
      for (const path of conflicts) {
        response += `\n- [[${path}]]`;
      }
    }

    if (errors.length > 0) {
      response += `\n\n**${t('rename.errors', { count: errors.length })}**`;
      for (const error of errors) {
        response += `\n- ${t('rename.renameError', { path: error.path, message: error.message })}`;
      }
    }

    return response;
  }

  private async respondAndSerializeRename(params: {
    title: string;
    content: string;
    toolCall: ToolInvocation<unknown, RenameToolArgs>;
    lang?: string | null;
    handlerId: string;
  }): Promise<string> {
    const { title, content, toolCall, lang, handlerId } = params;
    const messageId = await this.agent.renderer.updateConversationNote({
      path: title,
      newContent: content,
      command: 'vault_rename',
      lang,
      handlerId,
      includeHistory: false,
    });

    await this.serializeRenameInvocation({
      title,
      handlerId,
      toolCall,
      result: messageId ? `messageRef:${messageId}` : content,
    });

    return content;
  }

  private async serializeRenameInvocation(params: {
    title: string;
    handlerId: string;
    toolCall: ToolInvocation<unknown, RenameToolArgs>;
    result: string;
  }): Promise<void> {
    const { title, handlerId, toolCall, result } = params;

    await this.agent.renderer.serializeToolInvocation({
      path: title,
      command: 'vault_rename',
      handlerId,
      toolInvocations: [
        {
          ...toolCall,
          result,
        },
      ],
    });
  }

  private async finishRename(
    params: AgentHandlerParams,
    options: {
      instructions: RenameInstructions;
      toolCall: ToolInvocation<unknown, RenameToolArgs>;
    }
  ): Promise<AgentResult> {
    const { title, lang } = params;
    const handlerId = params.handlerId;
    if (!handlerId) {
      throw new Error('VaultRename.finishRename invoked without handlerId');
    }

    const renameResult = await this.executeRenameOperations({
      instructions: options.instructions,
      lang,
    });

    const formattedMessage = this.formatRenameResult({
      instructionsCount: options.instructions.length,
      result: renameResult,
      lang,
    });

    const messageId = await this.agent.renderer.updateConversationNote({
      path: title,
      newContent: formattedMessage,
      command: 'vault_rename',
      lang,
      handlerId,
    });

    // Store rename results as an artifact if there are any renames
    if (renameResult.renamed.length > 0) {
      const artifactId = `rename_${Date.now()}`;
      const renamePairs: Array<[string, string]> = renameResult.renamed.map(({ from, to }) => [
        from,
        to,
      ]);
      await this.agent.plugin.artifactManagerV2.withTitle(title).storeArtifact({
        artifact: {
          artifactType: ArtifactType.RENAME_RESULTS,
          renames: renamePairs,
          id: artifactId,
          createdAt: Date.now(),
        },
      });
    }

    await this.serializeRenameInvocation({
      title,
      handlerId,
      toolCall: options.toolCall,
      result: messageId ? `messageRef:${messageId}` : formattedMessage,
    });

    return {
      status: IntentResultStatus.SUCCESS,
    };
  }

  /**
   * Handle delegation to DataAwarenessAgent for processing files from an artifact
   */
  private async handleDataAwarenessDelegation(
    params: AgentHandlerParams,
    options: {
      toolCall: ToolInvocation<unknown, RenameToolArgs>;
    }
  ): Promise<AgentResult> {
    const { title, lang } = params;
    const handlerId = params.handlerId;
    const { toolCall } = options;

    if (!handlerId) {
      throw new Error('VaultRename.handleDataAwarenessDelegation invoked without handlerId');
    }

    if (!toolCall.args.delegateToAgent) {
      throw new Error('delegateToAgent is required for handleDataAwarenessDelegation');
    }

    const artifactId = toolCall.args.delegateToAgent.artifactId;
    const query = toolCall.args.delegateToAgent.query;

    const t = getTranslation(lang);

    try {
      const result = await this.dataAwarenessAgent.process<RenameResult>({
        query,
        artifactId,
        title,
        parallel: false,
        lang,
        handlerId,
        model: params.intent.model,
      });

      if (result.failedFiles.length > 0) {
        logger.warn('DataAwarenessAgent processing errors:', result.failedFiles);
      }

      if (result.results.length === 0) {
        const message = t('rename.noInstructions');
        await this.respondAndSerializeRename({
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

      // Convert results to rename instructions format
      type RenameResult = { path: string; newPath: string };
      const instructions: RenameInstructions = result.results.map(item => ({
        path: item.path,
        newPath: item.newPath,
      }));

      return this.finishRename(params, { instructions, toolCall });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('Error in DataAwarenessAgent delegation:', error);

      const message = `${t('common.errorProcessingCommand', {
        commandType: 'rename',
        errorMessage,
      })}`;
      await this.respondAndSerializeRename({
        title,
        content: message,
        toolCall,
        lang,
        handlerId,
      });

      return {
        status: IntentResultStatus.ERROR,
        error: new Error(errorMessage),
      };
    }
  }
}
