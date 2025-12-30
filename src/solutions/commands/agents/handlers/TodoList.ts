import { tool } from 'ai';
import { z } from 'zod/v3';
import { type SuperAgent } from '../SuperAgent';
import { ToolCallPart } from '../../tools/types';
import { AgentHandlerParams, AgentResult, IntentResultStatus } from '../../types';
import { getTranslation } from 'src/i18n';
import { logger } from 'src/utils/logger';
import { SystemPromptItem } from '../../SystemPromptModifier';

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
  status: z
    .enum(['in_progress', 'skipped', 'completed'])
    .describe('The status of the current step: in_progress, skipped, or completed.'),
  nextStep: z
    .number()
    .int()
    .min(1)
    .optional()
    .describe(
      'The step number to move to after updating (1-based). If not provided, stays on the current step.'
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
    status?: 'in_progress' | 'skipped' | 'completed';
    // Optional metadata fields - only populated by UDC, not exposed to AI
    type?: string;
    model?: string;
    systemPrompts?: (string | SystemPromptItem)[];
    no_confirm?: boolean;
  }>;
  currentStep: number;
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
      const stepNumber = i + 1; // Convert 0-based index to 1-based step number
      const isCurrent = stepNumber === state.currentStep;

      // Determine status: use stored status if available, otherwise infer from position
      let stepStatus: 'in_progress' | 'skipped' | 'completed' | 'pending';
      if (step.status) {
        stepStatus = step.status;
      } else if (stepNumber < state.currentStep) {
        stepStatus = 'completed';
      } else if (isCurrent) {
        stepStatus = 'in_progress';
      } else {
        stepStatus = 'pending';
      }

      const prefix =
        stepStatus === 'completed'
          ? '✅'
          : stepStatus === 'skipped'
            ? '⏭️'
            : stepStatus === 'in_progress'
              ? '🔄'
              : '⏳';

      const statusText =
        stepStatus === 'completed'
          ? t('todoList.completed')
          : stepStatus === 'skipped'
            ? t('todoList.skipped')
            : stepStatus === 'in_progress'
              ? t('todoList.inProgress')
              : t('todoList.pending');

      lines.push(`${prefix} **${t('todoList.step', { index: i + 1 })}** (${statusText})`);
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
        currentStep: 1,
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
              value: `To-do list created. Current step: ${newState.currentStep} of ${newState.steps.length}`,
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

    if (!handlerId) {
      throw new Error('TodoList.handleUpdate invoked without handlerId');
    }

    try {
      const { status, nextStep } = toolCall.input;

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

      const totalSteps = existingState.steps.length;
      const currentStep = existingState.currentStep;

      // Convert 1-based step number to 0-based index for array access
      const stepIndex = currentStep - 1;

      // Update the status of the current step
      const updatedSteps = existingState.steps.map((step, index) => {
        if (index === stepIndex) {
          return {
            ...step,
            status,
          };
        }
        return step;
      });

      // Determine which step to move to
      // If nextStep is provided, use it; otherwise stay on the current step
      let targetStep = nextStep ?? currentStep;
      if (targetStep > totalSteps) {
        targetStep = totalSteps;
      }
      if (targetStep < 1) {
        targetStep = 1;
      }

      // Create updated state
      const newState: TodoListState = {
        steps: updatedSteps,
        currentStep: targetStep,
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
              value: `To-do list updated. Current step: ${newState.currentStep} of ${newState.steps.length}`,
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
