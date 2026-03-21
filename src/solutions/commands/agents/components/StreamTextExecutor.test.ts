import { streamText } from 'ai';
import type StewardPlugin from 'src/main';
import { type App } from 'obsidian';
import { StreamTextExecutor } from './StreamTextExecutor';
import { ToolName } from '../../ToolRegistry';
import type { AgentHandlerParams, Intent } from '../../types';
import {
  type ToolContentStreamInfo,
  TOOL_CONTENT_STREAM_CONSUMER_SYMBOL,
} from './ToolContentStreamConsumer';
import type { AgentCorePromptContext } from '../../Agent';

jest.mock('ai', () => {
  const originalModule = jest.requireActual('ai');

  return {
    ...originalModule,
    streamText: jest.fn(),
    tool: jest.fn().mockImplementation(config => config),
  };
});

function createMockPlugin(): jest.Mocked<StewardPlugin> {
  const mockApp = {
    vault: {
      cachedRead: jest.fn().mockResolvedValue(''),
    },
  } as unknown as App;

  const mockRenderer = {
    addGeneratingIndicator: jest.fn(),
    removeIndicator: jest.fn(),
    addUserMessage: jest.fn().mockResolvedValue('user-message-id-123'),
    updateConversationNote: jest.fn().mockResolvedValue('message-id-123'),
    streamConversationNote: jest.fn().mockImplementation(async ({ stream }) => {
      for await (const _chunk of stream) {
        void _chunk;
      }
    }),
    serializeToolInvocation: jest.fn(),
    extractConversationHistory: jest.fn().mockResolvedValue([]),
    updateConversationFrontmatter: jest.fn(),
    getConversationProperty: jest.fn().mockResolvedValue(undefined),
  };

  const mockPlugin = {
    settings: {
      stewardFolder: 'Steward',
      embedding: {
        enabled: true,
      },
      llm: {
        chat: {
          model: 'mock-model',
        },
      },
    },
    app: mockApp,
    registerEvent: jest.fn(),
    llmService: {
      getLLMConfig: jest.fn().mockResolvedValue({
        model: 'mock-model',
        temperature: 0.2,
      }),
      getEmbeddingSettings: jest.fn().mockReturnValue({}),
      validateImageSupport: jest.fn(),
    },
    abortService: {
      createAbortController: jest.fn().mockReturnValue(new AbortController()),
    },
    skillService: {
      getSkillCatalog: jest.fn().mockReturnValue([]),
      getSkillContents: jest.fn().mockReturnValue({ contents: {} }),
    },
    userMessageService: {
      sanitizeQuery: jest.fn((query: string) => query),
    },
    userDefinedCommandService: {
      processSystemPromptsWikilinks: jest.fn().mockImplementation(async prompts => prompts),
      hasCommand: jest.fn().mockReturnValue(false),
    },
    conversationRenderer: mockRenderer,
    guardrailsRuleService: {
      getInstructionsByTool: jest.fn().mockReturnValue(new Map()),
    },
    compactionOrchestrator: {
      run: jest.fn().mockResolvedValue({
        systemMessage: undefined,
      }),
    },
    editor: {
      getCursor: jest.fn().mockReturnValue({ line: 0 }),
    },
  } as unknown as StewardPlugin;

  return mockPlugin as unknown as jest.Mocked<StewardPlugin>;
}

class TestAgent extends StreamTextExecutor {
  [TOOL_CONTENT_STREAM_CONSUMER_SYMBOL] = true as const;

  constructor(
    public plugin: StewardPlugin,
    public renderer: StewardPlugin['conversationRenderer']
  ) {
    super();
  }

  public getValidToolNames(): ReadonlySet<ToolName> {
    // Return a set of all possible tool names for testing
    return new Set([
      ToolName.TODO_LIST_UPDATE,
      ToolName.CONTENT_READING,
      ToolName.ACTIVATE,
      ToolName.LIST,
      ToolName.CREATE,
      ToolName.DELETE,
      ToolName.EDIT,
      ToolName.SEARCH,
      ToolName.SWITCH_AGENT_CAPACITY,
      ToolName.CONCLUDE,
      ToolName.RECALL_COMPACTED_CONTEXT,
    ]);
  }

