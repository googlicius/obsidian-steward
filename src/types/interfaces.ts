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
  searchDbPrefix?: string; // Deprecated: use searchDbName instead
  searchDbName: string; // Database name for search functionality
  encryptionVersion?: number; // Track the encryption version for future migrations
  excludedFolders: string[]; // Folders to exclude from Obsidian search
  debug: boolean; // Enable debug logging
  borderedInput: boolean; // Toggle border around command input
  showPronouns: boolean; // Toggle display of User/Steward pronouns in chat
  // Undefined for backward compatibility
  audio:
    | {
        model: string;
        voices: Record<string, string>;
      }
    | undefined;
  llm: {
    model?: string; // Deprecated: use chat.model instead
    chat: {
      model: string; // The chat model (e.g., gpt-4-turbo-preview, llama3.2)
      customModels: string[]; // User-defined custom chat models
    };
    temperature: number;
    ollamaBaseUrl?: string; // Deprecated: use providerConfigs instead
    maxGenerationTokens?: number; // Maximum number of tokens to generate in response
    showExtractionExplanation?: boolean; // Show detailed explanation for command extractions
    embeddingModel?: string; // Deprecated: use embedding.model instead
    embedding: {
      model: string; // The embedding model (e.g., openai:text-embedding-ada-002, google:gemini-embedding-001)
      customModels: string[]; // User-defined custom embedding models
    };
    image: {
      model: string; // The image model (e.g., "openai:dall-e-3", "openai:dall-e-2")
      customModels: string[]; // User-defined custom image models
      size: string; // Image size (e.g., "1024x1024", "1792x1024")
    };
    providerConfigs: {
      [key: string]: { baseUrl?: string };
    };
    speech: {
      model: string; // The speech model (e.g., "openai:tts-1", "elevenlabs:eleven_turbo_v2")
      voices: {
        openai: string; // OpenAI voice ID (e.g., "alloy", "echo", "fable", "onyx", "nova", "shimmer")
        elevenlabs: string; // ElevenLabs voice ID
      };
      customModels: string[]; // User-defined custom speech models
    };
  };
  search: {
    withoutLLM: 'exact' | 'relevant'; // Search mode when query is wrapped in quotation marks
    resultsPerPage: number; // Number of search results per page
  };
}
