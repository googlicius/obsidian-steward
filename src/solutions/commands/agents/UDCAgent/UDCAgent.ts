import { Agent } from '../../Agent';
import { AgentHandlerParams, AgentResult, Intent, IntentResultStatus } from '../../types';
import { getTranslation } from 'src/i18n';
import { ToolName } from '../../ToolRegistry';
import { uniqueID } from 'src/utils/uniqueID';
import { ToolCallPart } from '../../tools/types';
import { SuperAgent } from '../SuperAgent';
import * as handlers from '../handlers';
import type StewardPlugin from 'src/main';
import { CommandSyntaxParser } from '../../command-syntax-parser';
import type { AgentCorePromptContext } from '../../Agent';
import type { IVersionedUserDefinedCommand } from 'src/services/UserDefinedCommandService/versions/types';

/**
 * Agent for handling User-Defined Commands (UDC)
 * Manages todo list creation
 */
export class UDCAgent extends Agent {
  private superAgent: SuperAgent;

  constructor(plugin: StewardPlugin) {
    super(plugin, [ToolName.TODO_WRITE]);
    this.superAgent = new SuperAgent(plugin);
  }

  public getValidToolNames(): ReadonlySet<ToolName> {
    return this.superAgent.getValidToolNames();
  }

  public buildCorePrompt(context?: AgentCorePromptContext): string {
    return 'No instruction';
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
    const { title, intent, lang } = params;

    // Check if this is actually a UDC
    const isUserDefinedCommand = this.plugin.userDefinedCommandService.hasCommand(intent.type);
    if (!isUserDefinedCommand) {
      // Not a UDC, delegate to SuperAgent
      return this.superAgent.handle(params);
    }

    // Only create todo list on first invocation
    if (!params.invocationCount) {
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

      // Ensure the last step includes c:conclude to stop the agent loop
      UDCAgent.ensureConcludeOnLastStep(expandedIntents);

      const command = this.plugin.userDefinedCommandService.userDefinedCommands.get(intent.type);
      const udcTools = command?.getVersion() === 2 ? command.normalized.tools : undefined;
      const showTodoList =
        command?.getVersion() === 2 ? command.normalized.show_todo_list : undefined;
      const frontmatterUpdates: Array<{ name: string; value: string | boolean | string[] }> = [
        { name: 'udc_command', value: intent.type },
      ];

      if (udcTools && udcTools.length > 0) {
        frontmatterUpdates.push({ name: 'allowed_tools', value: udcTools });
      }

      if (showTodoList !== undefined) {
        frontmatterUpdates.push({ name: 'show_todo_list', value: showTodoList });
      }

      await this.renderer.updateConversationFrontmatter(title, frontmatterUpdates);

      // For single-step commands, skip todo list and delegate directly to SuperAgent
      if (expandedIntents.length === 1) {
        const expanded = expandedIntents[0];
        // Root system_prompt only on the intent; step-level stays off the API system messages
        // (multi-step delivers step text via todo_write tool results only).
        return this.superAgent.handle({
          ...params,
          intent: {
            ...expanded,
            systemPrompts: await this.resolveUdcSystemPrompts(command),
          },
        });
      }

      // Create todo_list state with full metadata (step instructions stay on steps for tool results)
      const todoListSteps = expandedIntents.map(expandedIntent => {
        return {
          type: expandedIntent.type,
          task: expandedIntent.query,
          model: expandedIntent.model,
          systemPrompts: expandedIntent.systemPrompts,
          no_confirm: expandedIntent.no_confirm,
        };
      });

      const todoWriteToolCall: ToolCallPart<handlers.TodoWriteCreateArgsWithMetadata> = {
        type: 'tool-call' as const,
        toolName: ToolName.TODO_WRITE,
        toolCallId: `manual-tool-call-${uniqueID()}`,
        input: {
          operations: [{ operation: 'create', steps: todoListSteps }],
        },
      };

      const t = getTranslation(lang);
      const todoListBootstrapGuide = t('conversation.udcTodoListBootstrapGuide', {
        commandName: intent.type.trim(),
      });
      await this.renderer.addUserMessage({
        path: title,
        newContent: todoListBootstrapGuide,
        step: params.invocationCount,
        contentFormat: 'hidden',
      });

      const todoListHandler = new handlers.TodoList(this.superAgent);
      await todoListHandler.handle(params, { toolCall: todoWriteToolCall, createdBy: 'udc' });

      const currentStep = todoListSteps[0];

      const stepIntent: Intent = {
        type: currentStep.type ?? '',
        query: currentStep.task,
        model: currentStep.model,
        no_confirm: currentStep.no_confirm,
        tools: udcTools,
        systemPrompts: await this.resolveUdcSystemPrompts(command),
      };

      console.log('step intent', stepIntent);

      return this.superAgent.handle({
        ...params,
        intent: stepIntent,
        activeTools: [ToolName.TODO_WRITE],
        invocationCount: 1,
      });
    }

    // Fallback to SuperAgent for subsequent invocations
    return this.superAgent.handle(params);
  }

  private async resolveUdcSystemPrompts(
    command: IVersionedUserDefinedCommand | undefined
  ): Promise<string[] | undefined> {
    if (command?.getVersion() !== 2) {
      return undefined;
    }

    const root = command.normalized.system_prompt;
    if (!root || root.length === 0) {
      return undefined;
    }

    const udc = this.plugin.userDefinedCommandService;
    const rootLines = root.map(line => udc.replacePlaceholders(line));

    return udc.processSystemPromptsWikilinks(rootLines);
  }

  /**
   * Ensure the agent loop terminates after the final step.
   * - If the last intent is command syntax, append `; c:conclude` to it.
   */
  private static ensureConcludeOnLastStep(intents: Intent[]): void {
    if (intents.length === 0) {
      return;
    }

    const lastIntent = intents[intents.length - 1];

    if (!CommandSyntaxParser.isCommandSyntax(lastIntent.query)) {
      return;
    }

    if (lastIntent.query.includes('c:conclude')) {
      return;
    }

    lastIntent.query = `${lastIntent.query.trimEnd()}; c:conclude`;
  }
}
