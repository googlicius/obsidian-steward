export interface ModelOption {
  id: string;
  name: string;
}

/** Preset chat models grouped by provider. Custom models are stored in settings. */
export const LLM_MODELS: ModelOption[] = [
  // OpenAI
  { id: 'openai:gpt-5.5', name: 'GPT-5.5' },
  { id: 'openai:gpt-5.4', name: 'GPT-5.4' },
  { id: 'openai:gpt-5.4-mini', name: 'GPT-5.4 Mini' },
  { id: 'openai:gpt-4o', name: 'GPT-4o' },

  // Google
  { id: 'google:gemini-3.5-flash', name: 'Gemini 3.5 Flash' },
  { id: 'google:gemini-3.1-pro-preview', name: 'Gemini 3.1 Pro' },
  { id: 'google:gemini-2.5-flash', name: 'Gemini 2.5 Flash' },

  // Ollama
  { id: 'ollama:llama3.3:latest', name: 'Llama 3.3' },
  { id: 'ollama:gemma3:latest', name: 'Gemma 3' },
  { id: 'ollama:qwen2.5:latest', name: 'Qwen 2.5' },
  { id: 'ollama:deepseek-r1:latest', name: 'DeepSeek R1' },
  { id: 'ollama:mistral:latest', name: 'Mistral' },

  // Anthropic
  { id: 'anthropic:claude-opus-4-6', name: 'Claude Opus 4.6' },
  { id: 'anthropic:claude-sonnet-4-6', name: 'Claude Sonnet 4.6' },
  { id: 'anthropic:claude-haiku-4-5-20251001', name: 'Claude Haiku 4.5' },
];
