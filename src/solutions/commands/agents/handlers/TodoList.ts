import { tool } from 'ai';
import { z } from 'zod/v3';
import { type SuperAgent } from '../SuperAgent';
import { ToolCallPart } from '../../tools/types';
import { AgentHandlerParams, AgentResult, IntentResultStatus } from '../../types';
import { getTranslation } from 'src/i18n';
import { logger } from 'src/utils/logger';
import { SystemPromptItem } from '../../SystemPromptModifier';
import { ToolName } from '../../ToolRegistry';

/**
 * Schema for a single to-do list step
 */
const todoStepSchema = z.object({
  task: z.string().describe('The task to execute for this step'),
});

/**
 * Schema for the to-do list tool input (create only)
 */
const todoListSchema = z.object({
  steps: z
    .array(todoStepSchema)
    .min(1)
    .describe('Array of steps in the to-do list. Each step requires a task.'),
});

/**
 * Schema for the to-do list update tool input
 */
const todoListUpdateSchema = z.object({
  currentStepIndex: z.number().int().min(0).describe('The current step index (0-based).'),
  steps: z
    .array(todoStepSchema)
    .optional()
    .describe(
      'Optional array of steps to update the to-do list. If not provided, existing steps are kept.'
    ),
});

export type TodoStep = z.infer<typeof todoStepSchema>;
export type TodoListArgs = z.infer<typeof todoListSchema>;
export type TodoListUpdateArgs = z.infer<typeof todoListUpdateSchema>;

/**
 * Extended step type that supports UDC metadata
 * Schema only defines 'task', but UDC can pass additional fields
 */
export type TodoStepWithMetadata = TodoStep & {
  type?: string;
  model?: string;
  systemPrompts?: (string | SystemPromptItem)[];
  no_confirm?: boolean;
};

/**
 * Extended todo list args that supports UDC metadata in steps
 */
export type TodoListArgsWithMetadata = {
  steps: TodoStepWithMetadata[];
};

/**
 * To-do list state stored in frontmatter
 * For UDC: steps include metadata (model, systemPrompts, no_confirm)
 * For AI: steps only include task (metadata is hidden from AI schema)
 */
export interface TodoListState {
  steps: Array<{
    task: string;
    // Optional metadata fields - only populated by UDC, not exposed to AI
    type?: string;
    model?: string;
    systemPrompts?: (string | SystemPromptItem)[];
    no_confirm?: boolean;
  }>;
  currentStepIndex: number;
}

export class TodoList {
  private static readonly todoListTool = tool({
    inputSchema: todoListSchema,
  });

  private static readonly todoListUpdateTool = tool({
    inputSchema: todoListUpdateSchema,
  });

  constructor(private readonly agent: SuperAgent) {}

  public static getTodoListTool() {
    return TodoList.todoListTool;
  }

  public static getTodoListUpdateTool() {
    return TodoList.todoListUpdateTool;
  }

  /**
   * Format the to-do list for display
   */
  private formatTodoList(state: TodoListState, lang?: string | null): string {
    const t = getTranslation(lang);
    const lines: string[] = [];
    lines.push(`**${t('todoList.todoList')}:**\n`);

    for (let i = 0; i < state.steps.length; i++) {
      const step = state.steps[i];
      const isCurrent = i === state.currentStepIndex;
      const isCompleted = i < state.currentStepIndex;
      const prefix = isCompleted ? '✅' : isCurrent ? '🔄' : '⏳';
      const status = isCompleted
        ? t('todoList.completed')
        : isCurrent
          ? t('todoList.inProgress')
          : t('todoList.pending');

      lines.push(`${prefix} **${t('todoList.step', { index: i + 1 })}** (${status})`);
      lines.push(`   Task: ${step.task}`);
      lines.push('');
    }

    return lines.join('\n');
  }

