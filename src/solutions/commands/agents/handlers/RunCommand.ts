import { z } from 'zod/v3';
import { getBundledLib } from 'src/utils/bundledLibs';
import { getBundledInternal } from 'src/utils/bundledInternals';
import type { AgentHandlerContext } from '../AgentHandlerContext';
import { AgentHandlerParams, AgentResult, Intent, IntentResultStatus } from '../../types';
import { ToolCallPart } from '../../tools/types';
import { ToolName } from '../../ToolRegistry';
import { uniqueID } from 'src/utils/uniqueID';
import { MANUAL_TOOL_CALL_ID_PREFIX } from 'src/constants';
import type { IVersionedUserDefinedCommand } from 'src/services/UserDefinedCommandService/versions/types';
import type { UserDefinedCommandService } from 'src/services/UserDefinedCommandService/UserDefinedCommandService';
import { TodoList, type TodoWriteCreateArgsWithMetadata } from './TodoList';

const { getTranslation } = getBundledInternal('i18n');

const runCommandSchema = z.object({
  command_name: z.string().min(1).describe('User-defined command id (same as in the catalog).'),
  query: z
    .string()
    .optional()
    .describe('Optional arguments or user text to pass into the command.'),
});

export type RunCommandArgs = z.infer<typeof runCommandSchema>;

/**
 * Super-agent entry point used to continue after UDC expansion (avoids importing SuperAgent here).
 */
export type RunCommandSuperAgentDelegate = AgentHandlerContext & {
  handle(
    params: AgentHandlerParams,
    options?: {
      remainingSteps?: number;
      toolCalls?: unknown;
      currentToolCallIndex?: number;
    }
  ): Promise<AgentResult>;
};

/**
 * Executes a user-defined command: expands steps, updates frontmatter, bootstraps todo when needed,
 * then delegates to the super agent for the actual work.
 */
export class RunCommand {
  constructor(
    private readonly agent: AgentHandlerContext,
    private readonly superAgent: RunCommandSuperAgentDelegate
  ) {}

  public static async getRunCommandTool() {
    const { tool } = await getBundledLib('ai');
    return tool({
      inputSchema: runCommandSchema,
    });
  }

  public async handle(
    params: AgentHandlerParams,
    options: { toolCall: ToolCallPart<unknown> }
  ): Promise<AgentResult> {
    const parsed = runCommandSchema.safeParse(options.toolCall.input);
    if (!parsed.success) {
      return {
        status: IntentResultStatus.ERROR,
        error: new Error(`Invalid ${ToolName.RUN_COMMAND} input`),
      };
    }

    const { title, lang } = params;
    const commandName = parsed.data.command_name.trim();
    const query = parsed.data.query ?? '';

    const udcService = this.agent.plugin.userDefinedCommandService;
    if (!udcService.hasCommand(commandName)) {
      return {
        status: IntentResultStatus.ERROR,
        error: new Error(`User-defined command '${commandName}' not found or disabled`),
      };
    }

    const intentForExpansion: Intent = {
      ...params.intent,
      type: commandName,
      query,
    };

    const expandedIntents = await udcService.expandUserDefinedCommandIntents(
      intentForExpansion,
      query || intentForExpansion.query || '',
      new Set(),
      title
    );

    if (!expandedIntents || expandedIntents.length === 0) {
      return {
        status: IntentResultStatus.ERROR,
        error: new Error(`User-defined command '${commandName}' not found or empty`),
      };
    }

    const command = udcService.userDefinedCommands.get(commandName);
    const udcTools = command?.getVersion() === 2 ? command.normalized.tools : undefined;
    const showTodoList =
      command?.getVersion() === 2 ? command.normalized.show_todo_list : undefined;
    const frontmatterUpdates: Array<{ name: string; value: string | boolean | string[] }> = [
      { name: 'udc_command', value: commandName },
    ];

    if (udcTools && udcTools.length > 0) {
      frontmatterUpdates.push({ name: 'allowed_tools', value: udcTools });
    }

    if (showTodoList !== undefined) {
      frontmatterUpdates.push({ name: 'show_todo_list', value: showTodoList });
    }

    await this.agent.renderer.updateConversationFrontmatter(title, frontmatterUpdates);

    if (expandedIntents.length === 1) {
      const expanded = expandedIntents[0];
      return this.superAgent.handle({
        ...params,
        intent: {
          ...expanded,
          systemPrompts: await RunCommand.resolveUdcSystemPrompts(udcService, command),
        },
      });
    }

    const todoListSteps = expandedIntents.map(expandedIntent => {
      return {
        type: expandedIntent.type,
        task: expandedIntent.query,
        model: expandedIntent.model,
        systemPrompts: expandedIntent.systemPrompts,
        no_confirm: expandedIntent.no_confirm,
        cli: expandedIntent.cli,
      };
    });

    const todoWriteToolCall: ToolCallPart<TodoWriteCreateArgsWithMetadata> = {
      type: 'tool-call' as const,
      toolName: ToolName.TODO_WRITE,
      toolCallId: `${MANUAL_TOOL_CALL_ID_PREFIX}${uniqueID()}`,
      input: {
        operations: [{ operation: 'create', steps: todoListSteps }],
      },
    };

    const t = getTranslation(lang);
    const todoListBootstrapGuide = t('conversation.udcTodoListBootstrapGuide', {
      commandName: commandName.trim(),
    });
    await this.agent.renderer.addUserMessage({
      path: title,
      newContent: todoListBootstrapGuide,
      step: params.invocationCount,
      contentFormat: 'hidden',
    });

    const todoListHandler = new TodoList(this.superAgent);
    await todoListHandler.handle(params, { toolCall: todoWriteToolCall, createdBy: 'udc' });

    const currentStep = todoListSteps[0];

    const stepIntent: Intent = {
      type: currentStep.type ?? '',
      query: currentStep.task,
      model: currentStep.model,
      no_confirm: currentStep.no_confirm,
      tools: udcTools,
      systemPrompts: await RunCommand.resolveUdcSystemPrompts(udcService, command),
      cli: currentStep.cli,
    };

    return this.superAgent.handle({
      ...params,
      intent: stepIntent,
      activeTools: [ToolName.TODO_WRITE],
      invocationCount: 1,
    });
  }

  private static async resolveUdcSystemPrompts(
    udc: UserDefinedCommandService,
    command: IVersionedUserDefinedCommand | undefined
  ): Promise<string[] | undefined> {
    if (command?.getVersion() !== 2) {
      return undefined;
    }

    const root = command.normalized.system_prompt;
    if (!root || root.length === 0) {
      return undefined;
    }

    const rootLines = root.map(line => udc.replacePlaceholders(line));
    return udc.processSystemPromptsWikilinks(rootLines);
  }
}
