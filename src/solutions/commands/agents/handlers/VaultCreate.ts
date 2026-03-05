import { tool } from 'ai';
import { normalizePath, parseYaml } from 'obsidian';
import { z } from 'zod/v3';
import { getTranslation } from 'src/i18n';
import { ArtifactType } from 'src/solutions/artifact';
import { ToolName } from 'src/solutions/commands/toolNames';
import { ToolCallPart } from '../../tools/types';
import type { AgentHandlerContext } from '../AgentHandlerContext';
import { type ToolContentStreamInfo } from '../SuperAgent/SuperAgentToolContentStream';
import { AgentHandlerParams, AgentResult, IntentResultStatus } from '../../types';

export const createToolSchema = z
  .object({
    newFolders: z
      .array(
        z
          .string()
          .min(1)
          .describe(
            'The folder path to create. This can include nested segments (e.g. projects/q1).'
          )
      )
      .optional()
      .default([])
      .describe('Optional list of folder paths to create.'),
    newFiles: z
      .array(
        z
          .object({
            filePath: z
              .string()
              .min(1)
              .describe(
                'The full file path to create, including extension (e.g. notes/todo.md, styles/theme.css).'
              ),
            content: z
              .string()
              .optional()
              .describe('The content that should be written to the file after creation.'),
          })
          .transform(val => {
            if (!val.filePath.endsWith('.base') || !val.content) {
              return val;
            }

            // Extract YAML content from a markdown code block if present
            const yamlBlockMatch = val.content.trim().match(/^```yaml\s*\n([\s\S]*?)\n```\s*$/i);
            if (!yamlBlockMatch) {
              return val;
            }

            return { ...val, content: yamlBlockMatch[1] };
          })
      )
      .optional()
      .default([])
      .describe('Optional list of files to create.'),
  })
  .refine(data => data.newFolders.length > 0 || data.newFiles.length > 0, {
    message: 'Provide at least one folder path or file path to create.',
  });

export type CreateToolArgs = z.infer<typeof createToolSchema>;

export type CreateFileInstruction = {
  filePath: string;
  content?: string;
};

export type CreatePlan = {
  newFolders: string[];
  newFiles: CreateFileInstruction[];
};

function executeCreateToolArgs(args: CreateToolArgs): CreatePlan {
  const normalizedFolders: string[] = [];
  const normalizedFiles: CreateFileInstruction[] = [];

  for (const folderPath of args.newFolders) {
    const normalizedFolder = normalizePath(folderPath.trim()).replace(/^\/+|\/+$/g, '');
    if (!normalizedFolder) {
      continue;
    }
    normalizedFolders.push(normalizedFolder);
  }

  for (const file of args.newFiles) {
    const filePath = normalizePath(file.filePath.trim()).replace(/^\/+/g, '');
    if (!filePath) {
      continue;
    }

    normalizedFiles.push({
      filePath,
      content: file.content && file.content.trim().length > 0 ? file.content : undefined,
    });
  }

  return {
    newFolders: normalizedFolders,
    newFiles: normalizedFiles,
  };
}

export class VaultCreate {
  private static readonly createTool = tool({ inputSchema: createToolSchema });

  constructor(private readonly agent: AgentHandlerContext) {}

  public extractPathsForGuardrails(input: CreateToolArgs): string[] {
    const paths: string[] = [];
    for (const folderPath of input.newFolders ?? []) {
      paths.push(normalizePath(folderPath));
    }
    for (const file of input.newFiles ?? []) {
      paths.push(normalizePath(file.filePath));
    }
    return paths;
  }

