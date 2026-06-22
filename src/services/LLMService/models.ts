import type { PresetModelDefinition } from 'src/types/models';

/** Preset chat models grouped by provider. Custom models are stored in settings.models. */
export const LLM_MODELS: PresetModelDefinition[] = [
  // OpenAI
  {
    id: 'openai:gpt-5.5',
    name: 'GPT-5.5',
    kinds: ['chat'],
    temperaturePolicy: 'configurable',
  },
  {
    id: 'openai:gpt-5.4',
    name: 'GPT-5.4',
    kinds: ['chat'],
    temperaturePolicy: 'configurable',
  },
  {
    id: 'openai:gpt-5.4-mini',
    name: 'GPT-5.4 Mini',
    kinds: ['chat'],
    temperaturePolicy: 'configurable',
  },
  {
    id: 'openai:gpt-4o',
    name: 'GPT-4o',
    kinds: ['chat'],
    temperaturePolicy: 'configurable',
  },

  // Google
  {
    id: 'google:gemini-3.5-flash',
    name: 'Gemini 3.5 Flash',
    kinds: ['chat'],
    temperaturePolicy: 'configurable',
  },
  {
    id: 'google:gemini-3.1-pro-preview',
    name: 'Gemini 3.1 Pro',
    kinds: ['chat'],
    temperaturePolicy: 'configurable',
  },
  {
    id: 'google:gemini-2.5-flash',
    name: 'Gemini 2.5 Flash',
    kinds: ['chat'],
    temperaturePolicy: 'configurable',
  },

  // Ollama
  {
    id: 'ollama:llama3.3:latest',
    name: 'Llama 3.3',
    kinds: ['chat'],
    temperaturePolicy: 'configurable',
  },
  {
    id: 'ollama:gemma3:latest',
    name: 'Gemma 3',
    kinds: ['chat'],
    temperaturePolicy: 'configurable',
  },
  {
    id: 'ollama:qwen2.5:latest',
    name: 'Qwen 2.5',
    kinds: ['chat'],
    temperaturePolicy: 'configurable',
  },
  {
    id: 'ollama:deepseek-r1:latest',
    name: 'DeepSeek R1',
    kinds: ['chat'],
    temperaturePolicy: 'omit',
  },
  {
    id: 'ollama:mistral:latest',
    name: 'Mistral',
    kinds: ['chat'],
    temperaturePolicy: 'configurable',
  },

  // Anthropic
  {
    id: 'anthropic:claude-opus-4-6',
    name: 'Claude Opus 4.6',
    kinds: ['chat'],
    temperaturePolicy: 'configurable',
  },
  {
    id: 'anthropic:claude-sonnet-4-6',
    name: 'Claude Sonnet 4.6',
    kinds: ['chat'],
    temperaturePolicy: 'configurable',
  },
  {
    id: 'anthropic:claude-haiku-4-5-20251001',
    name: 'Claude Haiku 4.5',
    kinds: ['chat'],
    temperaturePolicy: 'configurable',
  },
];

/** @deprecated Use PresetModelDefinition from src/types/models */
export type ModelOption = PresetModelDefinition;
