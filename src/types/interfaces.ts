export interface StewardPluginSettings {
  mySetting: string;
  /**
   * Deprecated: use providers instead
   */
  apiKeys?: {
    openai: string;
    elevenlabs: string;
    deepseek: string;
    google: string;
    groq: string;
    anthropic: string;
  };
  providers: {
    [key: string]: {
      apiKey: string; // Encrypted API key
      baseUrl?: string; // Optional base URL for the provider
      isCustom?: boolean; // Mark if this is a custom provider
      compatibility?: string; // Provider compatibility (select from built-in providers)
      name?: string; // Custom provider name (for custom providers only)
      systemPrompt?: string; // Optional system prompt for custom providers
    };
  };
  saltKeyId: string; // Store just the key ID, not the actual salt
  stewardFolder: string;
  searchDbPrefix?: string; // Deprecated: use search.searchDbName instead
  /**
   * Deprecated: use search.searchDbName instead
   */
  searchDbName?: string;
  encryptionVersion?: number; // Track the encryption version for future migrations
  excludedFolders: string[]; // Folders to exclude from Obsidian search
  debug: boolean; // Enable debug logging
  showPronouns: boolean; // Toggle display of User/Steward pronouns in chat
  autoScroll: boolean; // Toggle auto-scroll feature in chat
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
    ollamaBaseUrl?: string; // Deprecated: use providers[provider].baseUrl instead
    maxGenerationTokens?: number; // Maximum number of tokens to generate in response
    embeddingModel?: string; // Deprecated: use embedding.model instead
    // Deprecated: use embedding instead
    embedding?: {
      model: string;
      customModels: string[];
    };
    image: {
      model: string; // The image model (e.g., "openai:dall-e-3", "openai:dall-e-2")
      customModels: string[]; // User-defined custom image models
      size: string; // Image size (e.g., "1024x1024", "1792x1024")
    };
    /**
     * Deprecated: use providers[provider].baseUrl instead
     */
    providerConfigs: {
      [key: string]: { baseUrl?: string };
    };
    speech: {
      model: string; // The speech model (e.g., "openai:tts-1", "elevenlabs:eleven_turbo_v2")
      voices: {
        openai: string; // OpenAI voice ID (e.g., "alloy", "echo", "fable", "onyx", "nova", "shimmer")
        elevenlabs: string; // ElevenLabs voice ID
        hume: string; // Hume voice ID
      };
      customModels: string[]; // User-defined custom speech models
    };
    modelFallback: {
      enabled: boolean; // Enable/disable automatic model fallback
      fallbackChain: string[]; // Ordered list of models to try as fallbacks
    };
  };
  embedding: {
    enabled: boolean; // Enable/disable embedding functionality
    model: string; // The embedding model (e.g., openai:text-embedding-ada-002, google:gemini-embedding-001)
    customModels: string[]; // User-defined custom embedding models
    similarityThreshold: number; // Similarity threshold for embedding matching (0.7 - 0.99)
  };
  search: {
    /** Database name for search functionality */
    searchDbName: string;
    withoutLLM: 'exact' | 'relevant'; // Search mode when query is wrapped in quotation marks
    resultsPerPage: number; // Number of search results per page
  };
  deleteBehavior: {
    behavior: 'stw_trash' | 'obsidian_trash'; // How to handle file deletion
    cleanupPolicy?: 'never' | '7days' | '30days' | '90days' | '1year'; // When to permanently delete files from stw_trash
  };
  lastSeenVersion?: string; // Last version the user has seen (for version notifications)
}

export type DeleteBehavior = StewardPluginSettings['deleteBehavior'];
