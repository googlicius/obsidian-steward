import type StewardPlugin from 'src/main';
import { GenerateTextExecutor } from './GenerateTextExecutor';
import type { AgentHandlerParams, Intent } from '../../types';
import { ToolName } from '../../ToolRegistry';
import type { generateText } from 'ai';

type AiGenerateTextParams = Parameters<typeof generateText>[0];

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

function createMockPlugin(): jest.Mocked<StewardPlugin> {
  const mockRenderer = {
    extractConversationHistory: jest
      .fn()
      .mockResolvedValue({ messages: [], hasCompactionContext: false }),
    updateConversationNote: jest.fn().mockResolvedValue('message-id-123'),
    getConversationProperty: jest.fn().mockResolvedValue(undefined),
  };

  const mockPlugin = {
    settings: {
      llm: {
        chat: {
          model: 'mock-model',
        },
      },
    },
    llmService: {
      getLLMConfig: jest.fn().mockResolvedValue({
        model: 'mock-model',
        temperature: 0.2,
        maxOutputTokens: 1024,
      }),
      validateImageSupport: jest.fn(),
    },
    mcpService: {
      getMcpToolsForConversation: jest.fn().mockResolvedValue({
        active: {} as Record<string, unknown>,
        inactive: {} as Record<string, unknown>,
      }),
      isMCPToolName: jest.fn().mockReturnValue(false),
    },
    abortService: {
      createAbortController: jest.fn().mockReturnValue(new AbortController()),
    },
    guardrailsRuleService: {
      getInstructionsByTool: jest.fn().mockReturnValue(new Map()),
    },
    toolInstructionService: {
      getInstructionsByTool: jest.fn().mockReturnValue(new Map()),
      getToolInstructionsRelativePath: jest
        .fn()
        .mockReturnValue('Steward/Memory/Tool instructions.md'),
    },
    skillService: {
      getSkillCatalog: jest.fn().mockReturnValue([]),
      getSkillContents: jest.fn().mockReturnValue({ contents: {} }),
    },
    subAgentDefinitionService: {
      getCatalog: jest.fn().mockReturnValue([]),
      getDefinitionRelativePath: jest.fn().mockReturnValue('Steward/Sub Agents.md'),
    },
    userDefinedCommandService: {
      getEnabledCommandCatalog: jest.fn().mockReturnValue([]),
    },
    conversationRenderer: mockRenderer,
  } as unknown as StewardPlugin;

  return mockPlugin as unknown as jest.Mocked<StewardPlugin>;
}

class TestAgent extends GenerateTextExecutor {
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
    ]);
  }

  public buildCorePrompt(): string {
    return 'core-system-prompt';
  }

  public includesDelegatedCatalogSections(): boolean {
    return true;
  }

  public async executeForTest(
    params: AgentHandlerParams,
    options: {
      activeTools?: ToolName[];
      inactiveTools?: ToolName[];
      tools?: NonNullable<AiGenerateTextParams['tools']>;
    } = {}
  ) {
    return this.executeGenerateText({
      ...params,
      activeTools: options.activeTools || [],
      inactiveTools: options.inactiveTools || [],
      tools: (options.tools || {}) as NonNullable<AiGenerateTextParams['tools']> & {
        [s: string]: unknown;
      },
    });
  }
}

