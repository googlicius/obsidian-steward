import { LLMService } from './LLMService';
import type StewardPlugin from 'src/main';

// Mock getCdnLib to avoid CDN imports in tests
jest.mock('src/utils/cdnUrls', () => ({
  getCdnLib: jest.fn().mockImplementation((key: string) => {
    const mockProvider = { mockProvider: true };
    const mocks: Record<string, unknown> = {
      anthropic: { createAnthropic: () => mockProvider },
      deepseek: { createDeepSeek: () => mockProvider },
      google: { createGoogleGenerativeAI: () => mockProvider },
      groq: { createGroq: () => mockProvider },
      hume: { createHume: () => mockProvider },
      elevenLabs: { createElevenLabs: () => mockProvider },
      ollama: { createOllama: () => mockProvider },
      openai: { createOpenAI: () => mockProvider },
      openaiCompatible: { createOpenAICompatible: () => mockProvider },
    };
    return Promise.resolve(mocks[key]);
  }),
}));

function createMockPlugin(): jest.Mocked<StewardPlugin> {
  return {
    settings: {
      llm: {
        chat: {
          model: 'ollama:llama3.2:latest',
          customModels: [],
        },
        temperature: 0.2,
        maxGenerationTokens: 2048,
      },
      providers: {
        openai: {
          apiKey: '',
          baseUrl: undefined,
        },
        deepseek: {
          apiKey: '',
          baseUrl: undefined,
        },
        google: {
          apiKey: '',
          baseUrl: undefined,
        },
        groq: {
          apiKey: '',
          baseUrl: undefined,
        },
        ollama: {
          apiKey: '',
          baseUrl: undefined,
        },
        anthropic: {
          apiKey: '',
          baseUrl: undefined,
        },
        custom_provider_1: {
          apiKey: '',
          baseUrl: 'http://localhost:1234/v1',
          isCustom: true,
          name: 'lmstudio',
          compatibility: 'openai',
        },
        custom_provider_2: {
          apiKey: '1234abcd',
          baseUrl: 'http://my-custom-provider.com/api',
          isCustom: true,
          name: 'YaleLab',
          compatibility: 'openai',
        },
      },
    },
    encryptionService: {
      getDecryptedApiKey: jest.fn().mockReturnValue(undefined),
    },
  } as unknown as jest.Mocked<StewardPlugin>;
}

