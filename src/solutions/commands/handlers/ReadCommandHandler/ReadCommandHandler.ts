import {
  CommandHandler,
  CommandHandlerParams,
  CommandResult,
  CommandResultStatus,
} from '../../CommandHandler';
import { getTranslation } from 'src/i18n';
import { ArtifactType } from 'src/solutions/artifact';
import type StewardPlugin from 'src/main';
import { generateText, tool, Message, generateId } from 'ai';
import { contentReadingSchema } from './zSchemas';
import { ContentReadingResult } from 'src/services/ContentReadingService';
import { logger } from 'src/utils/logger';
import { COMMAND_DEFINITIONS } from 'src/lib/modelfusion/prompts/commands';
import { languageEnforcementFragment } from 'src/lib/modelfusion/prompts/fragments';
import { CONFIRMATION_TOOL_NAME, ASK_USER_TOOL_NAME, createAskUserTool } from '../../tools/askUser';
import { ToolInvocation } from '../../tools/types';
import { uniqueID } from 'src/utils/uniqueID';

const CONTENT_READING_TOOL_NAME = 'contentReading';

const { askUserTool: confirmationTool } = createAskUserTool('confirmation');
const { askUserTool } = createAskUserTool('ask');

export class ReadCommandHandler extends CommandHandler {
  constructor(public readonly plugin: StewardPlugin) {
    super();
  }

  /**
   * Extract reading instructions from a command using LLM
   */
  private async extractReadContent(params: CommandHandlerParams, messages: Message[]) {
    const { command } = params;
    const llmConfig = await this.plugin.llmService.getLLMConfig({
      overrideModel: command.model,
      generateType: 'text',
    });

    const readCommandQueryTemplate = COMMAND_DEFINITIONS.find(
      command => command.commandType === 'read'
    )?.queryTemplate;

    return generateText({
      ...llmConfig,
      abortSignal: this.plugin.abortService.createAbortController('content-reading'),
      system: `You are a helpful assistant that analyzes user queries to determine which content from their Obsidian note to read.

You have access to the following tools:

1. ${CONTENT_READING_TOOL_NAME} - Read content from a note.
2. ${CONFIRMATION_TOOL_NAME} - Get confirmation from the user before performing an action.
3. ${ASK_USER_TOOL_NAME} - Ask the user for additional information or clarification when needed.

GUIDELINES:
- Use ${CONTENT_READING_TOOL_NAME} to read any type of content, including text, image, audio, video, etc.
- You MUST use ${CONFIRMATION_TOOL_NAME} BEFORE reading the entire content of any note. (When readType is "entire")
- Use ${CONFIRMATION_TOOL_NAME} once for all note(s) to be read.
- Use ${ASK_USER_TOOL_NAME} when you need clarification or additional information from the user to fulfill their request.
- Do NOT repeat the content in your final response.
- Read ALL notes at once with multiple ${CONTENT_READING_TOOL_NAME} tool calls.

This is the structure of the query template:
<read_query_template>
${readCommandQueryTemplate}
</read_query_template>
${languageEnforcementFragment}`,
      messages,
      tools: {
        [CONTENT_READING_TOOL_NAME]: tool({
          parameters: contentReadingSchema,
        }),
        [CONFIRMATION_TOOL_NAME]: confirmationTool,
        [ASK_USER_TOOL_NAME]: askUserTool,
      },
    });
  }

  /**
   * Render the loading indicator for the read command
   */
  public async renderIndicator(title: string, lang?: string | null): Promise<void> {
    const t = getTranslation(lang);
    await this.renderer.addGeneratingIndicator(title, t('conversation.readingContent'));
  }

