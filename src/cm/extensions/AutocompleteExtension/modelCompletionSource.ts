import { CompletionContext, CompletionResult, Completion } from '@codemirror/autocomplete';
import { EditorView } from '@codemirror/view';
import {
  LLM_MODELS,
  MODEL_CHANGED,
  SELECTED_MODEL_PREFIX_PATTERN,
  TWO_SPACES_PREFIX,
} from 'src/constants';
import type StewardPlugin from 'src/main';

function getAllModels(plugin: StewardPlugin): Array<{ id: string; name: string }> {
  const customModels: string[] = (plugin.settings.llm.chat.customModels as string[]) || [];

  return [
    ...LLM_MODELS.map(model => ({ id: model.id, name: model.name })),
    ...customModels.map(model => ({
      id: model,
      name: plugin.llmService.getModelDisplayName(model),
    })),
  ];
}

export function createModelCompletionSource(plugin: StewardPlugin) {
  /**
   * Persist the selected model in the setting for new conversation or in the conversation note frontmatter for the current chat.
   */
  async function persistSelectedModel(
    view: EditorView,
    selectedModel: string,
    lineNumber: number
  ): Promise<void> {
    const conversationTitle = plugin.findConversationTitleAbove(view, lineNumber);
    const folderPath = `${plugin.settings.stewardFolder}/Conversations`;
    const notePath = `${folderPath}/${conversationTitle}.md`;
    const hasCurrentConversation = conversationTitle && plugin.app.vault.getFileByPath(notePath);

    if (hasCurrentConversation) {
      await plugin.conversationRenderer.updateConversationFrontmatter(conversationTitle, [
        { name: 'model', value: selectedModel },
      ]);
      return;
    }

    plugin.settings.llm.chat.model = selectedModel;
    await plugin.saveSettings();
  }

  return (context: CompletionContext): CompletionResult | null => {
    const line = context.state.doc.lineAt(context.pos);

    const inputPrefix = plugin.commandInputService.getInputPrefix(line, context.state.doc);
    if (!inputPrefix) return null;

    const contentStart = line.text.startsWith(TWO_SPACES_PREFIX)
      ? TWO_SPACES_PREFIX.length
      : line.text.indexOf(' ') + 1;

    const lineContent = line.text.substring(contentStart);
    const modelPattern = new RegExp(SELECTED_MODEL_PREFIX_PATTERN, 'gi');
    const matches = Array.from(lineContent.matchAll(modelPattern));

    if (matches.length === 0) return null;

    const lastMatch = matches[matches.length - 1];
    const lastMatchIndex = lastMatch.index ?? 0;
    const afterMatch = lineContent.slice(lastMatchIndex + lastMatch[0].length);

    if (lastMatchIndex > 0 && lineContent[lastMatchIndex - 1] !== ' ') return null;
    if (afterMatch.includes(' ')) return null;

    const allModels = getAllModels(plugin);
    const currentModel = plugin.settings.llm.chat.model;

    const duplicateIds = new Set(
      allModels
        .map(m => plugin.llmService.parseModel(m.id).modelId)
        .filter((id, _, arr) => arr.indexOf(id) !== arr.lastIndexOf(id))
    );

    const options: Completion[] = allModels.map(model => {
      const { provider, modelId } = plugin.llmService.parseModel(model.id);
      const isCurrent = model.id === currentModel;
      const displayName = duplicateIds.has(modelId) ? `${modelId} - ${provider}` : modelId;
      const label =
        displayName.length > 25
          ? `${displayName.slice(0, 25)}...${isCurrent ? ' (Current)' : ''}`
          : `${displayName}${isCurrent ? ' (Current)' : ''}`;

      return {
        label,
        type: 'constant' as const,
        apply: (view, _completion, from, to) => {
          const lineNumber = view.state.doc.lineAt(from).number;

          void persistSelectedModel(view, model.id, lineNumber);
          view.dispatch({
            changes: { from: from - matches[0][0].length, to, insert: '' },
          });
          view.dom.dispatchEvent(new CustomEvent(MODEL_CHANGED));
        },
      };
    });

    return {
      from: line.from + contentStart + lastMatchIndex + lastMatch[0].length,
      options,
      filter: true,
      validFor: /^[\w:.-]*$/i,
    };
  };
}
