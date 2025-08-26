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

// Pattern only, without flags, to avoid global regex state issues
// Captures image path (group 1) which may be followed by size parameter after |
export const IMAGE_LINK_PATTERN = '!\\[\\[(.*?\\.(jpg|jpeg|png|webp|svg))(?:\\|.*?)?\\]\\]';
// Stw-selected pattern constants for reuse across the application
// Pattern to match any stw-selected block (with capture group for splitting)
export const STW_SELECTED_PATTERN = '(\\{\\{stw-selected.*?\\}\\})';

// Pattern to match {{stw-squeezed [[<path>]] }}
export const STW_SQUEEZED_PATTERN = '\\{\\{stw-squeezed \\[\\[([^\\]]+)\\]\\] \\}\\}';

// Pattern to match any wikilink
export const WIKI_LINK_PATTERN = '\\[\\[([^\\]]+)\\]\\]';

// Pattern to extract metadata from stw-selected blocks
export const STW_SELECTED_METADATA_PATTERN =
  '\\{\\{stw-selected from:(\\d+),to:(\\d+),selection:(.+?),path:(.+?)\\}\\}';

// Supported command prefixes
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
];

/**
 * The 2-space indentation is used to indicate a command line.
 */
export const TWO_SPACES_PREFIX = '  ';

export const DEFAULT_SETTINGS: StewardPluginSettings = {
  mySetting: 'default',
  apiKeys: {
    openai: '',
    elevenlabs: '',
    deepseek: '',
    google: '',
    groq: '',
    anthropic: '',
  },
  saltKeyId: '', // Will be generated on first load
  stewardFolder: 'Steward',
  searchDbPrefix: '',
  encryptionVersion: 1, // Current version
  excludedFolders: ['node_modules', 'src', '.git', 'dist'], // Default development folders to exclude
  debug: false, // Debug logging disabled by default
  borderedInput: true, // Enable bordered input by default
  showPronouns: true, // Show pronouns in chat by default
  audio: {
    model: 'openai', // Default model
    voices: {
      openai: 'alloy',
      elevenlabs: 'pNInz6obpgDQGcFmaJgB',
    },
  },
  llm: {
    model: 'gpt-4-turbo-preview',
    temperature: 0.2,
    ollamaBaseUrl: 'http://localhost:11434',
    maxGenerationTokens: 2048, // Default max tokens for generation
  },
};

// Model options grouped by provider
export interface ModelOption {
  id: string;
  name: string;
  provider: 'openai' | 'deepseek' | 'ollama' | 'google' | 'groq' | 'anthropic';
}

export const LLM_MODELS: ModelOption[] = [
  // OpenAI Models
  { id: 'gpt-4o', name: 'GPT-4o', provider: 'openai' },
  { id: 'gpt-4-vision-preview', name: 'GPT-4 Vision (Deprecated)', provider: 'openai' },
  { id: 'gpt-4-turbo-preview', name: 'GPT-4 Turbo', provider: 'openai' },
  { id: 'gpt-4-0125-preview', name: 'GPT-4 0125', provider: 'openai' },
  { id: 'gpt-3.5-turbo', name: 'GPT-3.5 Turbo', provider: 'openai' },

  // DeepSeek Models
  { id: 'deepseek-chat', name: 'DeepSeek Chat', provider: 'deepseek' },

  // Google Models
  { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash', provider: 'google' },
  { id: 'gemini-2.0-flash', name: 'Gemini 2.0 Flash', provider: 'google' },
  { id: 'gemini-2.0-pro', name: 'Gemini 2.0 Pro', provider: 'google' },

  // Groq Models
  { id: 'meta-llama/llama-4-scout-17b-16e-instruct', name: 'Llama 4 Scout 17B', provider: 'groq' },

  // Ollama Models
  { id: 'llama3:latest', name: 'Llama 3 8B', provider: 'ollama' },
  { id: 'llama3.1:latest', name: 'Llama 3.1 8B', provider: 'ollama' },
  { id: 'llama3.2:latest', name: 'Llama 3.2', provider: 'ollama' },
  { id: 'mistral:latest', name: 'Mistral', provider: 'ollama' },
  { id: 'mixtral:latest', name: 'Mixtral', provider: 'ollama' },

  // Anthropic Models
  { id: 'claude-sonnet-4-20250514', name: 'Claude 4 Sonnet', provider: 'anthropic' },
  { id: 'claude-3-7-sonnet-20250219', name: 'Claude 3.7 Sonnet', provider: 'anthropic' },
  { id: 'claude-3-5-sonnet-20241022', name: 'Claude 3.5 Sonnet', provider: 'anthropic' },
];

export type ProviderNeedApiKey =
  | 'openai'
  | 'elevenlabs'
  | 'deepseek'
  | 'google'
  | 'groq'
  | 'anthropic';
