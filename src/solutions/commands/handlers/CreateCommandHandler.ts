import { generateText } from 'ai';
import {
  CommandHandler,
  CommandHandlerParams,
  CommandResult,
  CommandResultStatus,
} from '../CommandHandler';
import { getTranslation } from 'src/i18n';
import { ArtifactType } from 'src/solutions/artifact';
import type StewardPlugin from 'src/main';
import { prepareMessage } from 'src/lib/modelfusion/utils/messageUtils';
import { SystemPromptModifier } from '../SystemPromptModifier';
import { ToolRegistry, ToolName } from '../ToolRegistry';
import { createCreateTool, CreatePlan, CreateToolArgs } from '../tools/createNotes';
import { ToolInvocation } from '../tools/types';
import { uniqueID } from 'src/utils/uniqueID';

export class CreateCommandHandler extends CommandHandler {
  constructor(public readonly plugin: StewardPlugin) {
    super();
  }

  /**
   * Render the loading indicator for the create command
   */
  public async renderIndicator(title: string, lang?: string): Promise<void> {
    const t = getTranslation(lang);
    await this.renderer.addGeneratingIndicator(title, t('conversation.creating'));
  }

  /**
   * Handle a create command
   */
  public async handle(
    params: CommandHandlerParams,
    options: {
      plan?: CreatePlan;
      confirmed?: boolean;
    } = {}
  ): Promise<CommandResult> {
    const { title, command, nextCommand, lang } = params;
    const t = getTranslation(lang);
    const handlerId = params.handlerId ?? uniqueID();

    try {
      const plan = options.plan || (await this.createPlan({ title, command, lang, handlerId }));

      if (plan.notes.length === 0) {
        await this.renderer.updateConversationNote({
          path: title,
          newContent: '*No notes were specified for creation*',
          role: 'Steward',
          command: 'create',
          lang,
          handlerId,
          includeHistory: false,
        });

        return {
          status: CommandResultStatus.ERROR,
          error: new Error('No notes specified for creation'),
        };
      }

      if (!options.confirmed && !command.no_confirm) {
        let message = `${t('create.confirmMessage', { count: plan.notes.length })}\n`;

        for (const note of plan.notes) {
          const notePath = note.filePath ? note.filePath : '';
          if (notePath) {
            message += `- \`${notePath}\`\n`;
          }
        }

        message += `\n${t('create.confirmPrompt')}`;

        await this.renderer.updateConversationNote({
          path: title,
          newContent: message,
          role: 'Steward',
          command: 'create',
          lang,
          handlerId,
        });

        return {
          status: CommandResultStatus.NEEDS_CONFIRMATION,
          confirmationMessage: message,
          onConfirmation: () => {
            return this.handle(
              {
                ...params,
                handlerId,
              },
              { plan, confirmed: true }
            );
          },
          onRejection: async () => {
            if (nextCommand && nextCommand.commandType === 'generate') {
              this.commandProcessor.deleteNextPendingCommand(title);
            }
            return {
              status: CommandResultStatus.SUCCESS,
            };
          },
        };
      }

      const creationResult = await this.executePlan({ plan });

      if (creationResult.createdNotes.length > 0) {
        const messageId = await this.renderer.updateConversationNote({
          path: title,
          newContent: t('create.creatingNote', {
            noteName: creationResult.createdNoteLinks.join(', '),
          }),
          role: 'Steward',
          command: 'create',
          lang,
          handlerId,
        });

        if (messageId) {
          await this.plugin.artifactManagerV2.withTitle(title).storeArtifact({
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

        let errorsBlock = '*Errors:*\n';
        for (const errorMessage of creationResult.errors) {
          errorsBlock += `- ${errorMessage}\n`;
        }
        resultMessage += errorsBlock.trimEnd();
      }

      await this.renderer.updateConversationNote({
        path: title,
        newContent: resultMessage,
        lang,
        handlerId,
      });

      return {
        status: CommandResultStatus.SUCCESS,
      };
    } catch (error) {
      await this.renderer.updateConversationNote({
        path: title,
        newContent: `*Error creating notes: ${error.message}*`,
        role: 'Steward',
        lang,
      });

      return {
        status: CommandResultStatus.ERROR,
        error,
      };
    }
  }

  private async createPlan(params: {
    title: string;
    command: CommandHandlerParams['command'];
    lang?: string | null;
    handlerId: string;
  }): Promise<CreatePlan> {
    const { title, command, lang, handlerId } = params;
    const conversationHistory = await this.renderer.extractConversationHistory(title, {
      summaryPosition: 1,
    });

    const llmConfig = await this.plugin.llmService.getLLMConfig({
      overrideModel: command.model,
      generateType: 'text',
    });

    const { createTool, execute } = createCreateTool();
    const modifier = new SystemPromptModifier(command.systemPrompts);
    const tools = {
      [ToolName.CREATE]: createTool,
    };
    const registry = ToolRegistry.buildFromTools(tools, command.tools);
    const userMessage = await prepareMessage(command.query, this.plugin);

    const response = await generateText({
      ...llmConfig,
      abortSignal: this.plugin.abortService.createAbortController('create'),
      system: modifier.apply(`You are a helpful assistant that creates new Obsidian notes.

You have access to the following tools:

${registry.generateToolsSection()}

GUIDELINES:
${registry.generateGuidelinesSection()}
- Always call the ${ToolName.CREATE} tool to create notes requested by the user.
- Provide clear note paths that include the .md extension.
- Include the full Markdown content for each note when the user supplies it.`),
      messages: [...conversationHistory, { role: 'user', content: userMessage }],
      tools: registry.getToolsObject(),
    });

    if (response.text && response.text.trim()) {
      await this.renderer.updateConversationNote({
        path: title,
        newContent: response.text,
        command: 'create',
        includeHistory: false,
        lang,
        handlerId,
      });
    }

    const toolInvocations: ToolInvocation<CreatePlan>[] = [];
    let plan: CreatePlan | null = null;

    for (const toolCall of response.toolCalls) {
      if (toolCall.toolName !== ToolName.CREATE) {
        continue;
      }

      const createArgs = toolCall.args as CreateToolArgs;

      await this.renderer.updateConversationNote({
        path: title,
        newContent: createArgs.explanation,
        command: 'create',
        includeHistory: false,
        lang,
        handlerId,
      });

      const executedPlan = execute(createArgs);
      plan = executedPlan;
      toolInvocations.push({
        toolName: toolCall.toolName,
        toolCallId: toolCall.toolCallId,
        args: toolCall.args,
        result: executedPlan,
      });
    }

    if (toolInvocations.length > 0) {
      await this.renderer.serializeToolInvocation<CreatePlan>({
        path: title,
        command: 'create',
        handlerId,
        toolInvocations,
      });
    }

    if (!plan) {
      throw new Error('No create instructions were generated.');
    }

    return plan;
  }

  private async executePlan(params: { plan: CreatePlan }): Promise<{
    createdNotes: string[];
    createdNoteLinks: string[];
    errors: string[];
  }> {
    const createdNotes: string[] = [];
    const createdNoteLinks: string[] = [];
    const errors: string[] = [];

    for (const note of params.plan.notes) {
      const newNotePath = note.filePath;

      if (!newNotePath) {
        errors.push('Note path is missing');
        continue;
      }

      try {
        await this.app.vault.create(newNotePath, '');
        createdNotes.push(newNotePath);
        createdNoteLinks.push(`[[${newNotePath}]]`);

        if (note.content) {
          const file = this.app.vault.getFileByPath(newNotePath);
          if (file) {
            await this.app.vault.modify(file, note.content);
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
}
