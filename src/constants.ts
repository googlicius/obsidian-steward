import { StewardPluginSettings } from './types/interfaces';

export const SMILE_CHAT_ICON_ID = 'smile-chat-icon';

export const STW_CONVERSATION_VIEW_CONFIG = {
	type: 'steward-conversation',
	icon: SMILE_CHAT_ICON_ID,
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
];

export const DEFAULT_SETTINGS: StewardPluginSettings = {
	mySetting: 'default',
	apiKeys: {
		openai: '',
		elevenlabs: '',
		deepseek: '',
	},
	saltKeyId: '', // Will be generated on first load
	conversationFolder: 'Steward/Conversations',
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
