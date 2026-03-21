import { generateText } from 'ai';
import { getClassifier } from 'src/lib/modelfusion';
import type StewardPlugin from 'src/main';
import { ConversationTitleAgent } from './ConversationTitleAgent';

jest.mock('ai', () => {
  const originalModule = jest.requireActual('ai');
  return {
    ...originalModule,
    generateText: jest.fn(),
  };
});

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

    (getClassifier as jest.Mock).mockReturnValue({
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
    (getClassifier as jest.Mock).mockReturnValue({
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
    (generateText as jest.Mock).mockResolvedValue({
      output: {
        title: 'Migration Plan',
        lang: 'VI',
      },
    });

    const result = await agent.generate({
      title: 'test-conversation',
      query: 'please help me design a complete migration plan for this legacy api architecture',
    });

    expect(generateText).toHaveBeenCalledTimes(1);
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
