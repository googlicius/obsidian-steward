import type StewardPlugin from 'src/main';
import type { ConversationRenderer } from 'src/services/ConversationRenderer';
import { ToolName } from '../ToolRegistry';
import type { TodoListState } from './handlers/TodoList';

type GenerateTodoListPromptParams = {
  renderer: ConversationRenderer;
  title: string;
};

export async function generateTodoListPrompt(
  params: GenerateTodoListPromptParams
): Promise<string> {
  const todoListState = await params.renderer.getConversationProperty<TodoListState>(
    params.title,
    'todo_list'
  );

  if (!todoListState || !todoListState.steps || todoListState.steps.length === 0) {
    return '';
  }

  return `\n\nTO-DO LIST:
You are working on a to-do list with ${todoListState.steps.length} step(s).
Current step: ${todoListState.currentStep} of ${todoListState.steps.length}

Steps:
${todoListState.steps
  .map((step, index) => {
    const status =
      step.status === 'completed'
        ? '✅ Completed'
        : step.status === 'skipped'
          ? '⏭️ Skipped'
          : step.status === 'in_progress'
            ? '🔄 In Progress'
            : '⏳ Pending';
    return `${index + 1}. ${status}: ${step.task}`;
  })
  .join('\n')}

When you complete or skip the current step, use the ${ToolName.TODO_LIST_UPDATE} tool with:
- status: in_progress, skipped, or completed
- nextStep: (optional) the step number to move to after updating`;
}

type GenerateSkillCatalogPromptParams = {
  plugin: StewardPlugin;
};

export function generateSkillCatalogPrompt(params: GenerateSkillCatalogPromptParams): string {
  const catalog = params.plugin.skillService.getSkillCatalog();
  if (catalog.length === 0) {
    return '';
  }

  const entries = catalog
    .map(entry => `- ${entry.name}: ${entry.description} (path: ${entry.path})`)
    .join('\n');

  return `\n\nAVAILABLE SKILLS:
${entries}

When you need domain-specific knowledge for the task, use ${ToolName.CONTENT_READING} to read the skill file by path with readType: "entire".`;
}
