import { generateText } from 'ai';
import type StewardPlugin from 'src/main';
import { GenerateTextExecutor } from './GenerateTextExecutor';
import type { AgentHandlerParams, Intent } from '../../types';
import { ToolName } from '../../ToolRegistry';

jest.mock('ai', () => {
  const originalModule = jest.requireActual('ai');
  return {
    ...originalModule,
    generateText: jest.fn(),
  };
});

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

  public async executeForTest(
    params: AgentHandlerParams,
    options: {
      activeTools?: ToolName[];
      inactiveTools?: ToolName[];
      tools?: NonNullable<Parameters<typeof generateText>[0]['tools']>;
    } = {}
  ) {
    return this.executeGenerateText({
      ...params,
      activeTools: options.activeTools || [],
      inactiveTools: options.inactiveTools || [],
      tools: (options.tools || {}) as NonNullable<Parameters<typeof generateText>[0]['tools']> & {
        [s: string]: unknown;
      },
      coreSystemPrompt: 'core-system-prompt',
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

    (generateText as jest.Mock).mockResolvedValue({
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

    const call = (generateText as jest.Mock).mock.calls[0][0];
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

    const call = (generateText as jest.Mock).mock.calls[0][0];
    const systemText = call.messages
      .filter((message: { role: string }) => message.role === 'system')
      .map((message: { content: string }) => message.content)
      .join('\n');

    expect(systemText).toContain('AVAILABLE SKILLS:');
    expect(systemText).toContain('- search-skill: Search effectively (path: Steward/Skills/search/SKILL.md)');
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

    const call = (generateText as jest.Mock).mock.calls[0][0];
    const systemText = call.messages
      .filter((message: { role: string }) => message.role === 'system')
      .map((message: { content: string }) => message.content)
      .join('\n');

    expect(systemText).toContain('TOOLS GUIDELINES:');
    expect(systemText).toContain('OPTIONAL INACTIVE TOOLS:');
    expect(systemText).toContain('Use activate');
  });
});
