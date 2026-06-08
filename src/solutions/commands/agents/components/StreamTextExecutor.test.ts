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

jest.mock('src/utils/bundledLibs', () => {
  const actual =
    jest.requireActual<typeof import('src/utils/bundledLibs')>('src/utils/bundledLibs');
  const aiActual = jest.requireActual<typeof import('ai')>('ai');
  const mockStreamText = jest.fn();
  const mockTool = jest.fn().mockImplementation((config: unknown) => config);
  return {
    ...actual,
    __mockStreamText: mockStreamText,
    getBundledLib: jest.fn(async (key: unknown) => {
      if (key === 'ai') {
        return {
          ...aiActual,
          streamText: mockStreamText,
          tool: mockTool,
        };
      }
      return actual.getBundledLib(key as never);
    }),
  };
});

function getMockStreamText(): jest.Mock {
  const mocked = jest.requireMock('src/utils/bundledLibs') as { __mockStreamText: jest.Mock };
  return mocked.__mockStreamText;
}

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
          customModels: [],
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
      abortOperation: jest.fn().mockReturnValue(true),
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
      getEnabledCommandCatalog: jest.fn().mockReturnValue([]),
    },
    conversationRenderer: mockRenderer,
    guardrailsRuleService: {
      getInstructionsByTool: jest.fn().mockReturnValue(new Map()),
    },
    toolInstructionService: {
      getInstructionsByTool: jest.fn().mockReturnValue(new Map()),
      getToolInstructionsRelativePath: jest
        .fn()
        .mockReturnValue('Steward/Memory/Tool instructions.md'),
    },
    compactionTokenService: {},
    mcpService: {
      getMcpToolsForConversation: jest.fn().mockResolvedValue({
        active: {} as Record<string, unknown>,
        inactive: {} as Record<string, unknown>,
      }),
      isMCPToolName: jest.fn().mockReturnValue(false),
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
      ToolName.TODO_WRITE,
      ToolName.CONTENT_READING,
      ToolName.ACTIVATE,
      ToolName.LIST,
      ToolName.CREATE,
      ToolName.DELETE,
      ToolName.EDIT,
      ToolName.SEARCH,
      ToolName.SWITCH_AGENT_CAPACITY,
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

    getMockStreamText().mockReturnValue({
      fullStream: (async function* () {
        yield { type: 'text-delta', textDelta: '' };
      })(),
      toolCalls: Promise.resolve([]),
      usage: Promise.resolve({
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        inputTokenDetails: {
          noCacheTokens: undefined,
          cacheReadTokens: undefined,
          cacheWriteTokens: undefined,
        },
        outputTokenDetails: {
          textTokens: undefined,
          reasoningTokens: undefined,
        },
      }),
      totalUsage: Promise.resolve({
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        inputTokenDetails: {
          noCacheTokens: undefined,
          cacheReadTokens: undefined,
          cacheWriteTokens: undefined,
        },
        outputTokenDetails: {
          textTokens: undefined,
          reasoningTokens: undefined,
        },
      }),
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

      mockPlugin.conversationRenderer.extractConversationHistory = jest
        .fn()
        .mockResolvedValue({ messages: [], hasCompactionContext: false });

      await testAgent.executeForTest(params);

      expect(getMockStreamText()).toHaveBeenCalledTimes(1);
      const call = getMockStreamText().mock.calls[0][0];
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
        .mockImplementation(() => Promise.resolve({ messages: [], hasCompactionContext: false }));

      await testAgent.executeForTest(params);

      expect(getMockStreamText()).toHaveBeenCalledTimes(1);
      const call = getMockStreamText().mock.calls[0][0];
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
        .mockResolvedValue({ messages: historyMessages, hasCompactionContext: false });

      await testAgent.executeForTest(params);

      expect(getMockStreamText()).toHaveBeenCalledTimes(1);
      const call = getMockStreamText().mock.calls[0][0];
      expect(call.messages).toEqual(historyMessages);
    });

    it('loads conversation history via extractConversationHistory with compaction-aware options', async () => {
      const historyMessages = [{ role: 'assistant', content: 'COMPACTED CONVERSATION CONTEXT' }];
      mockPlugin.conversationRenderer.extractConversationHistory = jest
        .fn()
        .mockResolvedValue({ messages: historyMessages, hasCompactionContext: true });

      const params: AgentHandlerParams = {
        title: 'test-conversation',
        intent: {
          type: 'vault',
          query: 'test query',
        } as Intent,
      };

      await testAgent.executeForTest(params);

      expect(mockPlugin.conversationRenderer.extractConversationHistory).toHaveBeenCalledWith(
        'test-conversation'
      );
    });
  });

  describe('inactive dynamic tool calls', () => {
    it('settleStreamPromise resolves early with a synthetic dynamic tool call', async () => {
      let capturedOnAbort: ((event: { steps?: unknown[] }) => void) | undefined;

      getMockStreamText().mockImplementation(options => {
        capturedOnAbort = options.onAbort;

        queueMicrotask(() => {
          options.onChunk?.({
            chunk: {
              type: 'tool-input-start',
              id: 'call-inactive-edit',
              toolName: ToolName.EDIT,
              dynamic: true,
            },
          });
        });

        return {
          fullStream: (async function* () {})(),
          toolCalls: new Promise(() => {
            // Never resolves — early settlement should win the race.
          }),
        };
      });

      mockPlugin.abortService.abortOperation = jest.fn(() => {
        capturedOnAbort?.({ steps: [] });
        return true;
      });

      const params: AgentHandlerParams = {
        title: 'test-conversation',
        intent: {
          type: 'vault',
          query: 'edit my note',
        } as Intent,
      };

      mockPlugin.conversationRenderer.extractConversationHistory = jest
        .fn()
        .mockResolvedValue({ messages: [], hasCompactionContext: false });

      const result = await testAgent.executeForTest(params);
      const toolCalls = result.toolCalls as Array<{
        toolCallId: string;
        toolName: string;
        dynamic?: boolean;
        error?: { name: string };
      }>;

      expect(mockPlugin.abortService.abortOperation).toHaveBeenCalledWith(
        'test-conversation',
        'super-agent'
      );
      expect(toolCalls).toHaveLength(1);
      expect(toolCalls[0].toolCallId).toBe('call-inactive-edit');
      expect(toolCalls[0].toolName).toBe(ToolName.EDIT);
      expect(toolCalls[0].dynamic).toBe(true);
      expect(toolCalls[0].error?.name).toBe('AI_NoSuchToolError');
      expect(result.text).toBe('');
      expect(result.usage).toBeUndefined();
      expect(result.totalUsage).toBeUndefined();
    });

    it('skips reading stream output when settled early with inactive tool call', async () => {
      const accessOutput = jest.fn();
      const pendingOutput = new Promise<string>(() => {
        // Never resolves — would hang if executeStreamText awaited output after early settlement.
      });

      getMockStreamText().mockImplementation(options => {
        queueMicrotask(() => {
          options.onChunk?.({
            chunk: {
              type: 'tool-input-start',
              id: 'call-inactive-edit',
              toolName: ToolName.EDIT,
            },
          });
        });

        return {
          fullStream: (async function* () {})(),
          toolCalls: new Promise(() => {}),
          get text() {
            accessOutput('text');
            return pendingOutput;
          },
          get usage() {
            accessOutput('usage');
            return pendingOutput;
          },
          get totalUsage() {
            accessOutput('totalUsage');
            return pendingOutput;
          },
        };
      });

      const params: AgentHandlerParams = {
        title: 'test-conversation',
        intent: {
          type: 'vault',
          query: 'edit my note',
        } as Intent,
      };

      mockPlugin.conversationRenderer.extractConversationHistory = jest
        .fn()
        .mockResolvedValue({ messages: [], hasCompactionContext: false });

      const result = await testAgent.executeForTest(params);

      expect(accessOutput).not.toHaveBeenCalled();
      expect(result.text).toBe('');
      expect(result.usage).toBeUndefined();
      expect(result.totalUsage).toBeUndefined();
    });
  });
});
