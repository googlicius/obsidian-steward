import { StewardPluginSettings } from './types/interfaces';

export const SMILE_CHAT_ICON_ID = 'smile-chat-icon';

export const STW_CHAT_VIEW_CONFIG = {
  type: 'steward-conversation',
  icon: SMILE_CHAT_ICON_ID,
};

export const STW_EMBEDDED_CONVERSATION_VIEW_CONFIG = {
  type: 'embedded-conversation',
  icon: 'message-square',
};

/**
 * Pattern only, without flags, to avoid global regex state issues
 * Captures image path (group 1) which may be followed by size parameter after |
 */
export const IMAGE_LINK_PATTERN = '!\\[\\[(.*?\\.(jpg|jpeg|png|webp|svg))(?:\\|.*?)?\\]\\]';

/**
 * Stw-selected pattern constants for reuse across the application
 * Pattern to match any stw-selected block (with capture group for splitting)
 */
export const STW_SELECTED_PATTERN = '(\\{\\{stw-selected.*?\\}\\})';

/**
 * The placeholder for the stw-selected blocks in the original query
 * This helps to reduce the complexity for the planner to just put the placeholder rather than extract the stw-selected blocks
 */
export const STW_SELECTED_PLACEHOLDER = '<stwSelected>';

/**
 * Pattern to match {{stw-squeezed [[<path>]] }}
 */
export const STW_SQUEEZED_PATTERN = '\\{\\{stw-squeezed \\[\\[([^\\]]+)\\]\\] \\}\\}';

/**
 * Pattern to match any wikilink
 */
export const WIKI_LINK_PATTERN = '\\[\\[([^\\]]+)\\]\\]';

/**
 * Pattern to extract metadata from stw-selected blocks
 */
export const STW_SELECTED_METADATA_PATTERN =
  '\\{\\{stw-selected from:(\\d+),to:(\\d+),selection:(.+?),path:(.+?)\\}\\}';

/**
 * Pattern to extract extracted model prefix m: or model:
 */
export const SELECTED_MODEL_PREFIX_PATTERN = '\\b(m|model):';

/**
 * Pattern to match selected model: `m:<provider>:<modelId>` or `model:<provider>:<modelId>`
 */
export const SELECTED_MODEL_PATTERN = '\\b(m|model):([a-zA-Z0-9_.-]+):([^\\s]+)';

/**
 * All built-in command that are available to the command menu
 */
export const COMMAND_PREFIXES = [
  '/ ',
  '/search',
  '/more',
  '/close',
  '/yes',
  '/no',
  '/image',
  '/audio',
  '/speak',
  '/create',
  '/stop',
  '/abort',
  '/help',
  '/test',
];

/**
 * The 2-space indentation is used to indicate a command line.
 */
export const TWO_SPACES_PREFIX = '  ';

export const DEFAULT_SETTINGS: StewardPluginSettings = {
  mySetting: 'default',
  providers: {
    openai: {
      apiKey: '',
    },
    elevenlabs: {
      apiKey: '',
    },
    deepseek: {
      apiKey: '',
    },
    google: {
      apiKey: '',
    },
    groq: {
      apiKey: '',
    },
    anthropic: {
      apiKey: '',
    },
  },
  saltKeyId: '', // Will be generated on first load
  stewardFolder: 'Steward',
  encryptionVersion: 1, // Current version
  excludedFolders: ['node_modules', 'src', '.git', 'dist'], // Default development folders to exclude
  debug: false, // Debug logging disabled by default
  showPronouns: true, // Show pronouns in chat by default
  audio: {
    model: 'openai', // Default model
    voices: {
      openai: 'alloy',
      elevenlabs: 'pNInz6obpgDQGcFmaJgB',
    },
  },
  llm: {
    chat: {
      model: 'openai:gpt-4-turbo-preview',
      customModels: [],
    },
    temperature: 0.2,
    ollamaBaseUrl: 'http://localhost:11434', // Deprecated: use providerConfigs instead
    maxGenerationTokens: 2048, // Default max tokens for generation
    showExtractionExplanation: true,
    image: {
      model: 'openai:dall-e-3',
      customModels: [],
      size: '1024x1024',
    },
    providerConfigs: {},
    speech: {
      model: 'openai:tts-1', // Default speech model
      voices: {
        openai: 'alloy', // Default OpenAI voice
        elevenlabs: 'pNInz6obpgDQGcFmaJgB', // Default ElevenLabs voice
      },
      customModels: [], // User-defined custom speech models
    },
    modelFallback: {
      enabled: true,
      fallbackChain: [], // Empty by default - users must configure
    },
  },
  embedding: {
    enabled: true, // Embedding functionality enabled by default
    model: 'openai:text-embedding-ada-002',
    customModels: [],
    similarityThreshold: 0.85, // Default similarity threshold for embedding matching
  },
  search: {
    searchDbName: '',
    withoutLLM: 'relevant',
    resultsPerPage: 10,
  },
  deleteBehavior: {
    behavior: 'stw_trash', // Default to moving files to trash
    cleanupPolicy: 'never', // Default to never automatically delete
  },
  lastSeenVersion: undefined, // Will be set when user sees a version notification
};

