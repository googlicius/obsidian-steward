import { generateText, GenerateTextResult, Message } from 'ai';
import { Agent } from '../../Agent';
import { getTranslation } from 'src/i18n';
import { prepareMessage } from 'src/lib/modelfusion/utils/messageUtils';
import { SystemPromptModifier } from '../../SystemPromptModifier';
import { ToolRegistry, ToolName } from '../../ToolRegistry';
import { uniqueID } from 'src/utils/uniqueID';
import { RevertDelete } from './RevertDelete';
import { RevertMove } from './RevertMove';
import { RevertFrontmatter } from './RevertFrontmatter';
import { AgentHandlerParams, AgentResult, IntentResultStatus } from '../../types';
import { activateTools } from '../../tools/activateTools';
import { getMostRecentArtifact, getArtifactById } from '../../tools/getArtifact';
import { joinWithConjunction } from 'src/utils/arrayUtils';

class RevertAgent extends Agent {
  private _revertDelete: RevertDelete;
  private _revertMove: RevertMove;
  private _revertFrontmatter: RevertFrontmatter;

  private get revertDelete(): RevertDelete {
    if (!this._revertDelete) {
      this._revertDelete = new RevertDelete(this);
    }

    return this._revertDelete;
  }

  private get revertMove(): RevertMove {
    if (!this._revertMove) {
      this._revertMove = new RevertMove(this);
    }

    return this._revertMove;
  }

  private get revertFrontmatter(): RevertFrontmatter {
    if (!this._revertFrontmatter) {
      this._revertFrontmatter = new RevertFrontmatter(this);
    }

    return this._revertFrontmatter;
  }

  /**
   * Render the loading indicator for the revert agent
   */
  public async renderIndicator(title: string, lang?: string | null): Promise<void> {
    const t = getTranslation(lang);
    await this.renderer.addGeneratingIndicator(title, t('conversation.reverting'));
  }

