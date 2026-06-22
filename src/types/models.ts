export type ModelKind = 'chat' | 'embedding' | 'speech' | 'image';

export type TemperaturePolicy = 'configurable' | 'omit';

export interface StewardModelDefinition {
  /** Full key: provider:modelId */
  id: string;
  kinds: ModelKind[];
  temperaturePolicy: TemperaturePolicy;
  /** Used when temperaturePolicy === 'configurable' */
  temperature?: number;
}

export interface PresetModelDefinition extends StewardModelDefinition {
  name: string;
}

export interface ModelListItem {
  id: string;
  name: string;
}

export interface TestModelInput {
  modelId: string;
  temperaturePolicy?: TemperaturePolicy;
  temperature?: number;
}
