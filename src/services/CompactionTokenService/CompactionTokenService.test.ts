import type StewardPlugin from 'src/main';
import { ToolName } from 'src/solutions/commands/toolNames';
import type { CompactionData } from './types';
import {
  COMPACTION_PROMPT_THRESHOLD_PERCENT,
  CompactionTokenService,
  estimatePromptTokensRoughFromMessages,
} from './CompactionTokenService';
import { ShellCompactor } from './compactors/ShellCompactor';
import type { ToolCallPart } from 'src/solutions/commands/tools/types';

function createMockPlugin(): jest.Mocked<StewardPlugin> {
  return {
    llmService: {
      getModelContextLengthTokens: jest.fn().mockReturnValue(128_000),
    },
    conversationRenderer: {
      extractConversationHistory: jest.fn().mockResolvedValue([]),
      updateConversationNote: jest.fn(),
      updateMessageMetadata: jest.fn(),
      getMessagesForCompaction: jest.fn(),
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
    let buildCompactedMessage: (
      data: CompactionData,
      params: { compactIndex: number }
    ) => string;

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

describe('ShellCompactor', () => {
  it('stores argsLine from tool call input in metadata', () => {
    const shellToolCall = {
      type: 'tool-call' as const,
      toolName: ToolName.SHELL,
      toolCallId: 'call_shell',
      input: { argsLine: 'npm run build' },
    } satisfies ToolCallPart;

    const result = new ShellCompactor().compact({
      messageId: 'msg1',
      output: { type: 'text', value: 'messageRef:abc' },
      toolCall: shellToolCall,
    });

    expect(result.toolName).toBe(ToolName.SHELL);
    expect(result.metadata.argsLine).toBe('npm run build');
    expect(typeof result.metadata.output).toBe('string');
    expect(String(result.metadata.output)).toContain(ToolName.RECALL_COMPACTED_CONTEXT);
  });

  it('uses empty string when argsLine is missing', () => {
    const shellToolCall = {
      type: 'tool-call' as const,
      toolName: ToolName.SHELL,
      toolCallId: 'call_shell',
      input: {},
    } satisfies ToolCallPart;

    const result = new ShellCompactor().compact({
      messageId: 'msg1',
      output: { type: 'text', value: 'ok' },
      toolCall: shellToolCall,
    });

    expect(result.metadata.argsLine).toBe('');
    expect(String(result.metadata.output)).toContain(ToolName.RECALL_COMPACTED_CONTEXT);
  });
});

describe('estimatePromptTokensRoughFromMessages', () => {
  it('returns 0 for empty', () => {
    expect(estimatePromptTokensRoughFromMessages([])).toBe(0);
  });

  it('ceil(JSON.stringify(messages).length / 4)', () => {
    expect(
      estimatePromptTokensRoughFromMessages([{ role: 'user', content: 'abcd' }])
    ).toBe(Math.ceil(JSON.stringify([{ role: 'user', content: 'abcd' }]).length / 4));
  });
});