describe('LLMService', () => {
  let llmService: LLMService;
  let mockPlugin: jest.Mocked<StewardPlugin>;

  beforeEach(() => {
    mockPlugin = createMockPlugin();
    llmService = LLMService.getInstance(mockPlugin);
  });

  describe('getProviderFromModel', () => {
    describe('models with provider prefix', () => {
      it('should correctly parse model with colon in modelId (ollama:llama3.2:3b)', async () => {
        const result = await llmService.getProviderFromModel('ollama:llama3.2:3b');

        expect(result.name).toBe('ollama');
        expect(result.modelId).toBe('llama3.2:3b');
        expect(result.provider).toBeDefined();
      });

      it('should correctly parse simple provider:model format (openai:gpt-4)', async () => {
        const result = await llmService.getProviderFromModel('openai:gpt-4');

        expect(result.name).toBe('openai');
        expect(result.modelId).toBe('gpt-4');
        expect(result.provider).toBeDefined();
      });

      it('should correctly parse deepseek model', async () => {
        const result = await llmService.getProviderFromModel('deepseek:deepseek-chat');

        expect(result.name).toBe('deepseek');
        expect(result.modelId).toBe('deepseek-chat');
        expect(result.provider).toBeDefined();
      });

      it('should correctly parse google model', async () => {
        const result = await llmService.getProviderFromModel('google:gemini-2.0-flash');

        expect(result.name).toBe('google');
        expect(result.modelId).toBe('gemini-2.0-flash');
        expect(result.provider).toBeDefined();
      });

      it('should correctly parse groq model', async () => {
        const result = await llmService.getProviderFromModel(
          'groq:meta-llama/llama-4-scout-17b-16e-instruct'
        );

        expect(result.name).toBe('groq');
        expect(result.modelId).toBe('meta-llama/llama-4-scout-17b-16e-instruct');
        expect(result.provider).toBeDefined();
      });

      it('should correctly parse anthropic model', async () => {
        const result = await llmService.getProviderFromModel(
          'anthropic:claude-3-5-sonnet-20241022'
        );

        expect(result.name).toBe('anthropic');
        expect(result.modelId).toBe('claude-3-5-sonnet-20241022');
        expect(result.provider).toBeDefined();
      });

      it('should handle model with multiple colons in modelId', async () => {
        const result = await llmService.getProviderFromModel('ollama:model:version:tag');

        expect(result.name).toBe('ollama');
        expect(result.modelId).toBe('model:version:tag');
        expect(result.provider).toBeDefined();
      });

      it('should correctly parse custom provider model', async () => {
        const result = await llmService.getProviderFromModel('lmstudio:lmstudio-1-3-70b');

        expect(result.name).toBe('lmstudio');
        expect(result.modelId).toBe('lmstudio-1-3-70b');
        expect(result.provider).toBeDefined();
      });

      it('should correctly parse custom provider model with case insensitive name', async () => {
        const result = await llmService.getProviderFromModel('yalelab:gemini-3');

        expect(result.name).toBe('yalelab');
        expect(result.modelId).toBe('gemini-3');
        expect(result.provider).toBeDefined();
      });
    });

    describe('provider configuration', () => {
      it('should pass baseURL to provider when configured', async () => {
        mockPlugin.settings.providers.ollama.baseUrl = 'http://custom-ollama:11434';
        const result = await llmService.getProviderFromModel('ollama:llama3.2:3b');

        expect(result.name).toBe('ollama');
        expect(result.modelId).toBe('llama3.2:3b');
        expect(result.provider).toBeDefined();
      });

      it('should pass apiKey to provider when configured', async () => {
        mockPlugin.settings.providers.openai.apiKey = 'encrypted-key';
        mockPlugin.encryptionService.getDecryptedApiKey = jest
          .fn()
          .mockReturnValue('decrypted-key');
        const result = await llmService.getProviderFromModel('openai:gpt-4');

        expect(result.name).toBe('openai');
        expect(result.modelId).toBe('gpt-4');
        expect(result.provider).toBeDefined();
        expect(mockPlugin.encryptionService.getDecryptedApiKey).toHaveBeenCalledWith('openai');
      });
    });

    describe('error cases', () => {
      it('should throw error for unknown provider', async () => {
        await expect(llmService.getProviderFromModel('unknown-provider:model')).rejects.toThrow(
          'Provider unknown-provider not found'
        );
      });

      it('should throw error for models without provider prefix (random selection)', async () => {
        const modelsWithoutPrefix = [
          'gpt-4-turbo',
          'gpt-3.5-turbo',
          'claude-3-5-sonnet',
          'claude-sonnet-4',
          'gemini-2.0-flash',
          'gemini-3-pro',
          'deepseek-chat',
          'deepseek-reasoner',
          'llama3.2',
          'llama-4-scout',
          'mistral-7b',
          'mixtral-8x7b',
          'phi-2',
          'gemma-2b',
          'qwen-7b',
          'o3',
          'o4-mini',
        ];

        // Randomly select 5 models to test
        const shuffled = [...modelsWithoutPrefix].sort(() => Math.random() - 0.5);
        const selectedModels = shuffled.slice(0, 5);

        for (let i = 0; i < selectedModels.length; i++) {
          const model = selectedModels[i];
          await expect(llmService.getProviderFromModel(model)).rejects.toThrow(
            `Model ${model} must include a provider prefix (e.g., provider:modelId)`
          );
        }
      });
    });
  });
});