  public static getCreateTool() {
    return VaultCreate.createTool;
  }
  /**
   * Execute the create plan
   */
  private async executePlan(params: { plan: CreatePlan }): Promise<{
    createdPaths: string[];
    errors: string[];
  }> {
    const createdFolders: string[] = [];
    const createdFiles: string[] = [];
    const errors: string[] = [];
    const { plan } = params;

    for (const folderPath of plan.newFolders) {
      if (!folderPath) {
        errors.push('Folder path is missing');
        continue;
      }

      try {
        const existed = Boolean(this.agent.app.vault.getFolderByPath(folderPath));
        await this.agent.obsidianAPITools.ensureFolderExists(folderPath);
        if (!existed) {
          createdFolders.push(folderPath);
        }
      } catch (createFolderError) {
        const message =
          createFolderError instanceof Error
            ? createFolderError.message
            : 'Unknown error while creating the folder';
        errors.push(`Failed to create ${folderPath}: ${message}`);
      }
    }

    for (const file of plan.newFiles) {
      if (!file.filePath) {
        errors.push('File path is missing');
        continue;
      }

      const newFilePath = normalizePath(file.filePath);
      const segments = newFilePath.split('/').filter(Boolean);
      const parentFolder =
        segments.length > 1 ? normalizePath(segments.slice(0, segments.length - 1).join('/')) : '';

      if (parentFolder) {
        try {
          const existed = Boolean(this.agent.app.vault.getFolderByPath(parentFolder));
          await this.agent.obsidianAPITools.ensureFolderExists(parentFolder);
          if (!existed && !createdFolders.includes(parentFolder)) {
            createdFolders.push(parentFolder);
          }
        } catch (createFolderError) {
          const message =
            createFolderError instanceof Error
              ? createFolderError.message
              : 'Unknown error while creating the folder';
          errors.push(`Failed to create ${parentFolder}: ${message}`);
          continue;
        }
      }

      // Validate YAML content for .base files
      if (file.filePath.endsWith('.base') && file.content) {
        try {
          parseYaml(file.content);
        } catch (yamlError) {
          const message = yamlError instanceof Error ? yamlError.message : 'Invalid YAML content';
          errors.push(`Invalid YAML content for ${newFilePath}: ${message}`);
          continue;
        }
      }

      try {
        await this.agent.app.vault.create(newFilePath, '');
        createdFiles.push(newFilePath);

        if (file.content) {
          const vaultFile = this.agent.app.vault.getFileByPath(newFilePath);
          if (vaultFile) {
            await this.agent.app.vault.modify(vaultFile, file.content);
          } else {
            errors.push(`Failed to modify ${newFilePath}: File not found or not a valid file`);
          }
        }
      } catch (createError) {
        const message =
          createError instanceof Error
            ? createError.message
            : 'Unknown error while creating the file';
        errors.push(`Failed to create ${newFilePath}: ${message}`);
      }
    }

    return {
      createdPaths: [...createdFolders, ...createdFiles],
      errors,
    };
  }

  /**
   * Handle create tool call in the agent
   */
  public async handle(
    params: AgentHandlerParams,
    options: {
      toolCall: ToolCallPart<CreateToolArgs>;
      toolContentStreamInfo?: ToolContentStreamInfo;
      continueFromNextTool?: () => Promise<AgentResult>;
    }
  ): Promise<AgentResult> {
    const { title, lang, handlerId, intent } = params;
    const { toolCall, toolContentStreamInfo, continueFromNextTool } = options;
    const t = getTranslation(lang);

    if (!handlerId) {
      throw new Error('VaultCreate.handle invoked without handlerId');
    }

    const plan = executeCreateToolArgs(toolCall.input);

    if (plan.newFolders.length === 0 && plan.newFiles.length === 0) {
      if (toolContentStreamInfo) {
        await this.agent.deleteTempStreamFile(toolContentStreamInfo.tempFilePath);
      }

      await this.agent.renderer.updateConversationNote({
        path: title,
        newContent: `*${t('create.noTargets')}*`,
        role: 'Steward',
        command: 'vault_create',
        lang,
        handlerId,
        includeHistory: false,
      });

      return {
        status: IntentResultStatus.ERROR,
        error: new Error(t('create.noTargets')),
      };
    }

    // If streaming was active, replace the temp embed callout with the final content preview
    if (toolContentStreamInfo) {
      await this.replaceStreamedPreview({
        title,
        plan,
        toolContentStreamInfo,
        lang,
        handlerId,
      });
    }

    if (!intent?.no_confirm) {
      const totalItems = plan.newFolders.length + plan.newFiles.length;
      let message = `${t('create.confirmMessage', { count: totalItems })}\n`;

      for (const folderPath of plan.newFolders) {
        message += `- \`${folderPath}\`\n`;
      }
      for (const file of plan.newFiles) {
        message += `- \`${normalizePath(file.filePath)}\`\n`;
      }

      message += `\n${t('create.confirmPrompt')}`;

      await this.agent.renderer.updateConversationNote({
        path: title,
        newContent: message,
        role: 'Steward',
        command: 'vault_create',
        lang,
        handlerId,
      });

      return {
        status: IntentResultStatus.NEEDS_CONFIRMATION,
        confirmationMessage: message,
        onConfirmation: async (_confirmationMessage: string) => {
          await this.executeCreatePlan({
            title,
            plan,
            lang,
            handlerId,
            toolCall,
          });

          if (continueFromNextTool) {
            return continueFromNextTool();
          }

          return {
            status: IntentResultStatus.SUCCESS,
          };
        },
        onRejection: async (_rejectionMessage: string) => {
          this.agent.commandProcessor.deleteNextPendingIntent(title);

          if (continueFromNextTool) {
            return continueFromNextTool();
          }

          return {
            status: IntentResultStatus.SUCCESS,
          };
        },
      };
    }

    await this.executeCreatePlan({
      title,
      plan,
      lang,
      handlerId,
      toolCall,
    });

    return {
      status: IntentResultStatus.SUCCESS,
    };
  }

