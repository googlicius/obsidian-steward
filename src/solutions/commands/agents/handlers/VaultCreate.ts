import { tool } from 'ai';
import { z } from 'zod/v3';
import { getTranslation } from 'src/i18n';
import { ArtifactType } from 'src/solutions/artifact';
import { ToolCallPart } from '../../tools/types';
import { type SuperAgent } from '../SuperAgent';
import { AgentHandlerParams, AgentResult, IntentResultStatus } from '../../types';

const createToolSchema = z.object({
  folder: z.string().min(1).describe('The folder path where the notes will be created.'),
  notes: z
    .array(
      z.object({
        fileName: z
          .string()
          .min(1)
          .describe('The file name for the note to create. Include the .md extension.'),
        content: z
          .string()
          .optional()
          .describe('The Markdown content that should be written to the note after creation.'),
      })
    )
    .min(1)
    .describe('The list of notes that must be created.'),
});

export type CreateToolArgs = z.infer<typeof createToolSchema>;

export type CreateNoteInstruction = {
  fileName: string;
  content?: string;
};

export type CreatePlan = {
  folder: string;
  notes: CreateNoteInstruction[];
};

function executeCreateToolArgs(args: CreateToolArgs): CreatePlan {
  const normalizedNotes: CreateNoteInstruction[] = [];
  // Normalize folder path: trim, normalize slashes, remove leading/trailing slashes
  const trimmedFolder = args.folder.trim();
  const folder = trimmedFolder.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');

  for (const note of args.notes) {
    const trimmedFileName = note.fileName.trim();
    const fileName = trimmedFileName.endsWith('.md') ? trimmedFileName : `${trimmedFileName}.md`;

    normalizedNotes.push({
      fileName,
      content: note.content && note.content.trim().length > 0 ? note.content : undefined,
    });
  }

  return {
    folder,
    notes: normalizedNotes,
  };
}

export class VaultCreate {
  private static readonly createTool = tool({ inputSchema: createToolSchema });

  constructor(private readonly agent: SuperAgent) {}

  public static getCreateTool() {
    return VaultCreate.createTool;
  }
  /**
   * Execute the create plan
   */
  private async executePlan(params: { plan: CreatePlan }): Promise<{
    createdNotes: string[];
    createdNoteLinks: string[];
    errors: string[];
  }> {
    const createdNotes: string[] = [];
    const createdNoteLinks: string[] = [];
    const errors: string[] = [];
    const { plan } = params;

    // Ensure folder exists
    await this.agent.obsidianAPITools.ensureFolderExists(plan.folder);

    for (const note of plan.notes) {
      if (!note.fileName) {
        errors.push('Note file name is missing');
        continue;
      }

      // Build full path: folder/fileName
      const newNotePath = `${plan.folder}/${note.fileName}`;

      try {
        await this.agent.app.vault.create(newNotePath, '');
        createdNotes.push(newNotePath);
        createdNoteLinks.push(`[[${newNotePath}]]`);

        if (note.content) {
          const file = this.agent.app.vault.getFileByPath(newNotePath);
          if (file) {
            await this.agent.app.vault.modify(file, note.content);
          } else {
            errors.push(`Failed to modify ${newNotePath}: File not found or not a valid file`);
          }
        }
      } catch (noteError) {
        const message =
          noteError instanceof Error ? noteError.message : 'Unknown error while creating the note';
        errors.push(`Failed to create ${newNotePath}: ${message}`);
      }
    }

    return {
      createdNotes,
      createdNoteLinks,
      errors,
    };
  }

  /**
   * Handle create tool call in the agent
   */
  public async handle(
    params: AgentHandlerParams,
    options: { toolCall: ToolCallPart<CreateToolArgs> }
  ): Promise<AgentResult> {
    const { title, lang, handlerId, intent } = params;
    const { toolCall } = options;
    const t = getTranslation(lang);

    if (!handlerId) {
      throw new Error('VaultCreate.handle invoked without handlerId');
    }

    const plan = executeCreateToolArgs(toolCall.input);

    if (plan.notes.length === 0) {
      await this.agent.renderer.updateConversationNote({
        path: title,
        newContent: '*No notes were specified for creation*',
        role: 'Steward',
        command: 'vault_create',
        lang,
        handlerId,
        includeHistory: false,
      });

      return {
        status: IntentResultStatus.ERROR,
        error: new Error('No notes specified for creation'),
      };
    }

    if (!intent?.no_confirm) {
      let message = `${t('create.confirmMessage', { count: plan.notes.length })}\n`;
      message += `\n*Folder:* \`${plan.folder}\`\n`;

      for (const note of plan.notes) {
        const fullPath = `${plan.folder}/${note.fileName}`;
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
    createdNotes: string[];
    createdNoteLinks: string[];
    errors: string[];
  }> {
    const { title, plan, lang, handlerId, toolCall } = params;
    const t = getTranslation(lang);

    const creationResult = await this.executePlan({ plan });

    if (creationResult.createdNotes.length > 0) {
      const messageId = await this.agent.renderer.updateConversationNote({
        path: title,
        newContent: t('create.creatingNote', {
          noteName: creationResult.createdNoteLinks.join(', '),
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
            paths: creationResult.createdNotes,
            createdAt: Date.now(),
          },
        });
      }
    }

    let resultMessage = '';
    if (creationResult.createdNotes.length > 0) {
      resultMessage = `*${t('create.success', {
        count: creationResult.createdNotes.length,
        noteName: creationResult.createdNotes.join(', '),
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

    await this.agent.renderer.serializeToolInvocation({
      path: title,
      command: 'vault_create',
      handlerId,
      toolInvocations: [
        {
          ...toolCall,
          type: 'tool-result',
          output: {
            type: 'json',
            value: {
              createdNotes: creationResult.createdNotes,
              errors: creationResult.errors,
            },
          },
        },
      ],
    });

    return creationResult;
  }
}