  /**
   * Handle a read command
   */
  public async handle(
    params: CommandHandlerParams,
    options: {
      /**
       * The extraction result from the LLM before confirmation
       */
      extraction?: unknown;
      /**
       * Remaining steps for the LLM to execute
       */
      remainingSteps?: number;
      /**
       * Current position in the toolCalls array
       */
      toolCallIndex?: number;
      /**
       * Messages in this command
       */
      internalMessages?: Message[];
    } = {}
  ): Promise<CommandResult> {
    const { title, command, nextCommand, handlerId = uniqueID() } = params;
    const t = getTranslation(params.lang);
    type ExtractReadContentResult = Awaited<ReturnType<typeof this.extractReadContent>>;

    const readTypeMatches = command.query.match(/read type:/g);
    const notesToRead = readTypeMatches ? readTypeMatches.length : 0;
    // Set maxSteps based on the notesToRead to skip the last evaluation step
    const maxSteps = notesToRead > 0 ? notesToRead : 10;

    if (typeof options.internalMessages === 'undefined') {
      const previousInternalMessages = await this.renderer.getMessagesByHandlerId(title, handlerId);
      if (previousInternalMessages.length > 0) {
        logger.log(
          `ReadCommandHandler: Found ${previousInternalMessages.length} previous internal messages`
        );
      }
      options.internalMessages = [
        ...previousInternalMessages,
        { role: 'user', content: command.query, id: generateId() },
      ];
    }

    // Use maxSteps as the default for remainingSteps if not provided
    const remainingSteps = options.remainingSteps !== undefined ? options.remainingSteps : maxSteps;

    if (remainingSteps <= 0) {
      await this.renderer.updateConversationNote({
        path: title,
        newContent: `*Error: I have reached the maximum number of steps.*`,
        lang: params.lang,
      });
      return {
        status: CommandResultStatus.ERROR,
        error: new Error('The read command has reached the maximum number of steps'),
      };
    }

    const extraction =
      (options.extraction as ExtractReadContentResult) ||
      (await this.extractReadContent(params, options.internalMessages));

    // If there's text and no more steps or no next command, update conversation
    if (extraction.text) {
      if (!nextCommand || extraction.steps.length === 0) {
        await this.renderer.updateConversationNote({
          path: title,
          newContent: extraction.text,
          command: 'read',
          lang: params.lang,
          handlerId,
        });
      }
    }

    const startIndex = options.toolCallIndex || 0;

    const toolInvocations: ToolInvocation<string | ContentReadingResult>[] = [];
    const toolInvocationArtifactRefs = [];

    for (let i = startIndex; i < extraction.toolCalls.length; i++) {
      const toolCall = extraction.toolCalls[i];
      if (
        toolCall.toolName === CONFIRMATION_TOOL_NAME ||
        toolCall.toolName === ASK_USER_TOOL_NAME
      ) {
        await this.renderer.updateConversationNote({
          path: title,
          newContent: toolCall.args.message,
          command: 'read',
          lang: params.lang,
          handlerId,
        });

        const callBack = async (message: string): Promise<CommandResult> => {
          toolInvocations.push({
            ...toolCall,
            result: message,
          });

          options.internalMessages?.push({
            id: extraction.response.id,
            content: '',
            parts: [
              {
                type: 'tool-invocation',
                toolInvocation: {
                  ...toolCall,
                  state: 'result',
                  result: message,
                },
              },
            ],
            role: 'assistant',
          });

          await this.renderIndicator(title, params.lang);

          const nextIndex = i + 1;

          return this.handle(params, {
            ...(nextIndex < extraction.toolCalls.length && {
              extraction,
              toolCallIndex: nextIndex,
            }),
            remainingSteps,
            internalMessages: options.internalMessages,
          });
        };

        if (toolCall.toolName === CONFIRMATION_TOOL_NAME) {
          return {
            status: CommandResultStatus.NEEDS_CONFIRMATION,
            onConfirmation: callBack,
          };
        } else {
          return {
            status: CommandResultStatus.NEEDS_USER_INPUT,
            onUserInput: callBack,
          };
        }
      } else if (toolCall.toolName === CONTENT_READING_TOOL_NAME) {
        // Execute the content reading
        let result: ContentReadingResult | string;
        try {
          result = await this.plugin.contentReadingService.readContent(toolCall.args);
        } catch (error) {
          result = error.message as string;
        }

        toolInvocations.push({
          ...toolCall,
          result,
        });

        // Process the result
        if (typeof result === 'string') {
          await this.renderer.updateConversationNote({
            path: title,
            newContent: `*${result}*`,
            command: 'read',
            handlerId,
          });
          continue;
        }

        await this.renderer.updateConversationNote({
          path: title,
          newContent: toolCall.args.explanation,
          role: 'Steward',
          command: 'read',
          includeHistory: false,
          lang: params.lang,
          handlerId,
        });

        // Show found placeholder if available
        if (toolCall.args.foundPlaceholder) {
          await this.renderer.updateConversationNote({
            path: title,
            newContent: toolCall.args.foundPlaceholder.replace(
              '{{number}}',
              result.blocks.length.toString()
            ),
            includeHistory: false,
            handlerId,
          });
        }

        // Display each block
        if (!nextCommand || nextCommand.commandType === 'read') {
          for (const block of result.blocks) {
            const endLine = this.plugin.editor.getLine(block.endLine);
            await this.renderer.updateConversationNote({
              path: title,
              newContent: this.plugin.noteContentService.formatCallout(
                block.content,
                'stw-search-result',
                {
                  startLine: block.startLine,
                  endLine: block.endLine,
                  start: 0,
                  end: endLine.length,
                  path: result.file?.path,
                }
              ),
              includeHistory: false,
              handlerId,
            });
          }
        }

        const artifactId = await this.plugin.artifactManagerV2.withTitle(title).storeArtifact({
          text: `*${t('common.artifactCreated', { type: ArtifactType.READ_CONTENT })}*`,
          artifact: {
            artifactType: ArtifactType.READ_CONTENT,
            readingResult: result,
          },
        });

        toolInvocationArtifactRefs.push({
          ...toolCall,
          result: `artifactRef:${artifactId}`,
        });
      }
    }

    if (toolInvocationArtifactRefs.length > 0) {
      await this.renderer.serializeToolInvocation({
        path: title,
        command: 'read',
        toolInvocations: toolInvocationArtifactRefs,
        handlerId,
      });
    }

    // If there are more toolCalls, continue
    if (extraction.toolCalls.length > 0) {
      // Calculate remaining steps
      const newRemainingSteps =
        remainingSteps > 0 ? remainingSteps - extraction.toolCalls.length : 0;

      // Continue handling if there are steps remaining
      if (newRemainingSteps > 0) {
        await this.renderIndicator(title, params.lang);

        // Keep track of the assistant's requests and the user's responses for tool calls
        options.internalMessages.push({
          id: extraction.response.id,
          content: '',
          parts: toolInvocations.map(item => ({
            type: 'tool-invocation',
            toolInvocation: {
              ...item,
              state: 'result',
            },
          })),
          role: 'assistant',
        });

        return this.handle(params, {
          remainingSteps: newRemainingSteps,
          internalMessages: options.internalMessages,
        });
      }
    }

    return {
      status: CommandResultStatus.SUCCESS,
    };
  }
}
