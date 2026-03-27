import { getClassifier } from 'src/lib/modelfusion';
import type StewardPlugin from 'src/main';
import { ConversationTitleAgent } from './ConversationTitleAgent';

jest.mock('src/utils/bundledLibs', () => {
  const actual =
    jest.requireActual<typeof import('src/utils/bundledLibs')>('src/utils/bundledLibs');
  const aiActual = jest.requireActual<typeof import('ai')>('ai');
  const mockGenerateText = jest.fn();
  return {
    ...actual,
    __mockGenerateText: mockGenerateText,
    getBundledLib: jest.fn((key: unknown) => {
      if (key === 'ai') {
        return Promise.resolve({ ...aiActual, generateText: mockGenerateText });
      }
      return actual.getBundledLib(key as never);
    }),
  };
});

function getMockGenerateText(): jest.Mock {
  const mockedBundledLibs = jest.requireMock('src/utils/bundledLibs') as {
    __mockGenerateText: jest.Mock;
  };
  return mockedBundledLibs.__mockGenerateText;
}

jest.mock('src/lib/modelfusion', () => ({
  getClassifier: jest.fn(),
}));

function createMockPlugin(): jest.Mocked<StewardPlugin> {
  return {
    settings: {
      llm: {
        agents: {
          conversationTitle: {
            enabled: true,
            model: '',
          },
        },
      },
    },
    llmService: {
      getEmbeddingSettings: jest.fn().mockReturnValue({}),
      getLLMConfig: jest.fn().mockResolvedValue({
        model: 'mock-model',
      }),
    },
    abortService: {
      createAbortController: jest.fn().mockReturnValue(new AbortController()),
    },
    conversationRenderer: {
      updateConversationFrontmatter: jest.fn().mockResolvedValue(undefined),
    },
  } as unknown as jest.Mocked<StewardPlugin>;
}

describe('ConversationTitleAgent', () => {
  let agent: ConversationTitleAgent;
  let mockPlugin: jest.Mocked<StewardPlugin>;

  beforeEach(() => {
    jest.clearAllMocks();
    mockPlugin = createMockPlugin();
    agent = new ConversationTitleAgent(mockPlugin);

    (getClassifier as jest.Mock).mockResolvedValue({
      doClassify: jest.fn().mockResolvedValue(null),
    });
  });

  it('does not call generateWithLLM for short queries (<= 10 words)', async () => {
    const query = 'help me fix my obsidian plugin bug now please';
    const generateWithLLMSpy = jest.spyOn(
      agent as unknown as { generateWithLLM: (value: string) => Promise<unknown> },
      'generateWithLLM'
    );

    const result = await agent.generate({
      title: 'test-conversation',
      query,
    });

    expect(generateWithLLMSpy).not.toHaveBeenCalled();
    expect(result).toEqual({
      title: query,
      lang: null,
    });
  });

  it('does not call generateWithLLM when static classification returns a title', async () => {
    (getClassifier as jest.Mock).mockResolvedValue({
      doClassify: jest.fn().mockResolvedValue({
        matchType: 'static',
        name: 'knowledge_base',
      }),
    });

    const generateWithLLMSpy = jest.spyOn(
      agent as unknown as { generateWithLLM: (value: string) => Promise<unknown> },
      'generateWithLLM'
    );

    const result = await agent.generate({
      title: 'test-conversation',
      query: 'this is definitely longer than ten words to ensure llm path would be used otherwise',
    });

    expect(generateWithLLMSpy).not.toHaveBeenCalled();
    expect(result).toEqual({
      title: 'Knowledge Base',
      lang: null,
    });
  });

  it('sets lang when generateWithLLM is used', async () => {
    getMockGenerateText().mockResolvedValue({
      output: {
        title: 'Migration Plan',
        lang: 'VI',
      },
    });

    const result = await agent.generate({
      title: 'test-conversation',
      query: 'please help me design a complete migration plan for this legacy api architecture',
    });

    expect(getMockGenerateText()).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      title: 'Migration Plan',
      lang: 'vi',
    });
    expect(mockPlugin.conversationRenderer.updateConversationFrontmatter).toHaveBeenCalledWith(
      'test-conversation',
      expect.arrayContaining([
        { name: 'conversation_title', value: 'Migration Plan' },
        { name: 'lang', value: 'vi' },
      ])
    );
  });
});
