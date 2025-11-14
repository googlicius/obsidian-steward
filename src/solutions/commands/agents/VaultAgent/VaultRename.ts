import { tool } from 'ai';
import { z } from 'zod';
import { getTranslation } from 'src/i18n';
import type VaultAgent from './VaultAgent';
import { ToolInvocation } from '../../tools/types';
import { AgentHandlerParams, AgentResult, IntentResultStatus } from '../../types';

const renameToolSchema = z.object({
  files: z
    .array(
      z.object({
        path: z
          .string()
          .min(1)
          .describe('The full path (including extension) of the file to rename.'),
        newPath: z
          .string()
          .min(1)
          .describe('The new full path (including extension) for the renamed file.'),
      })
    )
    .min(1, { message: 'Provide at least one file to rename.' })
    .describe('List of files to rename along with their destination paths.'),
  explanation: z
    .string()
    .min(1)
    .describe('Short explanation of the rename operation and why it is required.'),
});

export type RenameToolArgs = z.infer<typeof renameToolSchema>;

type RenameInstruction = {
  path: string;
  newPath: string;
};

type RenameOperationResult = {
  renamed: Array<{ from: string; to: string }>;
  skippedSamePath: string[];
  missingFiles: string[];
  conflicts: string[];
  errors: Array<{ path: string; message: string }>;
};

export class VaultRename {
  private static readonly renameTool = tool({ parameters: renameToolSchema });

  constructor(private readonly agent: VaultAgent) {}

  public static getRenameTool() {
    return VaultRename.renameTool;
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
      agent: 'vault',
      command: 'vault_rename',
      includeHistory: false,
      lang,
      handlerId,
    });

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
    instructions: RenameInstruction[];
    hasInvalid: boolean;
  } {
    const instructions: RenameInstruction[] = [];
    let hasInvalid = false;

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

  private collectMissingFolders(params: { instructions: RenameInstruction[] }): string[] {
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
    instructions: RenameInstruction[];
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
      for (const entry of renamed) {
        response += `\n- [[${entry.from}]] → [[${entry.to}]]`;
      }
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
      agent: 'vault',
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
      agent: 'vault',
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
      instructions: RenameInstruction[];
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
      agent: 'vault',
      command: 'vault_rename',
      lang,
      handlerId,
    });

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
}
