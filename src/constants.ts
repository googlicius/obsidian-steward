import { StewardPluginSettings } from './types/interfaces';
import { CURRENT_SETTINGS_SCHEMA_VERSION } from './settings/migrations/constants';

/**
 * Canonical operation keys passed to AbortService (scoped by conversationTitle).
 */
export const AbortOperationKeys = {
  SUPER_AGENT: 'super-agent',
  BUILD_SEARCH_INDEX: 'build_search_index',
  COMPACTION_SUMMARY: 'compaction-summary',
  CONVERSATION_TITLE: 'conversation-title',
  AUDIO: 'audio',
  IMAGE: 'image',
  CLI_SESSION: 'cli-session',
  /** Single in-flight batch per conversation (sequential mode). */
  DATA_AWARENESS: 'data-awareness',
} as const;

/** Includes {@link AbortOperationKeys} plus dynamic keys such as {@code data-awareness-batch-0}. */
export type AbortOperationKey =
  | (typeof AbortOperationKeys)[keyof typeof AbortOperationKeys]
  | string;

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

export const IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'webp', 'svg', 'gif'];

/**
 * Stw-source pattern constants for reuse across the application
 * Pattern to match any stw-source block (with capture group for splitting)
 */
export const STW_SOURCE_PATTERN = '(\\{\\{stw-source.*?\\}\\})';

/**
 * Short file/folder reference in command input: @path. Path is segment-encoded
 * (per-segment encodeURIComponent) so spaces in names are %20, not raw spaces.
 * The captured path must end with `/` (folder) or `.ext` (file extension)
 * so a match aligns naturally with something that was inserted by the datasource
 * completion. Selection / line-range references still use {{stw-source ...}}.
 */
export const STW_SOURCE_AT_PATH_PATTERN = '@([^\\s@]+(?:\\/|\\.[A-Za-z0-9]{1,10}))';

/**
 * Pattern to match {{stw-squeezed [[<path>]] }}
 */
export const STW_SQUEEZED_PATTERN = '\\{\\{stw-squeezed \\[\\[([^\\]]+)\\]\\] \\}\\}';

/**
 * Matches {{stw-confirmation-buttons title:…,confirm:…?,reject:…?}} — URI-encoded segments,
 * analogous to {@link STW_SOURCE_METADATA_PATTERN}. Capture groups 1–3 : title : confirm : reject .
 */
export const CONFIRMATION_BUTTONS_PATTERN =
  '\\{\\{stw-confirmation-buttons title:([^,]+)(?:,confirm:([^,]*))?(?:,reject:([^}]*))?\\}\\}';

/**
 * Pattern to match any wikilink
 */
export const WIKI_LINK_PATTERN = '\\[\\[([^\\]]+)\\]\\]';

/**
 * Pattern to match embed wikilinks ![[...]] (group 1: inner link text, may include |alias)
 */
export const EMBED_WIKILINK_PATTERN = '!\\[\\[([^\\]]+)\\]\\]';

/**
 * Pattern to extract metadata from stw-source blocks
 * Captures: type (group 1), path (group 2), from (group 3, optional), to (group 4, optional), selection (group 5, optional)
 */
export const STW_SOURCE_METADATA_PATTERN =
  '\\{\\{stw-source type:(\\w+),path:(.+?)(?:,from:(\\d+),to:(\\d+),selection:(.+?))?\\s*\\}\\}';

/**
 * Pattern to extract extracted model prefix m: or model:
 */
export const SELECTED_MODEL_PREFIX_PATTERN = '\\b(m|model):';

/**
 * All built-in command that are available to the command menu
 */
export const COMMAND_PREFIXES = ['/ ', '/search', '/image', '/speech', '/>'];

/**
 * Prefix for client-generated tool call IDs (manual client tool calls, UDC manual steps).
 * Model tool calls from the AI SDK use different IDs; handlers may use this to skip model-only UX.
 */
export const MANUAL_TOOL_CALL_ID_PREFIX = 'manual-tool-call-';

/**
 * Configuration for standard commands indicating whether they require content.
 */
export const COMMAND_CONTENT_REQUIRED: Record<string, boolean> = {
  ' ': true,
  search: true,
  image: true,
  speech: true,
  '>': false,
};

/**
 * The 2-space indentation is used to indicate a command line.
 */
export const TWO_SPACES_PREFIX = '  ';

