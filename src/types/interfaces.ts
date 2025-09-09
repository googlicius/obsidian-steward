export interface StewardPluginSettings {
  mySetting: string;
  apiKeys: {
    openai: string;
    elevenlabs: string;
    deepseek: string;
    google: string;
    groq: string;
    anthropic: string;
  };
  saltKeyId: string; // Store just the key ID, not the actual salt
  stewardFolder: string;
  searchDbPrefix: string;
  encryptionVersion?: number; // Track the encryption version for future migrations
  excludedFolders: string[]; // Folders to exclude from Obsidian search
  debug: boolean; // Enable debug logging
  borderedInput: boolean; // Toggle border around command input
  showPronouns: boolean; // Toggle display of User/Steward pronouns in chat
  audio: {
    model: string;
    voices: Record<string, string>;
  };
  llm: {
    model: string; // The model name (e.g., gpt-4-turbo-preview, llama3.2)
    temperature: number;
    ollamaBaseUrl?: string; // Deprecated: use providerConfigs instead
    maxGenerationTokens?: number; // Maximum number of tokens to generate in response
    embeddingModel: string; // The embedding model (e.g., openai:text-embedding-ada-002, google:gemini-embedding-001)
    providerConfigs: {
      openai?: { baseUrl?: string };
      deepseek?: { baseUrl?: string };
      google?: { baseUrl?: string };
      groq?: { baseUrl?: string };
      ollama?: { baseUrl?: string };
      anthropic?: { baseUrl?: string };
    };
  };
  search: {
    withoutLLM: 'exact' | 'relevant'; // Search mode when query is wrapped in quotation marks
    resultsPerPage: number; // Number of search results per page
  };
}