describe('GenerateTextExecutor', () => {
  let testAgent: TestAgent;
  let mockPlugin: jest.Mocked<StewardPlugin>;

  beforeEach(() => {
    jest.clearAllMocks();
    mockPlugin = createMockPlugin();
    testAgent = new TestAgent(mockPlugin, mockPlugin.conversationRenderer);

    getMockGenerateText().mockResolvedValue({
      text: '',
      toolCalls: [],
      usage: {
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
      },
      totalUsage: {
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
      },
    });
  });

  it('does not inject todo list state into system prompt when TODO_WRITE is active', async () => {
    const params: AgentHandlerParams = {
      title: 'test-conversation',
      intent: {
        type: 'vault',
        query: 'test query',
      } as Intent,
    };

    mockPlugin.conversationRenderer.getConversationProperty = jest.fn().mockResolvedValue({
      currentStep: 1,
      steps: [{ task: 'Create file', status: 'pending' }],
      createdBy: 'ai',
    });

    await testAgent.executeForTest(params, {
      activeTools: [ToolName.TODO_WRITE],
      tools: {},
    });

    const call = getMockGenerateText().mock.calls[0][0];
    const systemText = call.messages
      .filter((message: { role: string }) => message.role === 'system')
      .map((message: { content: string }) => message.content)
      .join('\n');

    expect(systemText).not.toContain('TO-DO LIST:');
    expect(systemText).not.toContain('Current step: 1 of 1');
  });

  it('includes skill catalog with path and read_content instruction', async () => {
    const params: AgentHandlerParams = {
      title: 'test-conversation',
      intent: {
        type: 'vault',
        query: 'test query',
      } as Intent,
    };

    mockPlugin.skillService.getSkillCatalog = jest.fn().mockReturnValue([
      {
        name: 'search-skill',
        description: 'Search effectively',
        path: 'Steward/Skills/search/SKILL.md',
      },
    ]);

    await testAgent.executeForTest(params, {
      tools: {},
    });

    const call = getMockGenerateText().mock.calls[0][0];
    const systemText = call.messages
      .filter((message: { role: string }) => message.role === 'system')
      .map((message: { content: string }) => message.content)
      .join('\n');

    expect(systemText).toContain('### Available skills');
    expect(systemText).toContain(
      '- search-skill: Search effectively (path: Steward/Skills/search/SKILL.md)'
    );
    expect(systemText).toContain('content_reading');
    expect(systemText).toContain('readType');
  });

  it('includes sub-agent catalog with read instruction', async () => {
    const params: AgentHandlerParams = {
      title: 'test-conversation',
      intent: {
        type: 'vault',
        query: 'test query',
      } as Intent,
    };

    mockPlugin.subAgentDefinitionService.getCatalog = jest.fn().mockReturnValue([
      {
        id: 'image_vision',
        description: 'Reads and analyzes images using a vision-capable model',
      },
    ]);

    await testAgent.executeForTest(params, {
      tools: {},
    });

    const call = getMockGenerateText().mock.calls[0][0];
    const systemText = call.messages
      .filter((message: { role: string }) => message.role === 'system')
      .map((message: { content: string }) => message.content)
      .join('\n');

    expect(systemText).toContain('### Available sub-agents');
    expect(systemText).toContain(
      '- image_vision: Reads and analyzes images using a vision-capable model'
    );
    expect(systemText).toContain('Steward/Sub Agents.md');
    expect(systemText).toContain('spawn_subagent');
  });

  it('omits skill, sub-agent, and UDC catalog sections for delegated sub-agents', async () => {
    class SubAgentTestExecutor extends GenerateTextExecutor {
      constructor(
        public plugin: StewardPlugin,
        public renderer: StewardPlugin['conversationRenderer']
      ) {
        super();
      }

      public getValidToolNames(): ReadonlySet<ToolName> {
        return new Set([ToolName.CONTENT_READING, ToolName.ACTIVATE]);
      }

      public buildCorePrompt(): string {
        return 'subagent-core-prompt';
      }

      public includesDelegatedCatalogSections(): boolean {
        return false;
      }

      public executeForTest(params: AgentHandlerParams) {
        return this.executeGenerateText({
          ...params,
          activeTools: [ToolName.CONTENT_READING],
          inactiveTools: [],
          tools: {},
        });
      }
    }

    const subAgent = new SubAgentTestExecutor(mockPlugin, mockPlugin.conversationRenderer);
    mockPlugin.skillService.getSkillCatalog = jest.fn().mockReturnValue([
      {
        name: 'guardrails',
        description: 'Safety rules',
        path: 'Steward/Skills/guardrails/SKILL.md',
      },
    ]);
    mockPlugin.subAgentDefinitionService.getCatalog = jest.fn().mockReturnValue([
      { id: 'image_vision', description: 'Reads images' },
    ]);

    await subAgent.executeForTest({
      title: 'parent__subagent_abc',
      intent: {
        type: 'vault',
        query: 'Describe the image',
        systemPrompts: ['You are an image analysis agent.'],
      } as Intent,
    });

    const call = getMockGenerateText().mock.calls.at(-1)?.[0];
    const systemText = call.messages
      .filter((message: { role: string }) => message.role === 'system')
      .map((message: { content: string }) => message.content)
      .join('\n');

    expect(systemText).not.toContain('### Available skills');
    expect(systemText).not.toContain('### Available sub-agents');
    expect(systemText).not.toContain('User-defined commands combine');
    expect(systemText).toContain('You are an image analysis agent.');
    expect(systemText).toContain('## Tool');
  });

  it('includes tool instructions prompt when tools are enabled', async () => {
    const params: AgentHandlerParams = {
      title: 'test-conversation',
      intent: {
        type: 'vault',
        query: 'test query',
      } as Intent,
    };

    await testAgent.executeForTest(params, {
      activeTools: [ToolName.ACTIVATE],
      tools: {
        [ToolName.ACTIVATE]: { description: 'Activate tools' },
      } as unknown as NonNullable<AiGenerateTextParams['tools']>,
    });

    const call = getMockGenerateText().mock.calls[0][0];
    const systemText = call.messages
      .filter((message: { role: string }) => message.role === 'system')
      .map((message: { content: string }) => message.content)
      .join('\n');

    expect(systemText).toContain('## Tool');
    expect(systemText).toContain('### Available tools');
    expect(systemText).toContain('### Guidelines');
    expect(systemText).toContain('### Other tools');
    expect(systemText).toContain('Use activate');
  });
});