  public async renderIndicator(): Promise<void> {
    return Promise.resolve();
  }

  public createToolContentExtractor(): { feed: (delta: string) => string } {
    return {
      feed: (delta: string) => delta,
    };
  }

  public async consumeToolContentStream(): Promise<ToolContentStreamInfo | undefined> {
    return undefined;
  }

  public buildCorePrompt(_context?: AgentCorePromptContext): string {
    return 'test-core-system-prompt';
  }

  public async executeForTest(params: AgentHandlerParams) {
    return this.executeStreamText({
      ...params,
      activeTools: [],
      tools: {},
      toolsThatEnableConclude: new Set<ToolName>(),
    });
  }
}

describe('StreamTextExecutor', () => {
  let testAgent: TestAgent;
  let mockPlugin: jest.Mocked<StewardPlugin>;

  beforeEach(() => {
    jest.clearAllMocks();
    mockPlugin = createMockPlugin();
    testAgent = new TestAgent(mockPlugin, mockPlugin.conversationRenderer);

    (streamText as jest.Mock).mockReturnValue({
      fullStream: (async function* () {
        yield { type: 'text-delta', textDelta: '' };
      })(),
      toolCalls: Promise.resolve([]),
    });
  });

  describe('system prompt and fallbacks', () => {
    it('should include system prompt from provider at the first message', async () => {
      const params: AgentHandlerParams = {
        title: 'test-conversation',
        intent: {
          type: 'vault',
          query: 'test query',
        } as Intent,
      };

      const providerSystemPrompt = 'This is a custom system prompt from the provider';

      mockPlugin.llmService.getLLMConfig = jest.fn().mockResolvedValue({
        model: 'mock-model',
        temperature: 0.2,
        maxOutputTokens: 2048,
        systemPrompt: providerSystemPrompt,
      });

      mockPlugin.conversationRenderer.extractConversationHistory = jest.fn().mockResolvedValue([]);

      await testAgent.executeForTest(params);

      expect(streamText).toHaveBeenCalledTimes(1);
      const call = (streamText as jest.Mock).mock.calls[0][0];
      expect(call.messages).toBeDefined();
      expect(call.messages.length).toBeGreaterThan(0);
      expect(call.messages[0].role).toBe('system');
      expect(call.messages[0].content).toBe(providerSystemPrompt);
      expect(call.messages[1].role).toBe('user');
      expect(call.messages[1].content).toBe('test query');
    });

    it('should include user message when invocationCount is undefined', async () => {
      const params: AgentHandlerParams = {
        title: 'test-conversation',
        intent: {
          type: 'vault',
          query: 'test query',
        } as Intent,
      };

      mockPlugin.conversationRenderer.extractConversationHistory = jest
        .fn()
        .mockImplementation(() => Promise.resolve([]));

      await testAgent.executeForTest(params);

      expect(streamText).toHaveBeenCalledTimes(1);
      const call = (streamText as jest.Mock).mock.calls[0][0];
      const userMessage = call.messages.find((m: { role: string }) => m.role === 'user');
      expect(userMessage).toBeDefined();
      expect(userMessage.content).toBe('test query');
    });

    it('should NOT append user message when invocationCount is greater than 0', async () => {
      const params: AgentHandlerParams = {
        title: 'test-conversation',
        intent: {
          type: 'vault',
          query: 'test query',
        } as Intent,
        invocationCount: 1,
      };

      const historyMessages = [
        { role: 'user', content: 'previous query' },
        { role: 'assistant', content: 'previous response' },
      ];
      mockPlugin.conversationRenderer.extractConversationHistory = jest
        .fn()
        .mockResolvedValue(historyMessages);

      await testAgent.executeForTest(params);

      expect(streamText).toHaveBeenCalledTimes(1);
      const call = (streamText as jest.Mock).mock.calls[0][0];
      expect(call.messages).toEqual(historyMessages);
    });
  });
});