  /**
   * Handle to-do list tool call
   */
  public async handle(
    params: AgentHandlerParams,
    options: { toolCall: ToolCallPart<TodoListArgs | TodoListArgsWithMetadata> }
  ): Promise<AgentResult> {
    const { title, lang, handlerId } = params;
    const { toolCall } = options;
    const t = getTranslation(lang);

    if (!handlerId) {
      throw new Error('TodoList.handle invoked without handlerId');
    }

    try {
      const { steps } = toolCall.input;

      if (!steps || steps.length === 0) {
        return {
          status: IntentResultStatus.ERROR,
          error: new Error('To-do list must have at least one step'),
        };
      }

      // Create new to-do list state
      const newState: TodoListState = {
        steps,
        currentStepIndex: 0,
      };

      // Store in frontmatter
      await this.agent.renderer.updateConversationFrontmatter(title, [
        {
          name: 'todo_list',
          value: newState,
        },
      ]);

      // Check if this is a UDC command - skip UI rendering for UDC
      const udcCommand = await this.agent.renderer.getConversationProperty<string>(
        title,
        'udc_command'
      );

      // Only render UI if not a UDC command
      if (!udcCommand) {
        await this.agent.renderer.updateConversationNote({
          path: title,
          newContent: this.formatTodoList(newState, lang),
          command: 'todo_list',
          includeHistory: false,
          lang,
          handlerId,
          step: params.invocationCount,
        });
      }

      // Serialize the tool invocation
      await this.agent.renderer.serializeToolInvocation({
        path: title,
        command: 'todo_list',
        handlerId,
        step: params.invocationCount,
        toolInvocations: [
          {
            ...toolCall,
            type: 'tool-result',
            output: {
              type: 'text',
              value: `To-do list created. Current step: ${newState.currentStepIndex + 1} of ${newState.steps.length}`,
            },
          },
        ],
      });

      return {
        status: IntentResultStatus.SUCCESS,
      };
    } catch (error) {
      logger.error('Error handling to-do list:', error);
      return {
        status: IntentResultStatus.ERROR,
        error: error instanceof Error ? error : new Error(String(error)),
      };
    }
  }

  /**
   * Handle to-do list update tool call
   */
  public async handleUpdate(
    params: AgentHandlerParams,
    options: { toolCall: ToolCallPart<TodoListUpdateArgs> }
  ): Promise<AgentResult> {
    const { title, lang, handlerId } = params;
    const { toolCall } = options;
    const t = getTranslation(lang);

    if (!handlerId) {
      throw new Error('TodoList.handleUpdate invoked without handlerId');
    }

    try {
      const { currentStepIndex, steps } = toolCall.input;

      // Get existing to-do list state from frontmatter
      const existingState = await this.agent.renderer.getConversationProperty<TodoListState>(
        title,
        'todo_list'
      );

      if (!existingState || !existingState.steps || existingState.steps.length === 0) {
        return {
          status: IntentResultStatus.ERROR,
          error: new Error('No existing to-do list found. Create one first using todo_list tool.'),
        };
      }

      // Use existing steps if not provided, otherwise use new steps
      const stepsToUse = steps || existingState.steps;

      if (!stepsToUse || stepsToUse.length === 0) {
        return {
          status: IntentResultStatus.ERROR,
          error: new Error('To-do list must have at least one step'),
        };
      }

      // Ensure currentStepIndex is within bounds
      let newCurrentStepIndex = currentStepIndex;
      if (newCurrentStepIndex >= stepsToUse.length) {
        newCurrentStepIndex = stepsToUse.length - 1;
      }
      if (newCurrentStepIndex < 0) {
        newCurrentStepIndex = 0;
      }

      // Create updated state
      const newState: TodoListState = {
        steps: stepsToUse,
        currentStepIndex: newCurrentStepIndex,
      };

      // Store in frontmatter
      await this.agent.renderer.updateConversationFrontmatter(title, [
        {
          name: 'todo_list',
          value: newState,
        },
      ]);

      // Check if this is a UDC command - skip UI rendering for UDC
      const udcCommand = await this.agent.renderer.getConversationProperty<string>(
        title,
        'udc_command'
      );

      // Only render UI if not a UDC command
      if (!udcCommand) {
        // Format and render the to-do list (not in history)
        const formattedList = this.formatTodoList(newState, lang);

        await this.agent.renderer.updateConversationNote({
          path: title,
          newContent: formattedList,
          command: 'todo_list_update',
          includeHistory: false,
          lang,
          handlerId,
          step: params.invocationCount,
        });
      }

      // Serialize the tool invocation
      await this.agent.renderer.serializeToolInvocation({
        path: title,
        command: 'todo_list_update',
        handlerId,
        step: params.invocationCount,
        toolInvocations: [
          {
            ...toolCall,
            type: 'tool-result',
            output: {
              type: 'text',
              value: `To-do list updated. Current step: ${newState.currentStepIndex + 1} of ${newState.steps.length}`,
            },
          },
        ],
      });

      // Return success - let SuperAgent decide what to do next
      return {
        status: IntentResultStatus.SUCCESS,
      };
    } catch (error) {
      logger.error('Error handling to-do list update:', error);
      return {
        status: IntentResultStatus.ERROR,
        error: error instanceof Error ? error : new Error(String(error)),
      };
    }
  }
}
