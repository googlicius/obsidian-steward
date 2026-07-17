import type StewardPlugin from 'src/main';
import { ToolName } from 'src/solutions/commands/toolNames';
import type { CompactionData } from './types';
import {
  COMPACTION_PROMPT_THRESHOLD_PERCENT,
  MODEL_CHANGE_COMPACTION_THRESHOLD_PERCENT,
  CompactionTokenService,
  estimatePromptTokensRoughFromMessages,
} from './CompactionTokenService';
import type { ToolCallPart, ToolResultPart } from 'src/solutions/commands/tools/types';

function createMockPlugin(): jest.Mocked<StewardPlugin> {
  return {
    llmService: {
      getModelContextLengthTokens: jest.fn().mockReturnValue(128_000),
    },
    conversationRenderer: {
      extractConversationHistory: jest.fn().mockResolvedValue([]),
      updateConversationNote: jest.fn(),
      updateMessageMetadata: jest.fn(),
      getMessagesForCompaction: jest.fn().mockResolvedValue([]),
      getRecordedInputTokensForAgent: jest.fn(),
      countCompactedMessageBlocks: jest.fn().mockResolvedValue(0),
    },
    settings: {
      llm: {
        agents: {
          compactionSummary: {
            enabled: false,
            model: '',
          },
        },
      },
    },
  } as unknown as jest.Mocked<StewardPlugin>;
}

describe('CompactionTokenService', () => {
  describe('shouldTriggerCompactionByTokens', () => {
    let service: CompactionTokenService;
    let shouldTriggerCompactionByTokens: (params: {
      promptTokens: number;
      contextLength: number;
      thresholdPercent: number;
    }) => boolean;

    beforeEach(() => {
      service = new CompactionTokenService(createMockPlugin());
      shouldTriggerCompactionByTokens = service['shouldTriggerCompactionByTokens'].bind(service);
    });

    it('returns true at equality', () => {
      const contextLength = 128_000;
      const threshold = Math.round(contextLength * COMPACTION_PROMPT_THRESHOLD_PERCENT);
      expect(
        shouldTriggerCompactionByTokens({
          promptTokens: threshold,
          contextLength,
          thresholdPercent: COMPACTION_PROMPT_THRESHOLD_PERCENT,
        })
      ).toBe(true);
    });

    it('returns false below threshold', () => {
      expect(
        shouldTriggerCompactionByTokens({
          promptTokens: 63_999,
          contextLength: 128_000,
          thresholdPercent: COMPACTION_PROMPT_THRESHOLD_PERCENT,
        })
      ).toBe(false);
    });

    it('clamps threshold percent to [0, 1]', () => {
      expect(
        shouldTriggerCompactionByTokens({
          promptTokens: 1,
          contextLength: 10,
          thresholdPercent: 2,
        })
      ).toBe(false);

      expect(
        shouldTriggerCompactionByTokens({
          promptTokens: 10,
          contextLength: 10,
          thresholdPercent: 2,
        })
      ).toBe(true);

      expect(
        shouldTriggerCompactionByTokens({
          promptTokens: 0,
          contextLength: 100,
          thresholdPercent: -1,
        })
      ).toBe(true);
    });
  });

  describe('buildCompactedMessage', () => {
    let service: CompactionTokenService;
    let buildCompactedMessage: (data: CompactionData, params: { compactIndex: number }) => string;

    beforeEach(() => {
      service = new CompactionTokenService(createMockPlugin());
      buildCompactedMessage = service['buildCompactedMessage'].bind(service);
    });

    const sampleData: CompactionData = {
      messages: [
        {
          type: 'message',
          messageId: 'id1',
          role: 'user',
          contentMode: 'original',
          content: 'Hello',
          wordCount: 1,
        },
      ],
    };

    it('includes compaction guideline and Compact #1 for the first block', () => {
      const text = buildCompactedMessage(sampleData, { compactIndex: 1 });
      expect(text).toContain('COMPACTED CONVERSATION CONTEXT');
      expect(text).toContain('IMPORTANT:');
      expect(text).toContain('Compact #1');
      expect(text).toContain('Compacted context:');
    });

    it('omits guideline for Compact #2+ and keeps label', () => {
      const text = buildCompactedMessage(sampleData, { compactIndex: 2 });
      expect(text).not.toContain('IMPORTANT:');
      expect(text).not.toContain('COMPACTED CONVERSATION CONTEXT');
      expect(text).toContain('Compact #2');
      expect(text).toContain('Compacted context:');
    });
  });
});

