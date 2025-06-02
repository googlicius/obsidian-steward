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
	'/prompt',
	'/create',
	'/stop',
	'/abort',
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
	{ id: 'gpt-4-turbo-preview', name: 'GPT-4 Turbo', provider: 'openai' },
	{ id: 'gpt-4-0125-preview', name: 'GPT-4 0125', provider: 'openai' },
	{ id: 'gpt-4-vision-preview', name: 'GPT-4 Vision', provider: 'openai' },
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