  /**
   * Execute the create plan and handle results
   */
  public async executeCreatePlan(params: {
    title: string;
    plan: CreatePlan;
    lang?: string | null;
    handlerId: string;
    toolCall: ToolCallPart<CreateToolArgs>;
  }): Promise<{
    createdPaths: string[];
    errors: string[];
  }> {
    const { title, plan, lang, handlerId, toolCall } = params;
    const t = getTranslation(lang);

    const creationResult = await this.executePlan({ plan });

    if (creationResult.createdPaths.length > 0) {
      const createdPathPreview = creationResult.createdPaths.map(path => `\`${path}\``).join(', ');
      const messageId = await this.agent.renderer.updateConversationNote({
        path: title,
        newContent: t('create.creatingPath', {
          path: createdPathPreview,
        }),
        role: 'Steward',
        command: 'vault_create',
        lang,
        handlerId,
      });

      if (messageId) {
        await this.agent.plugin.artifactManagerV2.withTitle(title).storeArtifact({
          artifact: {
            artifactType: ArtifactType.CREATED_PATHS,
            paths: creationResult.createdPaths,
            createdAt: Date.now(),
          },
        });
      }
    }

    let resultMessage = '';
    if (creationResult.createdPaths.length > 0) {
      resultMessage = `*${t('create.success', {
        count: creationResult.createdPaths.length,
      })}*`;
    }

    if (creationResult.errors.length > 0) {
      if (resultMessage) {
        resultMessage += '\n\n';
      }

      let errorsBlock = `*${t('create.errors')}*\n`;
      for (const errorMessage of creationResult.errors) {
        errorsBlock += `- ${errorMessage}\n`;
      }
      resultMessage += errorsBlock.trimEnd();
    }

    await this.agent.renderer.updateConversationNote({
      path: title,
      newContent: resultMessage,
      lang,
      handlerId,
      command: 'vault_create',
    });

    // Replace file content with a short message to reduce token usage in serialized history
    const summarizedToolCall = {
      ...toolCall,
      input: {
        ...toolCall.input,
        newFiles: (toolCall.input.newFiles ?? []).map(file => ({
          ...file,
          content: file.content
            ? t('create.contentOmitted', { toolName: ToolName.CONTENT_READING })
            : undefined,
        })),
      },
    };

    await this.agent.renderer.serializeToolInvocation({
      path: title,
      command: 'vault_create',
      handlerId,
      toolInvocations: [
        {
          ...summarizedToolCall,
          type: 'tool-result',
          output: {
            type: 'json',
            value: {
              createdPaths: creationResult.createdPaths,
              errors: creationResult.errors,
            },
          },
        },
      ],
    });

    return creationResult;
  }

  /**
   * Build a preview of the files to be created, wrapped in callout(s).
   */
  private renderCreatePreview(plan: CreatePlan): string {
    let preview = '';

    for (const file of plan.newFiles) {
      if (!file.content) continue;
      const fullPath = normalizePath(file.filePath);
      const filePreview = `**File:** \`${fullPath}\`\n\n${file.content}`;
      preview += this.agent.plugin.noteContentService.formatCallout(
        filePreview,
        'stw-edit-preview'
      );
      preview += '\n';
    }

    return preview.trimEnd();
  }

  /**
   * Replace the streamed temp file embed with the final creating content preview.
   * The callout with `![[temp_file]]` was already rendered during streaming.
   */
  private async replaceStreamedPreview(params: {
    title: string;
    plan: CreatePlan;
    toolContentStreamInfo: ToolContentStreamInfo;
    lang?: string | null;
    handlerId: string;
  }): Promise<void> {
    const { title, plan, toolContentStreamInfo, lang, handlerId } = params;

    const finalPreview = this.renderCreatePreview(plan);

    const tempEmbed = this.agent.plugin.noteContentService.formatCallout(
      `![[${toolContentStreamInfo.tempFilePath}]]`,
      'stw-edit-preview',
      { streaming: 'true' }
    );

    if (finalPreview) {
      await this.agent.renderer.updateConversationNote({
        path: title,
        newContent: finalPreview,
        replacePlaceHolder: tempEmbed,
        includeHistory: false,
        lang,
        handlerId,
      });
    }

    // Delete the temp file if it has content
    const tempFile = this.agent.app.vault.getFileByPath(toolContentStreamInfo.tempFilePath);
    if (tempFile && tempFile.stat.size > 0) {
      await this.agent.deleteTempStreamFile(toolContentStreamInfo.tempFilePath);
    }
  }
}
