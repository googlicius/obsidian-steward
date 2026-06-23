export type ModelKind = 'chat' | 'embedding' | 'speech' | 'image';

export type TemperaturePolicy = 'configurable' | 'omit';

/** User-facing reasoning level for chat models. */
export type ReasoningLevel =
  | 'provider-default'
  | 'none'
  | 'minimal'
  | 'low'
  | 'medium'
  | 'high'
  | 'xhigh';

/** Provider API shape for reasoning — drives wire format and settings UI. */
export type ReasoningCapability = 'unsupported' | 'effort' | 'thinking-toggle';

export interface StewardModelDefinition {
  /** Full key: provider:modelId */
  id: string;
  kinds: ModelKind[];
  temperaturePolicy: TemperaturePolicy;
  /** Used when temperaturePolicy === 'configurable' */
  temperature?: number;
  /** Reasoning / thinking preference; default `provider-default` at resolve time. */
  reasoning?: ReasoningLevel;
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
  reasoning?: ReasoningLevel;
}
