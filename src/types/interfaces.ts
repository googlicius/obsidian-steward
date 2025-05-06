export interface StewardPluginSettings {
	mySetting: string;
	apiKeys: {
		openai: string;
		elevenlabs: string;
		deepseek: string;
	};
	saltKeyId: string; // Store just the key ID, not the actual salt
	conversationFolder: string;
	searchDbPrefix: string;
	encryptionVersion?: number; // Track the encryption version for future migrations
	staticConversationLeafId?: string; // ID of the leaf containing the static conversation
	excludedFolders: string[]; // Folders to exclude from Obsidian search
	debug: boolean; // Enable debug logging
	audio: {
		model: string;
		voices: Record<string, string>;
	};
	llm: {
		model: string; // The model name (e.g., gpt-4-turbo-preview, llama3.2)
		temperature: number;
		ollamaBaseUrl?: string;
	};
}