describe('compactToolResult (no dedicated compactor)', () => {
  let compactToolResult: (
    toolResult: ToolResultPart,
    messageId: string,
    toolCall: ToolCallPart
  ) => ReturnType<CompactionTokenService['compactToolResult']>;

  beforeEach(() => {
    const service = new CompactionTokenService(createMockPlugin());
    compactToolResult = service['compactToolResult'].bind(service);
  });

  it('stores full tool call input and recall hint for shell', () => {
    const shellToolCall = {
      type: 'tool-call' as const,
      toolName: ToolName.SHELL,
      toolCallId: 'call_shell',
      input: { argsLine: 'npm run build', purpose: 'Build project' },
    } satisfies ToolCallPart;
    const toolResult = {
      type: 'tool-result' as const,
      toolName: ToolName.SHELL,
      toolCallId: 'call_shell',
      output: { type: 'text', value: 'messageRef:abc' },
    } satisfies ToolResultPart;

    const result = compactToolResult(toolResult, 'msg1', shellToolCall);

    expect(result.toolName).toBe(ToolName.SHELL);
    expect(result.metadata.input).toEqual({
      argsLine: 'npm run build',
      purpose: 'Build project',
    });
    expect(String(result.metadata.output)).toContain(ToolName.RECALL_COMPACTED_CONTEXT);
    expect(result.metadata.outputSize).toBe('messageRef:abc'.length);
  });
});

describe('compactOnModelChangeIfNeeded', () => {
  let service: CompactionTokenService;
  let mockPlugin: jest.Mocked<StewardPlugin>;

  const CONTEXT_LENGTH = 128_000;
  const AT_THRESHOLD = Math.ceil(CONTEXT_LENGTH * MODEL_CHANGE_COMPACTION_THRESHOLD_PERCENT);
  const BELOW_THRESHOLD =
    Math.floor(CONTEXT_LENGTH * MODEL_CHANGE_COMPACTION_THRESHOLD_PERCENT) - 1;

  function mockRecordedInputTokens(value: number | undefined) {
    (mockPlugin.conversationRenderer.getRecordedInputTokensForAgent as jest.Mock).mockResolvedValue(
      value
    );
  }

  beforeEach(() => {
    mockPlugin = createMockPlugin();
    service = new CompactionTokenService(mockPlugin);
  });

  it('does nothing and reports modelChanged: false on the first call for a conversation (no previous model to compare against)', async () => {
    mockRecordedInputTokens(AT_THRESHOLD);

    const result = await service.compactOnModelChangeIfNeeded({
      conversationTitle: 'convo-1',
      model: 'anthropic:claude-sonnet-4',
    });

    expect(result).toEqual({ modelChanged: false });
    expect(mockPlugin.conversationRenderer.getMessagesForCompaction).not.toHaveBeenCalled();
  });

  it('does nothing and reports modelChanged: false when the model is unchanged from the previous call', async () => {
    mockRecordedInputTokens(AT_THRESHOLD);

    await service.compactOnModelChangeIfNeeded({
      conversationTitle: 'convo-1',
      model: 'anthropic:claude-sonnet-4',
    });
    const result = await service.compactOnModelChangeIfNeeded({
      conversationTitle: 'convo-1',
      model: 'anthropic:claude-sonnet-4',
    });

    expect(result).toEqual({ modelChanged: false });
    expect(mockPlugin.conversationRenderer.getMessagesForCompaction).not.toHaveBeenCalled();
  });

  it('reports modelChanged: true but does not run compaction when prompt tokens are below the model-change threshold', async () => {
    // The caller (StreamTextExecutor) still uses `modelChanged: true` to force-advance the
    // reduce_before watermark for the lightweight on-the-fly reducers, independent of whether
    // full compaction was warranted.
    await service.compactOnModelChangeIfNeeded({
      conversationTitle: 'convo-1',
      model: 'anthropic:claude-sonnet-4',
    });
    mockRecordedInputTokens(BELOW_THRESHOLD);

    const result = await service.compactOnModelChangeIfNeeded({
      conversationTitle: 'convo-1',
      model: 'openai:gpt-4o',
    });

    expect(result).toEqual({ modelChanged: true });
    expect(mockPlugin.conversationRenderer.getMessagesForCompaction).not.toHaveBeenCalled();
  });

  it('runs compaction once when the model changed and prompt tokens reach the model-change threshold', async () => {
    await service.compactOnModelChangeIfNeeded({
      conversationTitle: 'convo-1',
      model: 'anthropic:claude-sonnet-4',
    });
    mockRecordedInputTokens(AT_THRESHOLD);

    await service.compactOnModelChangeIfNeeded({
      conversationTitle: 'convo-1',
      model: 'openai:gpt-4o',
    });

    expect(mockPlugin.conversationRenderer.getMessagesForCompaction).toHaveBeenCalledTimes(1);
    expect(mockPlugin.conversationRenderer.getMessagesForCompaction).toHaveBeenCalledWith(
      'convo-1'
    );
  });

  it('does not re-trigger on a repeat call with the same (new) model after compacting once', async () => {
    await service.compactOnModelChangeIfNeeded({
      conversationTitle: 'convo-1',
      model: 'anthropic:claude-sonnet-4',
    });
    mockRecordedInputTokens(AT_THRESHOLD);
    await service.compactOnModelChangeIfNeeded({
      conversationTitle: 'convo-1',
      model: 'openai:gpt-4o',
    });
    expect(mockPlugin.conversationRenderer.getMessagesForCompaction).toHaveBeenCalledTimes(1);

    await service.compactOnModelChangeIfNeeded({
      conversationTitle: 'convo-1',
      model: 'openai:gpt-4o',
    });

    expect(mockPlugin.conversationRenderer.getMessagesForCompaction).toHaveBeenCalledTimes(1);
  });
});

