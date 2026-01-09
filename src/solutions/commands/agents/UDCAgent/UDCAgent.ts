import { Agent } from '../../Agent';
import { AgentHandlerParams, AgentResult, Intent, IntentResultStatus } from '../../types';
import { getTranslation } from 'src/i18n';
import { logger } from 'src/utils/logger';
import { ToolName } from '../../ToolRegistry';
import { uniqueID } from 'src/utils/uniqueID';
import { ToolCallPart } from '../../tools/types';
import { SuperAgent } from '../SuperAgent';
import * as handlers from '../handlers';
import type StewardPlugin from 'src/main';

/**
 * Agent for handling User-Defined Commands (UDC)
 * Manages todo list creation
 */
export class UDCAgent extends Agent {
  private superAgent: SuperAgent;

  constructor(plugin: StewardPlugin) {
    super(plugin, [ToolName.TODO_LIST_UPDATE]);
    this.superAgent = new SuperAgent(plugin);
  }

  /**
   * Render the loading indicator for UDC agent
   */
  public async renderIndicator(title: string, lang?: string | null): Promise<void> {
    const t = getTranslation(lang);
    await this.renderer.addGeneratingIndicator(title, t('conversation.planning'));
  }

  /**
   * Handle a UDC invocation
   */
  public async handle(params: AgentHandlerParams): Promise<AgentResult> {
    const { title, intent } = params;

    // Check if this is actually a UDC
    const isUserDefinedCommand = this.plugin.userDefinedCommandService.hasCommand(intent.type);
    if (!isUserDefinedCommand) {
      // Not a UDC, delegate to SuperAgent
      return this.superAgent.handle(params);
    }

    // Only create todo list on first invocation
    if (!params.invocationCount) {
      try {
        const expandedIntents =
          await this.plugin.userDefinedCommandService.expandUserDefinedCommandIntents(
            intent,
            intent.query || ''
          );

        if (!expandedIntents || expandedIntents.length === 0) {
          return {
            status: IntentResultStatus.ERROR,
            error: new Error(`User-defined command '${intent.type}' not found or empty`),
          };
        }

        await this.renderer.updateConversationFrontmatter(title, [
          { name: 'udc_command', value: intent.type },
        ]);

        // For single-step commands, skip todo list and delegate directly to SuperAgent
        if (expandedIntents.length === 1) {
          // Delegate directly to SuperAgent with the expanded intent
          return this.superAgent.handle({
            ...params,
            intent: expandedIntents[0],
          });
        }

        // Create todo_list state with full metadata
        const todoListSteps = expandedIntents.map(expandedIntent => {
          let systemPrompts = expandedIntent.systemPrompts;
          if (expandedIntent.type === 'generate') {
            if (!Array.isArray(systemPrompts)) {
              systemPrompts = [];
            }
            systemPrompts.push(`This step you generate directly, no edit or create.`);
          }
          return {
            type: expandedIntent.type,
            task: expandedIntent.query,
            model: expandedIntent.model,
            systemPrompts,
            no_confirm: expandedIntent.no_confirm,
          };
        });

        // Create manual tool call to create the todo list with full metadata
        // Note: The schema only defines 'task', but we pass all metadata which will be preserved
        const todoListToolCall: ToolCallPart<handlers.TodoListArgsWithMetadata> = {
          type: 'tool-call' as const,
          toolName: ToolName.TODO_LIST,
          toolCallId: `manual-tool-call-${uniqueID()}`,
          input: {
            steps: todoListSteps,
          },
        };

        // Execute the todo list creation
        const todoListHandler = new handlers.TodoList(this.superAgent);
        await todoListHandler.handle(params, { toolCall: todoListToolCall, createdBy: 'udc' });

        // Update user message to guide AI
        const currentStep = todoListSteps[0];

        // Create new intent with step metadata
        const stepIntent: Intent = {
          type: currentStep.type ?? '',
          query: 'Help me with the to-do list, starting with the first step',
          model: currentStep.model,
          systemPrompts: currentStep.systemPrompts,
          no_confirm: currentStep.no_confirm,
        };

        // Delegate to SuperAgent with step intent - SuperAgent will handle the rest
        return this.superAgent.handle({
          ...params,
          intent: stepIntent,
          activeTools: [ToolName.TODO_LIST_UPDATE],
          invocationCount: 1,
        });
      } catch (error) {
        logger.error('Error creating UDC todo list:', error);
        return {
          status: IntentResultStatus.ERROR,
          error: error instanceof Error ? error : new Error(String(error)),
        };
      }
    }

    // Fallback to SuperAgent for subsequent invocations
    return this.superAgent.handle(params);
  }
}
