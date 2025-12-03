import { generateText, GenerateTextResult, Message } from 'ai';
import { Agent } from '../../Agent';
import { getTranslation } from 'src/i18n';
import { prepareMessage } from 'src/lib/modelfusion/utils/messageUtils';
import { SystemPromptModifier } from '../../SystemPromptModifier';
import { ToolRegistry, ToolName } from '../../ToolRegistry';
import { uniqueID } from 'src/utils/uniqueID';
import { VaultCreate } from './VaultCreate';
import { VaultList } from './VaultList';
import { DeleteToolArgs, VaultDelete } from './VaultDelete';
import { VaultCopy } from './VaultCopy';
import { VaultMove } from './VaultMove';
import { VaultRename } from './VaultRename';
import { UpdateFrontmatterToolArgs, VaultUpdateFrontmatter } from './VaultUpdateFrontmatter';
import { AgentHandlerParams, AgentResult, IntentResultStatus } from '../../types';
import { activateTools } from '../../tools/activateTools';
import { joinWithConjunction } from 'src/utils/arrayUtils';
import { ArtifactType } from 'src/solutions/artifact';
import { ToolInvocation } from '../../tools/types';

class VaultAgent extends Agent {
  private _vaultCreate: VaultCreate;
  private _vaultMove: VaultMove;
  private _vaultCopy: VaultCopy;
  private _vaultDelete: VaultDelete;
  private _vaultList: VaultList;
  private _vaultRename: VaultRename;
  private _vaultUpdateFrontmatter: VaultUpdateFrontmatter;

  private get vaultMove(): VaultMove {
    if (!this._vaultMove) {
      this._vaultMove = new VaultMove(this);
    }

    return this._vaultMove;
  }

  private get vaultCopy(): VaultCopy {
    if (!this._vaultCopy) {
      this._vaultCopy = new VaultCopy(this);
    }

    return this._vaultCopy;
  }

  private get vaultDelete(): VaultDelete {
    if (!this._vaultDelete) {
      this._vaultDelete = new VaultDelete(this);
    }

    return this._vaultDelete;
  }

  private get vaultCreate(): VaultCreate {
    if (!this._vaultCreate) {
      this._vaultCreate = new VaultCreate(this);
    }

    return this._vaultCreate;
  }

  private get vaultList(): VaultList {
    if (!this._vaultList) {
      this._vaultList = new VaultList(this);
    }

    return this._vaultList;
  }

  private get vaultRename(): VaultRename {
    if (!this._vaultRename) {
      this._vaultRename = new VaultRename(this);
    }

    return this._vaultRename;
  }

  private get vaultUpdateFrontmatter(): VaultUpdateFrontmatter {
    if (!this._vaultUpdateFrontmatter) {
      this._vaultUpdateFrontmatter = new VaultUpdateFrontmatter(this);
    }

    return this._vaultUpdateFrontmatter;
  }

  /**
   * Render the loading indicator for the vault agent
   */
  public async renderIndicator(title: string, lang?: string | null): Promise<void> {
    const t = getTranslation(lang);
    await this.renderer.addGeneratingIndicator(title, t('conversation.orchestrating'));
  }

  /**
   * Craft tool calls without AI help
   */
  private async manualToolCalls(title: string): Promise<ToolInvocation<unknown>[] | undefined> {
    if (this.activeTools.length > 1) {
      return;
    }

    if (this.activeTools.includes(ToolName.DELETE)) {
      const artifact = await this.plugin.artifactManagerV2
        .withTitle(title)
        .getMostRecentArtifactOfTypes([ArtifactType.SEARCH_RESULTS, ArtifactType.CREATED_NOTES]);

      if (artifact) {
        const manualToolCall: ToolInvocation<unknown, DeleteToolArgs> = {
          toolName: ToolName.DELETE,
          toolCallId: `manual-tool-call-${uniqueID()}`,
          args: {
            artifactId: artifact.id,
            explanation: '',
          },
        };

        return [manualToolCall];
      }
    }

    if (this.activeTools.includes(ToolName.UPDATE_FRONTMATTER)) {
      const artifact = await this.plugin.artifactManagerV2
        .withTitle(title)
        .getMostRecentArtifactOfTypes([ArtifactType.SEARCH_RESULTS, ArtifactType.CREATED_NOTES]);

      if (artifact) {
        const manualToolCall: ToolInvocation<unknown, UpdateFrontmatterToolArgs> = {
          toolName: ToolName.UPDATE_FRONTMATTER,
          toolCallId: `manual-tool-call-${uniqueID()}`,
          args: {
            artifactId: artifact.id,
            explanation: '',
          },
        };

        return [manualToolCall];
      }
    }
  }

