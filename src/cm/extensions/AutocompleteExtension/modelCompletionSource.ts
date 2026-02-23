import { CompletionContext, CompletionResult, Completion } from '@codemirror/autocomplete';
import { COMMAND_PREFIXES, LLM_MODELS } from 'src/constants';
import type StewardPlugin from 'src/main';

const MODEL_SELECTOR_PATTERN = '^(m|model):';

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

function isModelSelectorPattern(text: string): boolean {
  const regex = new RegExp(MODEL_SELECTOR_PATTERN, 'i');
  return regex.test(text);
}

export function createModelCompletionSource(plugin: StewardPlugin) {
  return (context: CompletionContext): CompletionResult | null => {
    const { state, pos } = context;
    const line = state.doc.lineAt(pos);
    const lineText = line.text;

    if (!lineText.startsWith('/')) return null;

    const matchedBuiltInCommand = COMMAND_PREFIXES.find(prefix => {
      if (prefix === '/ ') {
        return lineText === '/ ' || lineText.startsWith('/ ');
      }
      return lineText === prefix + ' ' || lineText.startsWith(prefix + ' ');
    });

    let afterCommand: string;
    let commandLength: number;

    if (matchedBuiltInCommand) {
      afterCommand =
        matchedBuiltInCommand === '/ '
          ? lineText.substring(2)
          : lineText.substring(matchedBuiltInCommand.length + 1);
      commandLength = matchedBuiltInCommand === '/ ' ? 2 : matchedBuiltInCommand.length + 1;
    } else {
      const customCommands = plugin.userDefinedCommandService.getCommandNames();
      const matchedCustomCommand = customCommands.find((cmd: string) => {
        const commandPrefix = '/' + cmd;
        return lineText === commandPrefix + ' ' || lineText.startsWith(commandPrefix + ' ');
      });

      if (!matchedCustomCommand) return null;

      const commandPrefix = '/' + matchedCustomCommand;
      afterCommand = lineText.substring(commandPrefix.length + 1);
      commandLength = commandPrefix.length + 1;
    }

    if (!isModelSelectorPattern(afterCommand)) return null;

    const modelSelectorMatch = afterCommand.match(new RegExp(MODEL_SELECTOR_PATTERN, 'i'));
    if (!modelSelectorMatch || modelSelectorMatch.index === undefined) return null;

    const selectorStart = line.from + commandLength + modelSelectorMatch.index;
    const selectorLength = modelSelectorMatch[0].length;

    const allModels = getAllModels(plugin);

    const modelNameCounts = new Map<string, number>();
    for (const model of allModels) {
      const { modelId } = plugin.llmService.parseModel(model.id);
      modelNameCounts.set(modelId, (modelNameCounts.get(modelId) || 0) + 1);
    }

    const options: Completion[] = [];
    const currentModel = plugin.settings.llm.chat.model;

    for (const model of allModels) {
      const { provider, modelId } = plugin.llmService.parseModel(model.id);
      const isCurrentModel = model.id === currentModel;
      const currentText = isCurrentModel ? ' (Current)' : '';

      const isDuplicate = (modelNameCounts.get(modelId) || 0) > 1;
      const displayName = isDuplicate ? `${modelId} - ${provider}` : modelId;

      const label =
        displayName.length > 25
          ? `${displayName.substring(0, 25)}...${currentText}`
          : displayName + currentText;

      options.push({
        label,
        type: 'constant',
        apply: model.id + ' ',
      });
    }

    if (options.length === 0) return null;

    return {
      from: selectorStart + selectorLength,
      options,
      filter: true,
      validFor: text => {
        return /^[\w:.-]*$/i.test(text);
      },
    };
  };
}