// Model options grouped by provider
export interface ModelOption {
  id: string;
  name: string;
  isReasoning?: boolean;
}

export const LLM_MODELS: ModelOption[] = [
  // OpenAI models
  { id: 'openai:gpt-4o', name: 'GPT-4o' },
  { id: 'openai:o3', name: 'O3', isReasoning: true },
  { id: 'openai:o4-mini', name: 'O4 Mini', isReasoning: true },
  { id: 'openai:gpt-4-turbo-preview', name: 'GPT-4 Turbo' },
  { id: 'openai:gpt-4-0125-preview', name: 'GPT-4 0125' },
  { id: 'openai:gpt-3.5-turbo', name: 'GPT-3.5 Turbo' },

  // DeepSeek models
  { id: 'deepseek:deepseek-chat', name: 'DeepSeek Chat' },
  { id: 'deepseek:deepseek-reasoner', name: 'DeepSeek Reasoner', isReasoning: true },

  // Google models
  { id: 'google:gemini-3-pro-preview', name: 'Gemini 3 Pro', isReasoning: true },
  { id: 'google:gemini-2.5-flash', name: 'Gemini 2.5 Flash' },
  { id: 'google:gemini-2.0-flash', name: 'Gemini 2.0 Flash' },

  // Groq models
  { id: 'groq:meta-llama/llama-4-scout-17b-16e-instruct', name: 'Llama 4 Scout 17B' },

  // Ollama models
  { id: 'ollama:llama3:latest', name: 'Llama 3 8B' },
  { id: 'ollama:llama3.1:latest', name: 'Llama 3.1 8B' },
  { id: 'ollama:llama3.2:latest', name: 'Llama 3.2' },
  { id: 'ollama:mistral:latest', name: 'Mistral' },
  { id: 'ollama:mixtral:latest', name: 'Mixtral' },

  // Anthropic models
  { id: 'anthropic:claude-sonnet-4-20250514', name: 'Claude 4 Sonnet' },
  { id: 'anthropic:claude-3-7-sonnet-20250219', name: 'Claude 3.7 Sonnet', isReasoning: true },
  { id: 'anthropic:claude-3-5-sonnet-20241022', name: 'Claude 3.5 Sonnet' },
];

export type ProviderNeedApiKey =
  | 'openai'
  | 'elevenlabs'
  | 'deepseek'
  | 'google'
  | 'groq'
  | 'anthropic';

// Speech model options
export interface SpeechModelOption {
  id: string; // Format: "provider:modelId" (e.g., "openai:tts-1")
  name?: string;
}

export const SPEECH_MODELS: SpeechModelOption[] = [
  // OpenAI Speech Models
  { id: 'openai:tts-1', name: 'OpenAI TTS-1' },
  { id: 'openai:tts-1-hd', name: 'OpenAI TTS-1 HD' },

  // ElevenLabs Speech Models
  { id: 'elevenlabs:eleven_turbo_v2', name: 'ElevenLabs Turbo v2' },
  { id: 'elevenlabs:eleven_multilingual_v2', name: 'ElevenLabs Multilingual v2' },
];

// Default voice IDs for each provider
export const DEFAULT_VOICES: Record<string, string> = {
  openai: 'alloy',
  elevenlabs: 'pNInz6obpgDQGcFmaJgB',
};

// Embedding model options
export interface EmbeddingModelOption {
  id: string;
  name: string;
}

export const EMBEDDING_MODELS: EmbeddingModelOption[] = [
  {
    id: 'openai:text-embedding-ada-002',
    name: 'text-embedding-ada-002 (OpenAI)',
  },
  { id: 'google:gemini-embedding-001', name: 'gemini-embedding-001 (Google)' },
];

// Image model options
export interface ImageModelOption {
  id: string;
  name: string;
}

export const IMAGE_MODELS: ImageModelOption[] = [
  { id: 'openai:dall-e-3', name: 'DALL-E 3' },
  { id: 'openai:dall-e-2', name: 'DALL-E 2' },
];

export const SEARCH_DB_NAME_PREFIX = 'steward_search_';