export const DEFAULT_SETTINGS: StewardPluginSettings = {
  settingsSchemaVersion: CURRENT_SETTINGS_SCHEMA_VERSION,
  mySetting: 'default',
  providers: {
    openai: {
      apiKey: '',
    },
    elevenlabs: {
      apiKey: '',
    },
    google: {
      apiKey: '',
    },
    anthropic: {
      apiKey: '',
    },
    ollama: {
      apiKey: '',
      baseUrl: 'http://localhost:11434/api',
    },
  },
  saltKeyId: '', // Will be generated on first load
  stewardFolder: 'Steward',
  encryptionVersion: 1, // Current version
  excludedFolders: ['node_modules', 'src', '.git', 'dist'], // Default development folders to exclude
  debug: false, // Debug logging disabled by default
  showPronouns: true, // Show pronouns in chat by default
  autoScroll: true, // Auto-scroll enabled by default
  chatViewDock: 'right',
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
      modelContextLengths: {},
    temperature: 0.2,
    ollamaBaseUrl: 'http://localhost:11434/api', // Deprecated: use providerConfigs instead
    maxGenerationTokens: 2048, // Default max tokens for generation
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
        hume: 'ee96fb5f-ec1a-4f41-a9ba-6d119e64c8fd',
      },
      customModels: [], // User-defined custom speech models
    },
    modelFallback: {
      enabled: true,
      fallbackChain: [], // Empty by default - users must configure
    },
    agents: {
      compactionSummary: {
        enabled: true,
        model: '',
        customModels: [],
      },
      conversationTitle: {
        enabled: true,
        model: '',
        customModels: [],
      },
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
  cli: {
    enabled: true,
    shellExecutable: '',
    workingDirectory: '',
    interactivePrograms: '',
    nodePtyNativePath: '',
  },
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

  // Google models
  { id: 'google:gemini-3-pro-preview', name: 'Gemini 3 Pro', isReasoning: true },
  { id: 'google:gemini-2.5-flash', name: 'Gemini 2.5 Flash' },

  // Ollama models
  { id: 'ollama:llama3.1:latest', name: 'Llama 3.1 8B' },
  { id: 'ollama:llama3.2:latest', name: 'Llama 3.2' },
  { id: 'ollama:mistral:latest', name: 'Mistral' },
  { id: 'ollama:mixtral:latest', name: 'Mixtral' },

  // Anthropic models
  { id: 'anthropic:claude-sonnet-4-20250514', name: 'Claude 4 Sonnet' },
  { id: 'anthropic:claude-3-7-sonnet-20250219', name: 'Claude 3.7 Sonnet', isReasoning: true },
];

export type ProviderNeedApiKey =
  | 'openai'
  | 'elevenlabs'
  | 'google'
  | 'anthropic'
  | 'ollama'
  | 'hume';

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

  // Hume Speech Models
  { id: 'hume:no_model_id', name: 'Hume Speech' }, // Hume provider doesn't need a modelId
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

// GitHub repository information for fetching documentation
export const GITHUB_OWNER = 'googlicius';
export const GITHUB_REPO = 'obsidian-steward';
export const GITHUB_RAW_BASE_URL = `https://raw.githubusercontent.com/${GITHUB_OWNER}/${GITHUB_REPO}/main`;
export const GITHUB_WIKI_URL = `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}/wiki`;

// Documentation folder name within the Steward folder
export const DOCS_FOLDER_NAME = 'Docs';

// Documentation files available for lazy loading from GitHub
export const DOCUMENTATION_FILES = {
  SEARCH_GUIDELINE: 'Search guideline v2',
  USER_DEFINED_COMMAND_GUIDELINE: 'User-defined command guideline v2',
  SKILLS_GUIDELINE: 'Skills guideline',
} as const;

// Wiki page slugs corresponding to documentation files
export const WIKI_PAGES = {
  GET_STARTED: 'Get-started',
  SEARCH: 'Search',
  USER_DEFINED_COMMANDS: 'User-defined-commands',
  SKILLS: 'Skills',
  GUARDRAILS: 'Guardrails',
  MCP: 'MCP',
  CLI: 'CLI',
} as const;

// Community user-defined commands available for lazy loading from GitHub
export const COMMUNITY_COMMANDS = {
  ASK: 'ask',
  CLEAN_UP: 'Clean up',
  FLASHCARD_ASK: 'Flashcard ask',
  WORD_PROCESSOR: 'Word processor',
} as const;
