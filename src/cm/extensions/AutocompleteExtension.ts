import {
  autocompletion,
  CompletionContext,
  CompletionResult,
  Completion,
} from '@codemirror/autocomplete';
import { Extension } from '@codemirror/state';
import { capitalizeString } from 'src/utils/capitalizeString';
import { COMMAND_PREFIXES, LLM_MODELS } from 'src/constants';
import type StewardPlugin from 'src/main';

/**
 * Extract provider and model name from model ID
 * Format: <provider>:<modelId> (e.g., "openai:gpt-4o")
 */
function parseModelId(modelId: string): { provider: string; modelName: string } {
  const [provider, ...modelParts] = modelId.split(':');
  return {
    provider,
    modelName: modelParts.join(':'),
  };
}

/**
 * Get all available models (preset + custom)
 */
function getAllModels(plugin: StewardPlugin): Array<{ id: string; name: string }> {
  const customModels: string[] = (plugin.settings.llm.chat.customModels as string[]) || [];

  return [
    ...LLM_MODELS.map(model => ({ id: model.id, name: model.name })),
    ...customModels.map(model => {
      const { modelName } = parseModelId(model);
      return { id: model, name: modelName };
    }),
  ];
}

/**
 * Check if text matches model selector pattern: m: or model: (with optional text after)
 * Matches when text starts with m: or model: followed by optional characters
 */
function isModelSelectorPattern(text: string): boolean {
  return /^(m|model):/i.test(text);
}

export function createAutocompleteExtension(plugin: StewardPlugin): Extension {
  // Create a mapping of command prefixes to their types for easier lookup
  const commandTypes = COMMAND_PREFIXES.map(prefix => {
    // Remove the slash and trim whitespace
    const type = prefix === '/ ' ? 'general' : prefix.replace('/', '');
    return { prefix, type };
  });

  const commandCompletionSource = (context: CompletionContext): CompletionResult | null => {
    // Don't show autocomplete if the core Slash Commands plugin is enabled
    const isSlashCommandsEnabled =
      plugin.extendedApp.internalPlugins?.getPluginById('slash-command')?.enabled;
    if (isSlashCommandsEnabled) return null;

    // Get current line
    const { state, pos } = context;
    const line = state.doc.lineAt(pos);
    const lineText = line.text;

    // Only show autocomplete when cursor is at beginning of line with a slash
    if (!lineText.startsWith('/')) return null;

    // Only show when user types a character after the "/"
    if (lineText === '/ ' || lineText === '/') return null;

    // Make sure we're at the beginning of the line
    if (line.from !== pos - lineText.length && pos !== line.from + lineText.length) return null;

    // Get the current word (which starts with /)
    const word = lineText.trim();

    // Get built-in command options
    const builtInOptions: Completion[] = commandTypes
      .filter(cmd => cmd.prefix.startsWith(word) && cmd.prefix !== word)
      .map(cmd => ({
        label: cmd.prefix,
        type: 'keyword',
        detail: `${capitalizeString(cmd.type)} command`,
        apply: cmd.prefix + ' ',
      }));

    // Get custom command options
    const customOptions: Completion[] = [];

    // Add custom command options if available
    const customCommands = plugin.userDefinedCommandService.getCommandNames();

    // Filter custom commands based on current input
    const filteredCustomCommands = customCommands.filter(
      (cmd: string) => ('/' + cmd).startsWith(word) && '/' + cmd !== word
    );

    // Add to options
    for (let i = 0; i < filteredCustomCommands.length; i++) {
      const cmd = filteredCustomCommands[i];

      if (commandTypes.find(cmdType => cmdType.type === cmd)) {
        continue;
      }

      customOptions.push({
        label: '/' + cmd,
        type: 'keyword',
        detail: 'Custom command',
        apply: '/' + cmd + ' ',
      });
    }

    // Combine built-in and custom options
    const completionOptions = [...builtInOptions, ...customOptions];

    if (completionOptions.length === 0) return null;

    return {
      from: line.from,
      options: completionOptions,
      validFor: text => {
        // If text matches an exact command, return false
        if (COMMAND_PREFIXES.some(cmd => cmd === text)) return false;

        // Otherwise, validate if it starts with a slash followed by word characters
        return /^\/\w*$/.test(text);
      },
    };
  };

  const modelCompletionSource = (context: CompletionContext): CompletionResult | null => {
    // Get current line
    const { state, pos } = context;
    const line = state.doc.lineAt(pos);
    const lineText = line.text;

    // Only activate in command input (lines starting with /)
    if (!lineText.startsWith('/')) return null;

    // Check if line starts with a built-in command
    const matchedBuiltInCommand = COMMAND_PREFIXES.find(prefix => {
      // For '/ ' prefix, match exactly
      if (prefix === '/ ') {
        return lineText === '/ ' || lineText.startsWith('/ ');
      }
      // For other prefixes, match the command followed by space
      return lineText === prefix + ' ' || lineText.startsWith(prefix + ' ');
    });

    // Only show model selector for built-in commands
    if (!matchedBuiltInCommand) return null;

    // Get text after the built-in command
    const afterCommand =
      matchedBuiltInCommand === '/ '
        ? lineText.substring(2) // After '/ '
        : lineText.substring(matchedBuiltInCommand.length + 1); // After command + space

    // Check if matches model selector pattern
    if (!isModelSelectorPattern(afterCommand)) {
      return null;
    }

    // Find the position of the model selector in the line
    const modelSelectorMatch = afterCommand.match(/^\s*(m|model):/i);
    if (!modelSelectorMatch || modelSelectorMatch.index === undefined) return null;

    // Calculate the start position of the selector
    const commandLength = matchedBuiltInCommand === '/ ' ? 2 : matchedBuiltInCommand.length + 1;
    const selectorStart = line.from + commandLength + modelSelectorMatch.index;
    const selectorLength = modelSelectorMatch[0].length;

    // Get all available models
    const allModels = getAllModels(plugin);

    // Group models by provider
    const modelsByProvider = allModels.reduce<Record<string, typeof allModels>>((acc, model) => {
      const provider = parseModelId(model.id).provider;
      if (!acc[provider]) {
        acc[provider] = [];
      }
      acc[provider].push(model);
      return acc;
    }, {});

    // Build completion options grouped by provider
    const options: Completion[] = [];
    // Current model: provider:modelName
    const currentModel = plugin.settings.llm.chat.model;

    for (const [, models] of Object.entries(modelsByProvider)) {
      // Add models under this provider
      for (const model of models) {
        const { modelName } = parseModelId(model.id);
        const isCurrentModel = model.id === currentModel;
        const currentText = isCurrentModel ? '(Current)' : '';

        options.push({
          label:
            modelName.length > 25
              ? `${modelName.substring(0, 25)}... ${currentText}`
              : modelName + ' ' + currentText,
          type: 'constant',
          apply: model.id + ' ',
        });
      }
    }

    if (options.length === 0) return null;

    return {
      from: selectorStart + selectorLength,
      options,
      filter: true,
      validFor: text => {
        // Valid if text matches model name pattern
        return /^[\w:.-]*$/i.test(text);
      },
    };
  };

  return autocompletion({
    // Only activate when typing after a slash at the beginning of a line
    activateOnTyping: true,
    icons: false,
    compareCompletions: () => 0, // Disable reorder
    override: [modelCompletionSource, commandCompletionSource],
  });
}
