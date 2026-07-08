import { EMBEDDING_MODELS, IMAGE_MODELS, SPEECH_MODELS } from 'src/constants';
import type StewardPlugin from 'src/main';
import { LLM_MODELS } from 'src/services/LLMService/models';
import { getModelMetadata } from 'src/services/LLMService/modelMetadata';
import type {
  ModelKind,
  ModelListItem,
  PresetModelDefinition,
  ReasoningLevel,
  StewardModelDefinition,
  TemperaturePolicy,
} from 'src/types/models';

const ALL_PRESETS: PresetModelDefinition[] = [
  ...LLM_MODELS,
  ...SPEECH_MODELS,
  ...EMBEDDING_MODELS,
  ...IMAGE_MODELS,
];

const PRESET_BY_ID = new Map<string, PresetModelDefinition>(
  ALL_PRESETS.map(preset => [preset.id, preset])
);

function mergeKinds(existing: ModelKind[], incoming: ModelKind[]): ModelKind[] {
  const merged = new Set<ModelKind>(existing);
  for (let i = 0; i < incoming.length; i++) {
    merged.add(incoming[i]);
  }
  return Array.from(merged);
}

function hasKind(definition: StewardModelDefinition, kind: ModelKind): boolean {
  for (let i = 0; i < definition.kinds.length; i++) {
    if (definition.kinds[i] === kind) {
      return true;
    }
  }
  return false;
}

export function inferTemperaturePolicyFromModelId(modelId: string): TemperaturePolicy {
  const trimmed = modelId.trim();
  if (!trimmed) {
    return 'configurable';
  }

  const colonIndex = trimmed.indexOf(':');
  if (colonIndex <= 0) {
    return 'configurable';
  }

  const provider = trimmed.slice(0, colonIndex);
  const modelPart = trimmed.slice(colonIndex + 1);

  const metadata = getModelMetadata(trimmed);
  if (metadata?.temperature === false) {
    return 'omit';
  }

  if (provider === 'openai' && /^o[13](-|$)/.test(modelPart)) {
    return 'omit';
  }

  if (/deepseek-r1|reasoning/i.test(modelPart)) {
    return 'omit';
  }

  return 'configurable';
}

export class ModelRegistry {
  private static instance: ModelRegistry | null = null;

  private constructor(private plugin: StewardPlugin) {}

  public static getInstance(plugin?: StewardPlugin): ModelRegistry {
    if (!ModelRegistry.instance) {
      if (!plugin) {
        throw new Error('ModelRegistry not initialized');
      }
      ModelRegistry.instance = new ModelRegistry(plugin);
    } else if (plugin) {
      ModelRegistry.instance.plugin = plugin;
    }
    return ModelRegistry.instance;
  }

  public static getPresetModels(kind: ModelKind): PresetModelDefinition[] {
    const result: PresetModelDefinition[] = [];
    for (let i = 0; i < ALL_PRESETS.length; i++) {
      const preset = ALL_PRESETS[i];
      if (hasKind(preset, kind)) {
        result.push(preset);
      }
    }
    return result;
  }

  public static getPresetById(id: string): PresetModelDefinition | undefined {
    return PRESET_BY_ID.get(id);
  }

  public static isPresetModel(id: string): boolean {
    return PRESET_BY_ID.has(id);
  }

  public getUserModels(kind: ModelKind): StewardModelDefinition[] {
    const models = this.plugin.settings.models ?? [];
    const result: StewardModelDefinition[] = [];
    for (let i = 0; i < models.length; i++) {
      const model = models[i];
      if (hasKind(model, kind)) {
        result.push(model);
      }
    }
    return result;
  }

