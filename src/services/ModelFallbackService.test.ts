import { TFile } from 'obsidian';
import type StewardPlugin from 'src/main';
import { ModelFallbackService } from './ModelFallbackService';

function createPlugin(overrides: {
  enabled?: boolean;
  fallbackChain?: string[];
  modelFallbackState?: Record<string, unknown> | null;
}): jest.Mocked<StewardPlugin> {
  const frontmatter: Record<string, unknown> = {
    model: 'openai:gpt-4o',
  };
  if (overrides.modelFallbackState) {
    frontmatter.modelFallback = overrides.modelFallbackState;
  }

  const file = { path: 'Steward/Conversations/test-conv.md' } as TFile;

  return {
    settings: {
      stewardFolder: 'Steward',
      llm: {
        modelFallback: {
          enabled: overrides.enabled ?? false,
          fallbackChain: overrides.fallbackChain ?? ['anthropic:claude-sonnet-4'],
        },
      },
    },
    app: {
      vault: {
        getFileByPath: jest.fn().mockReturnValue(file),
      },
      metadataCache: {
        getFileCache: jest.fn().mockReturnValue({ frontmatter }),
      },
      fileManager: {
        processFrontMatter: jest.fn().mockImplementation((_file, mutator) => {
          mutator(frontmatter);
        }),
      },
    },
    conversationRenderer: {
      getConversationProperty: jest.fn().mockImplementation((_title, key) => {
        if (key === 'modelFallback') {
          return Promise.resolve(overrides.modelFallbackState ?? null);
        }
        return Promise.resolve(undefined);
      }),
    },
  } as unknown as jest.Mocked<StewardPlugin>;
}

describe('ModelFallbackService', () => {
  beforeEach(() => {
    (ModelFallbackService as unknown as { instance: ModelFallbackService | null }).instance = null;
  });

  it('isEnabledFor returns true when global fallback is enabled', async () => {
    const plugin = createPlugin({ enabled: true });
    const service = ModelFallbackService.getInstance(plugin);

    expect(await service.isEnabledFor('test-conv')).toBe(true);
  });

  it('isEnabledFor returns true when conversation has a chain and global is disabled', async () => {
    const plugin = createPlugin({
      enabled: false,
      modelFallbackState: {
        originalModel: 'bogus:invalid',
        attemptedModels: ['bogus:invalid'],
        chain: ['bogus:invalid', 'google:gemini-2.5-flash'],
      },
    });
    const service = ModelFallbackService.getInstance(plugin);

    expect(await service.isEnabledFor('test-conv')).toBe(true);
  });

  it('isEnabledFor returns false when global is disabled and no conversation chain', async () => {
    const plugin = createPlugin({ enabled: false, modelFallbackState: null });
    const service = ModelFallbackService.getInstance(plugin);

    expect(await service.isEnabledFor('test-conv')).toBe(false);
  });

  it('uses conversation chain when global fallback is disabled', async () => {
    const plugin = createPlugin({
      enabled: false,
      fallbackChain: ['anthropic:claude-sonnet-4'],
      modelFallbackState: {
        originalModel: 'bogus:invalid',
        attemptedModels: ['bogus:invalid'],
        chain: ['bogus:invalid', 'google:gemini-2.5-flash'],
      },
    });
    const service = ModelFallbackService.getInstance(plugin);

    expect(await service.hasMoreFallbacks('test-conv')).toBe(true);
    const nextModel = await service.switchToNextModel('test-conv');
    expect(nextModel).toBe('google:gemini-2.5-flash');
  });

  it('does not use settings chain when conversation chain is present', async () => {
    const plugin = createPlugin({
      enabled: true,
      fallbackChain: ['anthropic:claude-sonnet-4'],
      modelFallbackState: {
        originalModel: 'bogus:invalid',
        attemptedModels: ['bogus:invalid'],
        chain: ['bogus:invalid', 'google:gemini-2.5-flash'],
      },
    });
    const service = ModelFallbackService.getInstance(plugin);

    const nextModel = await service.switchToNextModel('test-conv');
    expect(nextModel).toBe('google:gemini-2.5-flash');
    expect(nextModel).not.toBe('anthropic:claude-sonnet-4');
  });

  it('returns null when conversation chain is exhausted', async () => {
    const plugin = createPlugin({
      enabled: false,
      modelFallbackState: {
        originalModel: 'bogus:invalid',
        attemptedModels: ['bogus:invalid', 'google:gemini-2.5-flash'],
        chain: ['bogus:invalid', 'google:gemini-2.5-flash'],
      },
    });
    const service = ModelFallbackService.getInstance(plugin);

    expect(await service.hasMoreFallbacks('test-conv')).toBe(false);
    expect(await service.switchToNextModel('test-conv')).toBeNull();
  });

  it('switchToModel updates frontmatter model and appends attemptedModels', async () => {
    const frontmatter: Record<string, unknown> = {
      model: 'deepseek:deepseek-chat',
      modelFallback: {
        originalModel: 'deepseek:deepseek-chat',
        attemptedModels: ['deepseek:deepseek-chat'],
        chain: ['deepseek:deepseek-chat', 'google:gemini-2.5-flash'],
      },
    };
    const plugin = createPlugin({
      enabled: false,
      modelFallbackState: frontmatter.modelFallback as Record<string, unknown>,
    });
    plugin.app.metadataCache.getFileCache = jest.fn().mockReturnValue({ frontmatter });
    plugin.app.fileManager.processFrontMatter = jest.fn().mockImplementation((_file, mutator) => {
      mutator(frontmatter);
    });
    const service = ModelFallbackService.getInstance(plugin);

    const switched = await service.switchToModel('test-conv', 'google:gemini-2.5-flash');

    expect(switched).toBe(true);
    expect(frontmatter.model).toBe('google:gemini-2.5-flash');
    expect((frontmatter.modelFallback as { attemptedModels: string[] }).attemptedModels).toEqual([
      'deepseek:deepseek-chat',
      'google:gemini-2.5-flash',
    ]);
  });
});
