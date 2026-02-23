import { CompletionContext, CompletionResult, Completion } from '@codemirror/autocomplete';
import { capitalizeString } from 'src/utils/capitalizeString';
import { COMMAND_PREFIXES } from 'src/constants';
import type StewardPlugin from 'src/main';

export function createCommandCompletionSource(plugin: StewardPlugin) {
  const commandTypes = COMMAND_PREFIXES.map(prefix => {
    const type = prefix === '/ ' ? 'general' : prefix.replace('/', '');
    return { prefix, type };
  });

  return (context: CompletionContext): CompletionResult | null => {
    const isSlashCommandsEnabled =
      plugin.extendedApp.internalPlugins?.getPluginById('slash-command')?.enabled;
    if (isSlashCommandsEnabled) return null;

    const { state, pos } = context;
    const line = state.doc.lineAt(pos);
    const lineText = line.text;

    if (!lineText.startsWith('/')) return null;
    if (lineText === '/ ' || lineText === '/') return null;
    if (line.from !== pos - lineText.length && pos !== line.from + lineText.length) return null;

    const word = lineText.trim();

    const builtInOptions: Completion[] = commandTypes
      .filter(cmd => cmd.prefix.startsWith(word) && cmd.prefix !== word)
      .map(cmd => ({
        label: cmd.prefix,
        type: 'keyword',
        detail: `${capitalizeString(cmd.type)} command`,
        apply: cmd.prefix + ' ',
      }));

    const customOptions: Completion[] = [];
    const customCommands = plugin.userDefinedCommandService.getCommandNames();

    const filteredCustomCommands = customCommands.filter(
      (cmd: string) => ('/' + cmd).startsWith(word) && '/' + cmd !== word
    );

    for (let i = 0; i < filteredCustomCommands.length; i++) {
      const cmd = filteredCustomCommands[i];

      if (commandTypes.find(cmdType => cmdType.type === cmd)) {
        continue;
      }

      customOptions.push({
        label: '/' + cmd,
        type: 'keyword',
        detail: 'User-defined command',
        apply: '/' + cmd + ' ',
      });
    }

    const completionOptions = [...builtInOptions, ...customOptions];

    if (completionOptions.length === 0) return null;

    return {
      from: line.from,
      options: completionOptions,
      validFor: text => {
        if (COMMAND_PREFIXES.some(cmd => cmd === text)) return false;
        return /^\/\w*$/.test(text);
      },
    };
  };
}
