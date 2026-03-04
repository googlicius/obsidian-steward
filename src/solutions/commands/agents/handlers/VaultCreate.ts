import { tool } from 'ai';
import { normalizePath, parseYaml } from 'obsidian';
import { z } from 'zod/v3';
import { getTranslation } from 'src/i18n';
import { ArtifactType } from 'src/solutions/artifact';
import { ToolCallPart } from '../../tools/types';
import type { AgentHandlerContext } from '../AgentHandlerContext';
import { type ToolContentStreamInfo } from '../SuperAgent/SuperAgentToolContentStream';
import { AgentHandlerParams, AgentResult, IntentResultStatus } from '../../types';

export const createToolSchema = z.object({
  folder: z
    .string()
    .min(1)
    .optional()
    .default('/')
    .describe('Optional folder path where files will be created. Defaults to "/" (root folder).'),
  newFiles: z
    .array(
      z
        .object({
          fileName: z
            .string()
            .min(1)
            .describe(
              'The file name to create. Must include the file extension (e.g. .md, .base, .canvas).'
            ),
          content: z
            .string()
            .optional()
            .describe('The content that should be written to the file after creation.'),
        })
        .transform(val => {
          if (!val.fileName.endsWith('.base') || !val.content) {
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
    .min(1)
    .describe('The list of files that must be created.'),
});

export type CreateToolArgs = z.infer<typeof createToolSchema>;

export type CreateFileInstruction = {
  fileName: string;
  content?: string;
};

export type CreatePlan = {
  folder: string;
  newFiles: CreateFileInstruction[];
};

function executeCreateToolArgs(args: CreateToolArgs): CreatePlan {
  const normalizedFiles: CreateFileInstruction[] = [];
  // Normalize folder path: trim, normalize slashes, remove leading/trailing slashes
  const trimmedFolder = (args.folder ?? '/').trim();
  const folder = trimmedFolder.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');

  for (const file of args.newFiles) {
    const fileName = file.fileName.trim();

    normalizedFiles.push({
      fileName,
      content: file.content && file.content.trim().length > 0 ? file.content : undefined,
    });
  }

  return {
    folder,
    newFiles: normalizedFiles,
  };
}

export class VaultCreate {
  private static readonly createTool = tool({ inputSchema: createToolSchema });

  constructor(private readonly agent: AgentHandlerContext) {}

  public extractPathsForGuardrails(input: CreateToolArgs): string[] {
    const paths: string[] = [normalizePath(input.folder)];
    for (const file of input.newFiles) {
      paths.push(normalizePath(`${input.folder}/${file.fileName}`));
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
    createdFiles: string[];
    createdFileLinks: string[];
    errors: string[];
  }> {
    const createdFiles: string[] = [];
    const createdFileLinks: string[] = [];
    const errors: string[] = [];
    const { plan } = params;

    // Ensure folder exists
    await this.agent.obsidianAPITools.ensureFolderExists(plan.folder);

    for (const file of plan.newFiles) {
      if (!file.fileName) {
        errors.push('File name is missing');
        continue;
      }

      // Build full path: folder/fileName
      const newFilePath = normalizePath(`${plan.folder}/${file.fileName}`);

      // Validate YAML content for .base files
      if (file.fileName.endsWith('.base') && file.content) {
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
        createdFileLinks.push(`[[${newFilePath}]]`);

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
      createdFiles,
      createdFileLinks,
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
    }
  ): Promise<AgentResult> {
    const { title, lang, handlerId, intent } = params;
    const { toolCall, toolContentStreamInfo } = options;
    const t = getTranslation(lang);

    if (!handlerId) {
      throw new Error('VaultCreate.handle invoked without handlerId');
    }

    const plan = executeCreateToolArgs(toolCall.input);

    if (plan.newFiles.length === 0) {
      if (toolContentStreamInfo) {
        await this.agent.deleteTempStreamFile(toolContentStreamInfo.tempFilePath);
      }

      await this.agent.renderer.updateConversationNote({
        path: title,
        newContent: '*No files were specified for creation*',
        role: 'Steward',
        command: 'vault_create',
        lang,
        handlerId,
        includeHistory: false,
      });

      return {
        status: IntentResultStatus.ERROR,
        error: new Error('No files specified for creation'),
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
      let message = `${t('create.confirmMessage', { count: plan.newFiles.length })}\n`;
      message += `\n*Folder:* \`${plan.folder}\`\n`;

      for (const file of plan.newFiles) {
        const fullPath = normalizePath(`${plan.folder}/${file.fileName}`);
        message += `- \`${fullPath}\`\n`;
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

          return {
            status: IntentResultStatus.SUCCESS,
          };
        },
        onRejection: async (_rejectionMessage: string) => {
          this.agent.commandProcessor.deleteNextPendingIntent(title);
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
    createdFiles: string[];
    createdFileLinks: string[];
    errors: string[];
  }> {
    const { title, plan, lang, handlerId, toolCall } = params;
    const t = getTranslation(lang);

    const creationResult = await this.executePlan({ plan });

    if (creationResult.createdFiles.length > 0) {
      const messageId = await this.agent.renderer.updateConversationNote({
        path: title,
        newContent: t('create.creatingFile', {
          fileName: creationResult.createdFileLinks.join(', '),
        }),
        role: 'Steward',
        command: 'vault_create',
        lang,
        handlerId,
      });

      if (messageId) {
        await this.agent.plugin.artifactManagerV2.withTitle(title).storeArtifact({
          text: `*${t('common.artifactCreated', {
            type: ArtifactType.CREATED_NOTES,
          })}*`,
          artifact: {
            artifactType: ArtifactType.CREATED_NOTES,
            paths: creationResult.createdFiles,
            createdAt: Date.now(),
          },
        });
      }
    }

    let resultMessage = '';
    if (creationResult.createdFiles.length > 0) {
      resultMessage = `*${t('create.success', {
        count: creationResult.createdFiles.length,
        fileName: creationResult.createdFiles.join(', '),
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
        newFiles: toolCall.input.newFiles.map(file => ({
          ...file,
          content: file.content ? t('create.contentOmitted') : undefined,
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
              createdFiles: creationResult.createdFiles,
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
      const fullPath = normalizePath(`${plan.folder}/${file.fileName}`);
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