  /**
   * Handle a vault agent invocation
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
      [ToolName.LIST]: VaultList.getListTool(),
      [ToolName.CREATE]: VaultCreate.getCreateTool(),
      [ToolName.DELETE]: VaultDelete.getDeleteTool(),
      [ToolName.COPY]: VaultCopy.getCopyTool(),
      [ToolName.RENAME]: VaultRename.getRenameTool(),
      [ToolName.MOVE]: VaultMove.getMoveTool(),
      [ToolName.UPDATE_FRONTMATTER]: VaultUpdateFrontmatter.getUpdateFrontmatterTool(),
      [ToolName.ACTIVATE]: activateTools,
    };

    type ToolCalls = GenerateTextResult<typeof tools, unknown>['toolCalls'];

    const manualToolCalls = (await this.manualToolCalls(title)) as ToolCalls;

    let toolCalls: ToolCalls;

    if (manualToolCalls) {
      toolCalls = manualToolCalls;
    } else {
      const conversationHistory = await this.renderer.extractConversationHistory(title, {
        summaryPosition: 1,
      });

      const llmConfig = await this.plugin.llmService.getLLMConfig({
        overrideModel: intent.model,
        generateType: 'text',
      });

      const modifier = new SystemPromptModifier(intent.systemPrompts);

      const activeToolNames =
        activeTools.length > 0 ? [...activeTools, ToolName.ACTIVATE] : [ToolName.ACTIVATE];
      const registry = ToolRegistry.buildFromTools(tools, intent.tools).setActive(activeToolNames);

      const messages: Message[] = conversationHistory;

      // Include user message for the first iteration.
      if (!params.handlerId) {
        const userMessage = await prepareMessage(intent.query, this.plugin);
        messages.push({ role: 'user', content: userMessage } as unknown as Message);
      }

      const response = await generateText({
        ...llmConfig,
        abortSignal: this.plugin.abortService.createAbortController('vault-agent'),
        system:
          modifier.apply(`You are a helpful assistant that helps users manage their Obsidian vault.

You have access to the following tools:
${registry.generateToolsSection()}

GUIDELINES:
${registry.generateGuidelinesSection()}

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
          agent: 'vault',
          lang,
          handlerId,
        });
      }
      toolCalls = response.toolCalls;
    }

    const processToolCalls = async (startIndex: number): Promise<AgentResult> => {
      for (let index = startIndex; index < toolCalls.length; index += 1) {
        const toolCall = toolCalls[index];
        let toolCallResult: AgentResult | undefined;

        switch (toolCall.toolName) {
          case ToolName.LIST: {
            toolCallResult = await this.vaultList.handle(
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

          case ToolName.CREATE: {
            toolCallResult = await this.vaultCreate.handle(
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

          case ToolName.DELETE: {
            toolCallResult = await this.vaultDelete.handle(
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

          case ToolName.COPY: {
            toolCallResult = await this.vaultCopy.handle(
              {
                ...params,
                handlerId,
              },
              { toolCall }
            );
            break;
          }

          case ToolName.RENAME: {
            toolCallResult = await this.vaultRename.handle(
              {
                ...params,
                handlerId,
              },
              { toolCall }
            );
            break;
          }

          case ToolName.MOVE: {
            toolCallResult = await this.vaultMove.handle(
              {
                ...params,
                handlerId,
              },
              { toolCall }
            );
            break;
          }

          case ToolName.UPDATE_FRONTMATTER: {
            toolCallResult = await this.vaultUpdateFrontmatter.handle(
              {
                ...params,
                handlerId,
              },
              { toolCall }
            );
            break;
          }

          case ToolName.ACTIVATE: {
            const { tools, explanation } = toolCall.args;

            if (explanation) {
              await this.renderer.updateConversationNote({
                path: title,
                newContent: explanation,
                agent: 'vault',
                command: 'activate-tools',
                includeHistory: false,
                lang,
                handlerId,
              });
            }

            // Serialize the tool invocation
            await this.renderer.serializeToolInvocation({
              path: title,
              agent: 'vault',
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

    if (toolProcessingResult.status !== IntentResultStatus.SUCCESS || manualToolCalls) {
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

export default VaultAgent;
