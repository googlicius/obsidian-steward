import { autocompletion } from '@codemirror/autocomplete';
import { Extension } from '@codemirror/state';
import type StewardPlugin from 'src/main';
import { createCommandCompletionSource } from './commandCompletionSource';
import { createDatasourceCompletionSource, datasourceIconRenderer } from './datasourceCompletionSource';
import { createModelCompletionSource } from './modelCompletionSource';

export function createAutocompleteExtension(plugin: StewardPlugin): Extension {
  const commandCompletionSource = createCommandCompletionSource(plugin);
  const modelCompletionSource = createModelCompletionSource(plugin);
  const datasourceCompletionSource = createDatasourceCompletionSource(plugin);

  return autocompletion({
    activateOnTyping: true,
    icons: false,
    compareCompletions: () => 0,
    override: [datasourceCompletionSource, modelCompletionSource, commandCompletionSource],
    addToOptions: [
      {
        render: datasourceIconRenderer,
        position: 20,
      },
    ],
  });
}
