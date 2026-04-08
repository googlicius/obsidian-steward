import { z } from 'zod/v3';
import { getBundledLib } from 'src/utils/bundledLibs';
import type { AgentHandlerContext } from '../AgentHandlerContext';
import { ToolCallPart } from '../../tools/types';
import { AgentHandlerParams, AgentResult, IntentResultStatus } from '../../types';
import { getTranslation } from 'src/i18n';
import { logger } from 'src/utils/logger';

/**
 * Schema for a single to-do list step
 */
const todoStepSchema = z.object({
  task: z.string().describe('The task to execute for this step'),
});

const todoWriteCreateSchema = z.object({
  operation: z.literal('create'),
  steps: z
    .array(todoStepSchema)
    .min(1)
    .describe('Array of steps in the to-do list. Each step requires a task.'),
});

const todoWriteUpdateSchema = z.object({
  operation: z.literal('update'),
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

/** Single create/update op (nested discriminatedUnion; root schema is a plain object for provider JSON Schema). */
const todoWriteOperationSchema = z.discriminatedUnion('operation', [
  todoWriteCreateSchema,
  todoWriteUpdateSchema,
]);

const todoWriteSchema = z.object(
  {
    operations: z
      .array(todoWriteOperationSchema)
      .min(1)
      .max(1)
      .describe(
        'Exactly one operation: create a new to-do list or update the current step of the active list.'
      ),
  },
  {
    description:
      'Create or update a to-do list for multi-step tasks. Use a single-element operations array, same pattern as the edit and delete tools.',
  }
);

export type TodoStep = z.infer<typeof todoStepSchema>;
export type TodoWriteArgs = z.infer<typeof todoWriteSchema>;
export type TodoWriteOperation = z.infer<typeof todoWriteOperationSchema>;

/**
 * Whether this tool input is a todo_write update (operations[0].operation === 'update').
 * Exported for SuperAgent / manual tool routing.
 */
export function isTodoWriteUpdateToolInput(input: unknown): boolean {
  if (input === null || typeof input !== 'object') {
    return false;
  }
  const operations = (input as { operations?: unknown }).operations;
  if (!Array.isArray(operations) || operations.length === 0) {
    return false;
  }
  const first = operations[0];
  if (first === null || typeof first !== 'object') {
    return false;
  }
  return (first as { operation?: string }).operation === 'update';
}

/**
 * Extended step type that supports UDC metadata
 * Schema only defines 'task', but UDC can pass additional fields
 */
export type TodoStepWithMetadata = TodoStep & {
  type?: string;
  model?: string;
  systemPrompts?: string[];
  no_confirm?: boolean;
};

/**
 * Manual / UDC create call with metadata on steps (not in Zod schema; passed only from our code).
 */
export type TodoWriteCreateArgsWithMetadata = {
  operations: [
    {
      operation: 'create';
      steps: TodoStepWithMetadata[];
    },
  ];
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
    systemPrompts?: string[];
    no_confirm?: boolean;
  }>;
  currentStep: number;
  createdBy: 'udc' | 'ai';
}

type StepDisplayStatus = 'in_progress' | 'skipped' | 'completed' | 'pending';

export class TodoList {
  constructor(private readonly agent: AgentHandlerContext) {}

  public static async getTodoWriteTool() {
    const { tool } = await getBundledLib('ai');
    return tool({
      inputSchema: todoWriteSchema,
    });
  }

  /**
   * Remove the last steward message for this conversation's visible to-do list (command: todo_write)
   * so we only keep one rendered list in the note.
   */
  private async removePreviousTodoListDisplayMessage(conversationTitle: string): Promise<void> {
    const prev = await this.agent.renderer.findMostRecentMessageMetadata({
      conversationTitle,
      command: 'todo_write',
      role: 'steward',
    });
    if (prev?.ID) {
      await this.agent.renderer.deleteMessageById(conversationTitle, prev.ID);
    }
  }

  private static checkboxTokenForStepStatus(status: StepDisplayStatus): string {
    if (status === 'completed') {
      return '[x]';
    }
    if (status === 'skipped') {
      return '[-]';
    }
    if (status === 'in_progress') {
      return '[>]';
    }
    return '[ ]';
  }

  /**
   * Format the to-do list for display in the conversation note
   */
  private formatTodoList(state: TodoListState, lang?: string | null): string {
    const t = getTranslation(lang);
    const lines: string[] = [];
    lines.push(`**${t('todoList.todoList')}:**\n`);

    for (let i = 0; i < state.steps.length; i++) {
      const step = state.steps[i];
      const stepNumber = i + 1;
      const stepStatus = TodoList.inferStepStatus(step, stepNumber, state.currentStep);
      const box = TodoList.checkboxTokenForStepStatus(stepStatus);
      lines.push(`- ${box} **${t('todoList.step', { index: i + 1 })}** ${step.task}`);
    }

    return lines.join('\n');
  }

  private static inferStepStatus(
    step: TodoListState['steps'][number],
    stepNumber: number,
    currentStep: number
  ): StepDisplayStatus {
    if (step.status) {
      return step.status;
    }
    if (stepNumber < currentStep) {
      return 'completed';
    }
    if (stepNumber === currentStep) {
      return 'in_progress';
    }
    return 'pending';
  }

  /** English labels for todo_write tool results (model-facing only). */
  private static toolResultStatusLabel(stepStatus: StepDisplayStatus): string {
    if (stepStatus === 'completed') {
      return 'Completed';
    }
    if (stepStatus === 'skipped') {
      return 'Skipped';
    }
    if (stepStatus === 'in_progress') {
      return 'In progress';
    }
    return 'Pending';
  }

  /**
   * Rich tool result: steps, statuses, current step, UDC instructions, completion.
   * Kept in English for the model; not localized.
   */
  private async buildTodoWriteToolResultText(state: TodoListState): Promise<string> {
    const lines: string[] = [];

    lines.push('Steps:');
    for (let i = 0; i < state.steps.length; i++) {
      const step = state.steps[i];
      const stepNumber = i + 1;
      const stepStatus = TodoList.inferStepStatus(step, stepNumber, state.currentStep);
      const label = TodoList.toolResultStatusLabel(stepStatus);
      lines.push(`${stepNumber}. [${label}] ${step.task}`);
    }

    lines.push(`\nCurrent step: ${state.currentStep} of ${state.steps.length}`);

    const curIdx = state.currentStep - 1;
    const curStep = state.steps[curIdx];
    // UDC: step-level system_prompt text is surfaced here only (todo_write result), not merged into
    // API system messages; root command system_prompt is applied separately on the intent.
    if (state.createdBy === 'udc' && curStep) {
      if (curStep.systemPrompts && curStep.systemPrompts.length > 0) {
        const resolved =
          await this.agent.plugin.userDefinedCommandService.processSystemPromptsWikilinks(
            curStep.systemPrompts
          );
        lines.push('\nINSTRUCTIONS FOR THE CURRENT STEP:');
        for (let i = 0; i < resolved.length; i++) {
          lines.push(resolved[i]);
        }
      }
      if (curStep.type === 'generate') {
        lines.push(
          '\n[From System] For this step, respond directly only — do not use edit or create tools.'
        );
      }
    }

    const allFinished = state.steps.every((s, i) => {
      const n = i + 1;
      const st = TodoList.inferStepStatus(s, n, state.currentStep);
      return st === 'completed' || st === 'skipped';
    });
    if (allFinished) {
      lines.push('');
      lines.push('All tasks in this to-do list are completed or skipped.');
    }

    return lines.join('\n');
  }

  /**
   * Create or update a to-do list via todo_write
   */
  public async handle(
    params: AgentHandlerParams,
    options: {
      toolCall: ToolCallPart<TodoWriteArgs | TodoWriteCreateArgsWithMetadata>;
      createdBy?: TodoListState['createdBy'];
    }
  ): Promise<AgentResult> {
    const operations = options.toolCall.input.operations;
    if (!operations || operations.length !== 1) {
      return {
        status: IntentResultStatus.ERROR,
        error: new Error('todo_write requires exactly one entry in operations.'),
      };
    }
    const op = operations[0];
    if (op.operation === 'create') {
      return this.handleCreate(
        params,
        options.toolCall as ToolCallPart<TodoWriteCreateArgsWithMetadata>,
        options.createdBy
      );
    }
    return this.handleUpdate(params, options.toolCall as ToolCallPart<TodoWriteArgs>);
  }

  private async handleCreate(
    params: AgentHandlerParams,
    toolCall: ToolCallPart<TodoWriteCreateArgsWithMetadata>,
    createdBy: TodoListState['createdBy'] = 'ai'
  ): Promise<AgentResult> {
    const { title, lang, handlerId } = params;

    if (!handlerId) {
      throw new Error('TodoList.handleCreate invoked without handlerId');
    }

    try {
      const steps = toolCall.input.operations[0].steps;

      if (!steps || steps.length === 0) {
        return {
          status: IntentResultStatus.ERROR,
          error: new Error('To-do list must have at least one step'),
        };
      }

      const newState: TodoListState = {
        steps,
        currentStep: 1,
        createdBy,
      };

      await this.agent.renderer.updateConversationFrontmatter(title, [
        {
          name: 'todo_list',
          value: newState,
        },
      ]);

      const udcCommand = await this.agent.renderer.getConversationProperty<string>(
        title,
        'udc_command'
      );
      const showTodoList = await this.agent.renderer.getConversationProperty<boolean>(
        title,
        'show_todo_list'
      );

      if (!udcCommand || showTodoList) {
        await this.removePreviousTodoListDisplayMessage(title);
        await this.agent.renderer.updateConversationNote({
          path: title,
          newContent: this.formatTodoList(newState, lang),
          command: 'todo_write',
          includeHistory: false,
          lang,
          handlerId,
          step: params.invocationCount,
        });
      }

      const outputText = await this.buildTodoWriteToolResultText(newState);

      await this.agent.renderer.serializeToolInvocation({
        path: title,
        command: 'todo_write',
        handlerId,
        step: params.invocationCount,
        toolInvocations: [
          {
            ...toolCall,
            type: 'tool-result',
            output: {
              type: 'text',
              value: outputText,
            },
          },
        ],
      });

      return {
        status: IntentResultStatus.SUCCESS,
      };
    } catch (error) {
      logger.error('Error handling todo_write:', error);
      return {
        status: IntentResultStatus.ERROR,
        error: error instanceof Error ? error : new Error(String(error)),
      };
    }
  }

  private async handleUpdate(
    params: AgentHandlerParams,
    toolCall: ToolCallPart<TodoWriteArgs>
  ): Promise<AgentResult> {
    const { title, lang, handlerId } = params;

    if (!handlerId) {
      throw new Error('TodoList.handleUpdate invoked without handlerId');
    }

    try {
      const updateOp = toolCall.input.operations[0] as Extract<
        TodoWriteOperation,
        { operation: 'update' }
      >;
      const status = updateOp.status;
      const nextStep = updateOp.nextStep;

      const existingState = await this.agent.renderer.getConversationProperty<TodoListState>(
        title,
        'todo_list'
      );

      if (!existingState || !existingState.steps || existingState.steps.length === 0) {
        return {
          status: IntentResultStatus.ERROR,
          error: new Error(
            'No existing to-do list found. Create one first with todo_write operations: [{ operation: "create", steps: [...] }].'
          ),
        };
      }

      const totalSteps = existingState.steps.length;
      const currentStep = existingState.currentStep;
      const stepIndex = currentStep - 1;

      const updatedSteps = existingState.steps.map((step, index) => {
        if (index === stepIndex) {
          return {
            ...step,
            status,
          };
        }
        return step;
      });

      let targetStep = nextStep ?? currentStep;
      if (targetStep > totalSteps) {
        targetStep = totalSteps;
      }
      if (targetStep < 1) {
        targetStep = 1;
      }

      const newState: TodoListState = {
        steps: updatedSteps,
        currentStep: targetStep,
        createdBy: existingState.createdBy,
      };

      await this.agent.renderer.updateConversationFrontmatter(title, [
        {
          name: 'todo_list',
          value: newState,
        },
      ]);

      const udcCommand = await this.agent.renderer.getConversationProperty<string>(
        title,
        'udc_command'
      );
      const showTodoList = await this.agent.renderer.getConversationProperty<boolean>(
        title,
        'show_todo_list'
      );

      if (!udcCommand || showTodoList) {
        await this.removePreviousTodoListDisplayMessage(title);
        const formattedList = this.formatTodoList(newState, lang);

        await this.agent.renderer.updateConversationNote({
          path: title,
          newContent: formattedList,
          command: 'todo_write',
          includeHistory: false,
          lang,
          handlerId,
          step: params.invocationCount,
        });
      }

      const outputText = await this.buildTodoWriteToolResultText(newState);

      await this.agent.renderer.serializeToolInvocation({
        path: title,
        command: 'todo_write',
        handlerId,
        step: params.invocationCount,
        toolInvocations: [
          {
            ...toolCall,
            type: 'tool-result',
            output: {
              type: 'text',
              value: outputText,
            },
          },
        ],
      });

      return {
        status: IntentResultStatus.SUCCESS,
      };
    } catch (error) {
      logger.error('Error handling todo_write update:', error);
      return {
        status: IntentResultStatus.ERROR,
        error: error instanceof Error ? error : new Error(String(error)),
      };
    }
  }
}