  public resolveModelDefinition(id: string): StewardModelDefinition | undefined {
    const trimmed = id?.trim() ?? '';
    if (!trimmed) {
      return undefined;
    }

    const preset = PRESET_BY_ID.get(trimmed);
    const userModels = this.plugin.settings.models ?? [];
    let userEntry: StewardModelDefinition | undefined;
    for (let i = 0; i < userModels.length; i++) {
      if (userModels[i].id === trimmed) {
        userEntry = userModels[i];
        break;
      }
    }

    if (!preset && !userEntry) {
      return undefined;
    }

    if (!preset) {
      return userEntry;
    }

    if (!userEntry) {
      return {
        id: preset.id,
        kinds: [...preset.kinds],
        temperaturePolicy: preset.temperaturePolicy,
        temperature: preset.temperature,
        reasoning: preset.reasoning,
      };
    }

    return {
      id: trimmed,
      kinds: mergeKinds(preset.kinds, userEntry.kinds),
      temperaturePolicy: userEntry.temperaturePolicy ?? preset.temperaturePolicy,
      temperature: userEntry.temperature ?? preset.temperature,
      reasoning: userEntry.reasoning ?? preset.reasoning,
    };
  }

  public getModelsForKind(kind: ModelKind): ModelListItem[] {
    const byId = new Map<string, ModelListItem>();

    const presets = ModelRegistry.getPresetModels(kind);
    for (let i = 0; i < presets.length; i++) {
      const preset = presets[i];
      byId.set(preset.id, { id: preset.id, name: preset.name });
    }

    const userModels = this.getUserModels(kind);
    for (let i = 0; i < userModels.length; i++) {
      const userModel = userModels[i];
      if (byId.has(userModel.id)) {
        continue;
      }
      byId.set(userModel.id, {
        id: userModel.id,
        name: this.plugin.llmService.getModelDisplayName(userModel.id),
      });
    }

    return Array.from(byId.values());
  }

  public getFirstPresetId(kind: ModelKind): string {
    const presets = ModelRegistry.getPresetModels(kind);
    if (presets.length === 0) {
      return '';
    }
    return presets[0].id;
  }

  public upsertUserModel(definition: StewardModelDefinition): void {
    if (!this.plugin.settings.models) {
      this.plugin.settings.models = [];
    }

    const models = this.plugin.settings.models;
    for (let i = 0; i < models.length; i++) {
      if (models[i].id !== definition.id) {
        continue;
      }

      models[i] = {
        id: definition.id,
        kinds: mergeKinds(models[i].kinds, definition.kinds),
        temperaturePolicy: definition.temperaturePolicy,
        temperature: definition.temperature,
        reasoning: definition.reasoning,
      };
      return;
    }

    models.push({
      id: definition.id,
      kinds: [...definition.kinds],
      temperaturePolicy: definition.temperaturePolicy,
      temperature: definition.temperature,
      reasoning: definition.reasoning,
    });
  }

  public removeUserModelKind(id: string, kind: ModelKind): void {
    const models = this.plugin.settings.models ?? [];
    for (let i = 0; i < models.length; i++) {
      if (models[i].id !== id) {
        continue;
      }

      const nextKinds: ModelKind[] = [];
      for (let j = 0; j < models[i].kinds.length; j++) {
        if (models[i].kinds[j] !== kind) {
          nextKinds.push(models[i].kinds[j]);
        }
      }

      if (nextKinds.length === 0) {
        models.splice(i, 1);
      } else {
        models[i].kinds = nextKinds;
      }
      return;
    }
  }

  public resolveTemperature(modelId: string, globalDefault: number): number | undefined {
    const definition = this.resolveModelDefinition(modelId);
    const preset = PRESET_BY_ID.get(modelId);

    const effectivePolicy =
      definition?.temperaturePolicy ??
      preset?.temperaturePolicy ??
      inferTemperaturePolicyFromModelId(modelId);

    if (effectivePolicy === 'omit') {
      return undefined;
    }

    if (definition?.temperature !== undefined) {
      return definition.temperature;
    }

    if (preset?.temperature !== undefined) {
      return preset.temperature;
    }

    return globalDefault;
  }

  /**
   * Resolve effective reasoning level for a model id; defaults to `provider-default`.
   */
  public resolveReasoning(modelId: string): ReasoningLevel {
    const definition = this.resolveModelDefinition(modelId);
    if (definition?.reasoning) {
      return definition.reasoning;
    }
    return 'provider-default';
  }
}
