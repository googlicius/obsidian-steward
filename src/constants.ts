import { StewardPluginSettings } from './types/interfaces';

export const SMILE_CHAT_ICON_ID = 'smile-chat-icon';

export const STW_CONVERSATION_VIEW_CONFIG = {
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

export const DEFAULT_SETTINGS: StewardPluginSettings = {
  mySetting: 'default',
  apiKeys: {
    openai: '',
    elevenlabs: '',
    deepseek: '',
  },
  saltKeyId: '', // Will be generated on first load
  stewardFolder: 'Steward',
  searchDbPrefix: '',
  encryptionVersion: 1, // Current version
  excludedFolders: ['node_modules', 'src', '.git', 'dist'], // Default development folders to exclude
  debug: false, // Debug logging disabled by default
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
    corsProxyUrl: '', // Default to no CORS proxy
  },
};

// Model options grouped by provider
export interface ModelOption {
  id: string;
  name: string;
  provider: 'openai' | 'deepseek' | 'ollama';
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

  // Ollama Models
  { id: 'llama3:latest', name: 'Llama 3 8B', provider: 'ollama' },
  { id: 'llama3.1:latest', name: 'Llama 3.1 8B', provider: 'ollama' },
  { id: 'llama3.2:latest', name: 'Llama 3.2', provider: 'ollama' },
  { id: 'mistral:latest', name: 'Mistral', provider: 'ollama' },
  { id: 'mixtral:latest', name: 'Mixtral', provider: 'ollama' },
];

/**
 * Introduction text for Steward that will be streamed to the Introduction file
 */
export const STEWARD_INTRODUCTION = `Steward is your intelligent assistant for Obsidian note management. I'm here to help you organize, search, and manipulate your notes with natural language commands.

## What I Can Do

- **Search** for notes using natural language queries
- **Move, copy, and delete** notes from search results
- **Create** new notes with custom content
- **Generate** content with AI assistance
- **Update** existing notes
- **Generate images** to enhance your notes
- **Generate audio** from text
- **Read** content from your current note to provide context-aware help

## How to Use Me

Start by typing a slash command (/) or simply ask a question in natural language. Here are some examples:

- **/search** - Find notes matching criteria (e.g., "/search notes tagged #todo in the root folder")
- **/create** - Create a new note (e.g., "/create Note name: Project Ideas")
- **/image** - Generate an image (e.g., "/image a cat sitting on a bookshelf")
- **/audio** - Generate audio from text (e.g., "/audio This is a test")
- **/close** - Close the current conversation
- **/stop** or **/abort** - Stop an ongoing generation process

You can also:
- Ask me to help with content in your current note ("help with this table")
- Request to move or modify search results
- Generate content based on your specific needs

## Starting a Conversation

You can start a conversation with Steward in two ways:
1. Use the dedicated Steward chat interface
2. Type slash commands directly in any note editor to get inline assistance

## Advanced Features

- **Multiple commands** can be executed in sequence
- **Context-aware assistance** based on your current note
- **Undo changes** with the /revert command
- **Stop ongoing generations** at any time with /stop or /abort

Feel free to explore and let me know how I can assist you with your knowledge management in Obsidian!`;
