import { LLM_MODELS } from 'src/services/LLMService/models';
import type { StewardPluginSettings } from 'src/types/interfaces';
import type { ModelKind, StewardModelDefinition } from 'src/types/models';

import { ModelRegistry } from 'src/services/ModelRegistry';

interface LegacyModelSource {
  kind: ModelKind;
  ids: string[] | undefined;
}

function collectLegacySources(settings: StewardPluginSettings): LegacyModelSource[] {
  return [
    { kind: 'chat', ids: settings.llm?.chat?.customModels },
    { kind: 'chat', ids: settings.llm?.agents?.compactionSummary?.customModels },
    { kind: 'chat', ids: settings.llm?.agents?.conversationTitle?.customModels },
    { kind: 'embedding', ids: settings.embedding?.customModels },
    { kind: 'speech', ids: settings.llm?.speech?.customModels },
    { kind: 'image', ids: settings.llm?.image?.customModels },
  ];
}

function collectActiveModelRefs(
  settings: StewardPluginSettings
): Array<{ kind: ModelKind; id: string }> {
  const refs: Array<{ kind: ModelKind; id: string }> = [];

  const addRef = (kind: ModelKind, id: string | undefined) => {
    if (!id || typeof id !== 'string' || id.trim() === '') {
      return;
    }
    refs.push({ kind, id: id.trim() });
  };

  addRef('chat', settings.llm?.chat?.model);
  addRef('chat', settings.llm?.agents?.compactionSummary?.model);
  addRef('chat', settings.llm?.agents?.conversationTitle?.model);
  addRef('embedding', settings.embedding?.model);
  addRef('speech', settings.llm?.speech?.model);
  addRef('image', settings.llm?.image?.model);

  const fallbackChain = settings.llm?.modelFallback?.fallbackChain;
  if (fallbackChain) {
    for (let i = 0; i < fallbackChain.length; i++) {
      addRef('chat', fallbackChain[i]);
    }
  }

  return refs;
}

function upsertMigratedModel(input: {
  registry: Map<string, StewardModelDefinition>;
  modelId: string;
  kind: ModelKind;
}): void {
  const trimmed = input.modelId.trim();
  if (!trimmed) {
    return;
  }

  const existing = input.registry.get(trimmed);

  if (existing) {
    if (!existing.kinds.includes(input.kind)) {
      existing.kinds.push(input.kind);
    }
    return;
  }

  if (ModelRegistry.isPresetModel(trimmed)) {
    return;
  }

  input.registry.set(trimmed, {
    id: trimmed,
    kinds: [input.kind],
    temperaturePolicy: 'configurable',
  });
}

/**
 * Collect legacy customModels arrays and active model refs into settings.models.
 */
export function migrateSettingsFrom2To3(settings: StewardPluginSettings): void {
  if (!settings.models) {
    settings.models = [];
  }

  const registry = new Map<string, StewardModelDefinition>();
  for (let i = 0; i < settings.models.length; i++) {
    const model = settings.models[i];
    registry.set(model.id, {
      id: model.id,
      kinds: [...model.kinds],
      temperaturePolicy: model.temperaturePolicy,
      temperature: model.temperature,
    });
  }

  const sources = collectLegacySources(settings);
  for (let i = 0; i < sources.length; i++) {
    const source = sources[i];
    if (!source.ids) {
      continue;
    }
    for (let j = 0; j < source.ids.length; j++) {
      upsertMigratedModel({
        registry,
        modelId: source.ids[j],
        kind: source.kind,
      });
    }
  }

  const activeRefs = collectActiveModelRefs(settings);
  for (let i = 0; i < activeRefs.length; i++) {
    const ref = activeRefs[i];
    if (ModelRegistry.isPresetModel(ref.id)) {
      continue;
    }
    upsertMigratedModel({
      registry,
      modelId: ref.id,
      kind: ref.kind,
    });
  }

  settings.models = Array.from(registry.values());

  if (settings.llm?.chat) {
    delete settings.llm.chat.customModels;
  }
  if (settings.llm?.agents?.compactionSummary) {
    delete settings.llm.agents.compactionSummary.customModels;
  }
  if (settings.llm?.agents?.conversationTitle) {
    delete settings.llm.agents.conversationTitle.customModels;
  }
  if (settings.llm?.speech) {
    delete settings.llm.speech.customModels;
  }
  if (settings.llm?.image) {
    delete settings.llm.image.customModels;
  }
  if (settings.embedding) {
    delete settings.embedding.customModels;
  }

  if (settings.llm?.chat?.model && !ModelRegistry.isPresetModel(settings.llm.chat.model)) {
    const stillRegistered = settings.models.some(model => model.id === settings.llm.chat.model);
    if (!stillRegistered && LLM_MODELS.length > 0) {
      settings.llm.chat.model = LLM_MODELS[0].id;
    }
  }
}