describe('runCompaction', () => {
  let runCompaction: (params: { conversationTitle: string; lang?: string | null }) => Promise<void>;
  let mockPlugin: jest.Mocked<StewardPlugin>;

  beforeEach(() => {
    mockPlugin = createMockPlugin();
    const service = new CompactionTokenService(mockPlugin);
    runCompaction = service['runCompaction'].bind(service);
  });

  it('gives widget_query a recall-hint placeholder instead of dropping it from the compacted summary', async () => {
    const widgetQueryToolCall = {
      type: 'tool-call' as const,
      toolName: ToolName.WIDGET_QUERY,
      toolCallId: 'call_widget_query',
      input: { query: 'get_board_state' },
    } satisfies ToolCallPart;
    const widgetQueryToolResult = {
      type: 'tool-result' as const,
      toolName: ToolName.WIDGET_QUERY,
      toolCallId: 'call_widget_query',
      output: { type: 'json', value: { board: Array.from({ length: 50 }, (_, i) => i) } },
    } satisfies ToolResultPart;

    (mockPlugin.conversationRenderer.getMessagesForCompaction as jest.Mock).mockResolvedValue([
      {
        type: 'tool',
        messageId: 'widget_msg_1',
        toolName: ToolName.WIDGET_QUERY,
        toolResult: widgetQueryToolResult,
        toolCall: widgetQueryToolCall,
      },
    ]);

    await runCompaction({ conversationTitle: 'convo-1' });

    const updateCalls = (mockPlugin.conversationRenderer.updateConversationNote as jest.Mock).mock
      .calls as Array<[{ command?: string; newContent: string }]>;
    const compactedCall = updateCalls.find(([args]) => args.command === 'compacted');

    expect(compactedCall).toBeDefined();
    expect(compactedCall![0].newContent).toContain(ToolName.WIDGET_QUERY);
    expect(compactedCall![0].newContent).toContain(ToolName.RECALL_COMPACTED_CONTEXT);
  });
});

describe('estimatePromptTokensRoughFromMessages', () => {
  it('returns 0 for empty', () => {
    expect(estimatePromptTokensRoughFromMessages([])).toBe(0);
  });

  it('ceil(JSON.stringify(messages).length / 4)', () => {
    expect(estimatePromptTokensRoughFromMessages([{ role: 'user', content: 'abcd' }])).toBe(
      Math.ceil(JSON.stringify([{ role: 'user', content: 'abcd' }]).length / 4)
    );
  });
});
