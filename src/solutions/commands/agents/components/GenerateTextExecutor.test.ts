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
    extractConversationHistory: jest.fn().mockResolvedValue([]),
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
    skillService: {
      getSkillCatalog: jest.fn().mockReturnValue([]),
      getSkillContents: jest.fn().mockReturnValue({ contents: {} }),
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
      ToolName.TODO_LIST_UPDATE,
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
    });
  });

  it('includes todoListPrompt when TODO_LIST_UPDATE is active', async () => {
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
      activeTools: [ToolName.TODO_LIST_UPDATE],
      tools: {},
    });

    const call = getMockGenerateText().mock.calls[0][0];
    const systemText = call.messages
      .filter((message: { role: string }) => message.role === 'system')
      .map((message: { content: string }) => message.content)
      .join('\n');

    expect(systemText).toContain('TO-DO LIST:');
    expect(systemText).toContain('Current step: 1 of 1');
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

    expect(systemText).toContain('AVAILABLE SKILLS:');
    expect(systemText).toContain(
      '- search-skill: Search effectively (path: Steward/Skills/search/SKILL.md)'
    );
    expect(systemText).toContain('content_reading');
    expect(systemText).toContain('readType');
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
      tools: {},
    });

    const call = getMockGenerateText().mock.calls[0][0];
    const systemText = call.messages
      .filter((message: { role: string }) => message.role === 'system')
      .map((message: { content: string }) => message.content)
      .join('\n');

    expect(systemText).toContain('TOOLS GUIDELINES:');
    expect(systemText).toContain('OPTIONAL INACTIVE TOOLS:');
    expect(systemText).toContain('Use activate');
  });
});
