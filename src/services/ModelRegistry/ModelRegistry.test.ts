import type StewardPlugin from 'src/main';
import type { StewardModelDefinition } from 'src/types/models';

import { ModelRegistry, inferTemperaturePolicyFromModelId } from './ModelRegistry';

interface MockPluginShape {
  settings: {
    models: StewardModelDefinition[];
    llm: { temperature: number };
  };
  llmService: {
    getModelDisplayName: (id: string) => string;
  };
}

describe('inferTemperaturePolicyFromModelId', () => {
  it('returns omit for OpenAI o1/o3 reasoning models', () => {
    expect(inferTemperaturePolicyFromModelId('openai:o1-preview')).toBe('omit');
    expect(inferTemperaturePolicyFromModelId('openai:o3-mini')).toBe('omit');
  });

  it('returns omit for deepseek-r1 style ids', () => {
    expect(inferTemperaturePolicyFromModelId('ollama:deepseek-r1:latest')).toBe('omit');
  });

  it('returns configurable for standard chat models', () => {
    expect(inferTemperaturePolicyFromModelId('openai:gpt-4o')).toBe('configurable');
  });
});

describe('ModelRegistry', () => {
  const mockPlugin: MockPluginShape = {
    settings: {
      models: [
        {
          id: 'custom:my-model',
          kinds: ['chat'],
          temperaturePolicy: 'configurable',
          temperature: 0.5,
        },
      ],
      llm: { temperature: 0.2 },
    },
    llmService: {
      getModelDisplayName: (id: string) => id.split(':')[1] ?? id,
    },
  };

  beforeEach(() => {
    mockPlugin.settings.models = [
      {
        id: 'custom:my-model',
        kinds: ['chat'],
        temperaturePolicy: 'configurable',
        temperature: 0.5,
      },
    ];
    ModelRegistry.getInstance(mockPlugin as unknown as StewardPlugin);
  });

  it('merges preset and user definition', () => {
    const registry = ModelRegistry.getInstance();
    mockPlugin.settings.models.push({
      id: 'openai:gpt-4o',
      kinds: ['chat'],
      temperaturePolicy: 'configurable',
      temperature: 0.9,
    });

    const resolved = registry.resolveModelDefinition('openai:gpt-4o');
    expect(resolved?.temperature).toBe(0.9);
    expect(resolved?.temperaturePolicy).toBe('configurable');
  });

  it('resolves temperature from user model', () => {
    const registry = ModelRegistry.getInstance();
    expect(registry.resolveTemperature('custom:my-model', 0.2)).toBe(0.5);
  });

  it('omits temperature for reasoning models', () => {
    const registry = ModelRegistry.getInstance();
    expect(registry.resolveTemperature('openai:o1-preview', 0.2)).toBeUndefined();
  });

  it('falls back to global default for configurable models without override', () => {
    const registry = ModelRegistry.getInstance();
    expect(registry.resolveTemperature('openai:gpt-4o', 0.2)).toBe(0.2);
  });

  it('lists user and preset models for kind', () => {
    const registry = ModelRegistry.getInstance();
    const models = registry.getModelsForKind('chat');
    expect(models.some(model => model.id === 'openai:gpt-4o')).toBe(true);
    expect(models.some(model => model.id === 'custom:my-model')).toBe(true);
  });
});