  /**
   * Handle a revert agent invocation
   */
  public async handle(
    params: AgentHandlerParams,
    options: {
      remainingSteps?: number;
    } = {}
  ): Promise<AgentResult> {
    const { title, intent, lang } = params;
    const handlerId = params.handlerId ?? uniqueID();
    const activeTools = params.activeTools || [...this.activeTools];

    const MAX_STEP_COUNT = 10;
    const remainingSteps =
      typeof options.remainingSteps !== 'undefined' ? options.remainingSteps : MAX_STEP_COUNT;

    if (remainingSteps <= 0) {
      return {
        status: IntentResultStatus.SUCCESS,
      };
    }

    const tools = {
      [ToolName.REVERT_DELETE]: RevertDelete.getRevertDeleteTool(),
      [ToolName.REVERT_MOVE]: RevertMove.getRevertMoveTool(),
      [ToolName.REVERT_FRONTMATTER]: RevertFrontmatter.getRevertFrontmatterTool(),
      [ToolName.ACTIVATE]: activateTools,
      [ToolName.GET_MOST_RECENT_ARTIFACT]: getMostRecentArtifact,
      [ToolName.GET_ARTIFACT_BY_ID]: getArtifactById,
    };

    type ToolCalls = GenerateTextResult<typeof tools, unknown>['toolCalls'];

    let toolCalls: ToolCalls = [];

    const conversationHistory = await this.renderer.extractConversationHistory(title, {
      summaryPosition: 1,
    });

    const llmConfig = await this.plugin.llmService.getLLMConfig({
      overrideModel: intent.model,
      generateType: 'text',
    });

    const modifier = new SystemPromptModifier(intent.systemPrompts);

    // Initially, only artifact retrieval tools and ACTIVATE tool are active
    // The agent needs to first get an artifact, then activate the appropriate revert tool
    const initialActiveTools = [
      ToolName.GET_MOST_RECENT_ARTIFACT,
      ToolName.GET_ARTIFACT_BY_ID,
      ToolName.ACTIVATE,
    ];
    const activeToolNames =
      activeTools.length > 0 ? [...activeTools, ...initialActiveTools] : initialActiveTools;
    const registry = ToolRegistry.buildFromTools(tools, intent.tools).setActive(activeToolNames);

    const messages: Message[] = conversationHistory;

    // Include user message for the first iteration.
    if (!params.handlerId) {
      const userMessage = await prepareMessage(intent.query, this.plugin);
      messages.push({ role: 'user', content: userMessage } as unknown as Message);
    }

    const response = await generateText({
      ...llmConfig,
      abortSignal: this.plugin.abortService.createAbortController('revert-agent'),
      system:
        modifier.apply(`You are a helpful assistant that helps users revert operations in their Obsidian vault.

You have access to the following tools:
${registry.generateToolsSection()}

GUIDELINES:
${registry.generateGuidelinesSection()}

WORKFLOW:
1. First, use ${ToolName.GET_MOST_RECENT_ARTIFACT} or ${ToolName.GET_ARTIFACT_BY_ID} to retrieve an artifact from the conversation.
2. Based on the artifact type returned, determine which revert operation is needed and activate the appropriate revert tool using ${ToolName.ACTIVATE} if it's not already active.

NOTE:
- Do NOT repeat the latest tool call result in your final response as it is already rendered in the UI.

OTHER TOOLS:
${registry.generateOtherToolsSection('No other tools available.')}`),
      messages,
      tools: registry.getToolsObject(),
    });

    // Render text response if any
    if (response.text && response.text.trim()) {
      await this.renderer.updateConversationNote({
        path: title,
        newContent: response.text,
        agent: 'revert',
        lang,
        handlerId,
      });
    }
    toolCalls = response.toolCalls;

    const processToolCalls = async (startIndex: number): Promise<AgentResult> => {
      for (let index = startIndex; index < toolCalls.length; index += 1) {
        const toolCall = toolCalls[index];
        let toolCallResult: AgentResult | undefined;

        switch (toolCall.toolName) {
          case ToolName.REVERT_DELETE: {
            toolCallResult = await this.revertDelete.handle(
              {
                ...params,
                handlerId,
              },
              {
                toolCall,
              }
            );
            break;
          }

          case ToolName.REVERT_MOVE: {
            toolCallResult = await this.revertMove.handle(
              {
                ...params,
                handlerId,
              },
              {
                toolCall,
              }
            );
            break;
          }

          case ToolName.REVERT_FRONTMATTER: {
            toolCallResult = await this.revertFrontmatter.handle(
              {
                ...params,
                handlerId,
              },
              {
                toolCall,
              }
            );
            break;
          }

          case ToolName.GET_MOST_RECENT_ARTIFACT: {
            const { artifactTypes } = toolCall.args;
            const t = getTranslation(lang);

            const artifact = await this.plugin.artifactManagerV2
              .withTitle(title)
              .getMostRecentArtifactOfTypes(artifactTypes);

            const result = artifact?.id
              ? `artifactRef:${artifact.id}`
              : {
                  error:
                    t('common.noArtifactsFound') ||
                    'No artifacts found matching the specified types.',
                };

            await this.renderer.serializeToolInvocation({
              path: title,
              agent: 'revert',
              command: 'get-artifact',
              handlerId,
              toolInvocations: [
                {
                  ...toolCall,
                  result,
                },
              ],
            });
            break;
          }

          case ToolName.GET_ARTIFACT_BY_ID: {
            const { artifactId } = toolCall.args;
            const t = getTranslation(lang);

            const artifact = await this.plugin.artifactManagerV2
              .withTitle(title)
              .getArtifactById(artifactId);

            const result = artifact?.id
              ? `artifactRef:${artifact.id}`
              : {
                  error:
                    t('common.artifactNotFound') || `Artifact with ID "${artifactId}" not found.`,
                };

            await this.renderer.serializeToolInvocation({
              path: title,
              agent: 'revert',
              command: 'get-artifact',
              handlerId,
              toolInvocations: [
                {
                  ...toolCall,
                  result,
                },
              ],
            });
            break;
          }

          case ToolName.ACTIVATE: {
            const { tools, explanation } = toolCall.args;

            if (explanation) {
              await this.renderer.updateConversationNote({
                path: title,
                newContent: explanation,
                agent: 'revert',
                command: 'activate-tools',
                includeHistory: false,
                lang,
                handlerId,
              });
            }

            // Serialize the tool invocation
            await this.renderer.serializeToolInvocation({
              path: title,
              agent: 'revert',
              command: 'activate-tools',
              handlerId,
              toolInvocations: [
                {
                  ...toolCall,
                  result: `Requested tools ${joinWithConjunction(tools, 'and')} are now active.`,
                },
              ],
            });

            activeTools.push(...tools);
            break;
          }

          default:
            break;
        }

        if (!toolCallResult) {
          continue;
        }

        if (toolCallResult.status === IntentResultStatus.NEEDS_CONFIRMATION) {
          const originalOnConfirmation = toolCallResult.onConfirmation;
          return {
            ...toolCallResult,
            onConfirmation: async (message: string) => {
              const confirmationResult = await originalOnConfirmation(message);
              if (!confirmationResult || confirmationResult.status === IntentResultStatus.SUCCESS) {
                return processToolCalls(index + 1);
              }
              return confirmationResult;
            },
          };
        }

        if (toolCallResult.status === IntentResultStatus.ERROR) {
          return toolCallResult;
        }
      }

      return {
        status: IntentResultStatus.SUCCESS,
      };
    };

    const toolProcessingResult = await processToolCalls(0);

    if (toolProcessingResult.status !== IntentResultStatus.SUCCESS) {
      return toolProcessingResult;
    }

    const nextRemainingSteps = remainingSteps - 1;

    if (toolCalls.length > 0 && nextRemainingSteps > 0) {
      // Update indicator to show we're continuing to process
      const t = getTranslation(lang);
      await this.renderer.addGeneratingIndicator(title, t('conversation.continuingProcessing'));

      return this.handle(
        {
          ...params,
          handlerId,
          activeTools,
        },
        {
          remainingSteps: nextRemainingSteps,
        }
      );
    }

    return toolProcessingResult;
  }
}

export default RevertAgent;
