import { CompactionOrchestrator } from './CompactionOrchestrator';
import type StewardPlugin from 'src/main';
import type { ConversationMessage } from 'src/types/types';
import {
  COMPACTION_SCHEMA_VERSION,
  type CompactionData,
  type CompactedMessageEntry,
} from './types';
import { ConversationRenderer } from 'src/services/ConversationRenderer';

jest.mock('src/solutions/commands/agents/CompactionSummaryAgent', () => ({
  CompactionSummaryAgent: jest.fn().mockImplementation(() => ({
    summarizeMessagesBatch: jest.fn().mockResolvedValue([]),
  })),
}));

function createMinimalPluginForRenderer(): jest.Mocked<StewardPlugin> {
  return { app: {}, settings: {} } as unknown as jest.Mocked<StewardPlugin>;
}

function createMockPlugin(overrides?: {
  extractAllConversationMessages?: jest.Mock;
  deserializeToolInvocations?: jest.Mock;
  getConversationProperty?: jest.Mock;
  updateConversationFrontmatter?: jest.Mock;
}): jest.Mocked<StewardPlugin> {
  const minimalPlugin = createMinimalPluginForRenderer();
  const realRenderer = ConversationRenderer.getInstance(minimalPlugin);

  // Override only I/O methods; keep real implementation of groupMessagesByStep, extractToolNamesFromToolInvocation, etc.
  realRenderer.extractAllConversationMessages =
    overrides?.extractAllConversationMessages ?? jest.fn().mockResolvedValue([]);
  realRenderer.deserializeToolInvocations =
    overrides?.deserializeToolInvocations ?? jest.fn().mockResolvedValue(null);
  realRenderer.getConversationProperty =
    overrides?.getConversationProperty ?? jest.fn().mockResolvedValue(undefined);
  realRenderer.updateConversationFrontmatter =
    overrides?.updateConversationFrontmatter ?? jest.fn().mockResolvedValue(true);

  const mockPlugin = {
    ...minimalPlugin,
    app: {
      ...minimalPlugin.app,
      vault: {
        on: jest.fn().mockReturnValue({}), // EventRef for registerEvent
        cachedRead: jest.fn().mockResolvedValue(''),
      },
    },
    settings: {
      ...minimalPlugin.settings,
      stewardFolder: 'Steward',
    },
    conversationRenderer: realRenderer,
    registerEvent: jest.fn(),
  } as unknown as jest.Mocked<StewardPlugin>;

  return mockPlugin;
}

function createMessage(overrides: Partial<ConversationMessage> = {}): ConversationMessage {
  return {
    id: 'msg-1',
    role: 'user',
    content: 'Hello',
    intent: '',
    history: true,
    step: 1,
    handlerId: 'h1',
    ...overrides,
  };
}

function createEmptyCompactionData(): CompactionData {
  return {
    version: COMPACTION_SCHEMA_VERSION,
    messages: [],
  };
}

describe('CompactionOrchestrator', () => {
  let orchestrator: CompactionOrchestrator;
  let mockPlugin: jest.Mocked<StewardPlugin>;

  const CONVERSATION_TITLE = 'test-conversation';

  beforeEach(() => {
    jest.clearAllMocks();
    mockPlugin = createMockPlugin();
    orchestrator = new CompactionOrchestrator(mockPlugin);
  });

  describe('run', () => {
    it('returns data without systemMessage when config.enabled is false', async () => {
      const mockData = createEmptyCompactionData();
      mockPlugin.conversationRenderer.getConversationProperty = jest
        .fn()
        .mockResolvedValue(mockData);

      const result = await orchestrator.run({
        conversationTitle: CONVERSATION_TITLE,
        config: { enabled: false },
      });

      expect(result.systemMessage).toBeUndefined();
      expect(result.data).toEqual(mockData);
      expect(mockPlugin.conversationRenderer.extractAllConversationMessages).not.toHaveBeenCalled();
    });

    it('returns early when no out-of-window messages exist', async () => {
      const messages = Array.from({ length: 5 }, (_, i) =>
        createMessage({ id: `msg-${i}`, content: `Content ${i}` })
      );
      mockPlugin.conversationRenderer.extractAllConversationMessages = jest
        .fn()
        .mockResolvedValue(messages);
      mockPlugin.conversationRenderer.getConversationProperty = jest
        .fn()
        .mockResolvedValue(createEmptyCompactionData());

      const result = await orchestrator.run({
        conversationTitle: CONVERSATION_TITLE,
        visibleWindowSize: 10,
      });

      expect(result.systemMessage).toBeUndefined();
      expect(mockPlugin.conversationRenderer.updateConversationFrontmatter).not.toHaveBeenCalled();
    });

    it('returns early when out-of-window messages are below turn and token thresholds', async () => {
      const messages = Array.from({ length: 15 }, (_, i) =>
        createMessage({ id: `msg-${i}`, content: `Short.` })
      );
      mockPlugin.conversationRenderer.extractAllConversationMessages = jest
        .fn()
        .mockResolvedValue(messages);
      mockPlugin.conversationRenderer.getConversationProperty = jest
        .fn()
        .mockResolvedValue(createEmptyCompactionData());

      const result = await orchestrator.run({
        conversationTitle: CONVERSATION_TITLE,
        visibleWindowSize: 10,
        config: { turnThreshold: 20, tokenBudget: 50000 },
      });

      expect(result.systemMessage).toBeUndefined();
      expect(mockPlugin.conversationRenderer.updateConversationFrontmatter).not.toHaveBeenCalled();
    });

    it('returns systemMessage and data when compaction triggered but no pending messages', async () => {
      const messages = Array.from({ length: 25 }, (_, i) =>
        createMessage({ id: `msg-${i}`, content: `Message ${i}.` })
      );
      // lastCompactedMessageId must be the last message in out-of-window range
      // With 25 messages, last is user (popped): 24 in history. visibleWindowSize 10 → outOfWindow = msg-0..msg-13
      const existingData: CompactionData = {
        ...createEmptyCompactionData(),
        messages: [
          {
            type: 'message',
            messageId: 'msg-13',
            role: 'user',
            contentMode: 'original',
            content: 'Last compacted',
            wordCount: 2,
          } as CompactedMessageEntry,
        ],
        lastCompactedMessageId: 'msg-13',
      };

      mockPlugin.conversationRenderer.extractAllConversationMessages = jest
        .fn()
        .mockResolvedValue(messages);
      mockPlugin.conversationRenderer.getConversationProperty = jest
        .fn()
        .mockResolvedValue(existingData);

      const result = await orchestrator.run({
        conversationTitle: CONVERSATION_TITLE,
        visibleWindowSize: 10,
        config: { turnThreshold: 10 },
      });

      expect(result.systemMessage).toContain('COMPACTED CONVERSATION CONTEXT');
      expect(result.systemMessage).toContain('24 total');
      expect(result.systemMessage).toContain('Policy: The most recent 10 messages');
      expect(result.data).toEqual(existingData);
      expect(mockPlugin.conversationRenderer.updateConversationFrontmatter).not.toHaveBeenCalled();
    });

    it('compacts out-of-window messages when above thresholds with pending messages', async () => {
      const messages = Array.from({ length: 25 }, (_, i) =>
        createMessage({ id: `msg-${i}`, content: `Message ${i} content here.`, step: Math.floor(i / 2) })
      );
      mockPlugin.conversationRenderer.extractAllConversationMessages = jest
        .fn()
        .mockResolvedValue(messages);
      mockPlugin.conversationRenderer.getConversationProperty = jest
        .fn()
        .mockResolvedValue(createEmptyCompactionData());

      const result = await orchestrator.run({
        conversationTitle: CONVERSATION_TITLE,
        visibleWindowSize: 10,
        config: { turnThreshold: 10 },
      });

      expect(result.systemMessage).toBeDefined();
      expect(result.systemMessage).toContain('COMPACTED CONVERSATION CONTEXT');
      expect(result.data.messages.length).toBeGreaterThan(0);
      expect(mockPlugin.conversationRenderer.updateConversationFrontmatter).toHaveBeenCalled();
    });

    it('excludes messages with history: false from compaction input', async () => {
      const messages = Array.from({ length: 25 }, (_, i) =>
        createMessage({
          id: `msg-${i}`,
          content: `Message ${i}.`,
          history: i < 5 ? false : true,
        })
      );
      mockPlugin.conversationRenderer.extractAllConversationMessages = jest
        .fn()
        .mockResolvedValue(messages);
      mockPlugin.conversationRenderer.getConversationProperty = jest
        .fn()
        .mockResolvedValue(createEmptyCompactionData());

      const result = await orchestrator.run({
        conversationTitle: CONVERSATION_TITLE,
        visibleWindowSize: 10,
        config: { turnThreshold: 10 },
      });

      const messageIds = result.data.messages
        .filter(m => m.type === 'message')
        .map(m => m.messageId);
      expect(messageIds).not.toContain('msg-0');
      expect(messageIds).not.toContain('msg-4');
    });

    it('removes trailing user message from messages considered for history', async () => {
      const messages = Array.from({ length: 24 }, (_, i) =>
        createMessage({
          id: `msg-${i}`,
          content: `Message ${i}.`,
          role: i % 2 === 0 ? 'user' : 'assistant',
        })
      );
      messages.push(createMessage({ id: 'msg-24', content: 'Final user query', role: 'user' }));
      mockPlugin.conversationRenderer.extractAllConversationMessages = jest
        .fn()
        .mockResolvedValue(messages);
      mockPlugin.conversationRenderer.getConversationProperty = jest
        .fn()
        .mockResolvedValue(createEmptyCompactionData());

      const result = await orchestrator.run({
        conversationTitle: CONVERSATION_TITLE,
        visibleWindowSize: 10,
        config: { turnThreshold: 10 },
      });

      expect(result.data.messages.map(m => m.messageId)).not.toContain('msg-24');
    });

    it('compacts content_reading tool results via ReadContentCompactor', async () => {
      const toolContent = '```stw-artifact\n[{"toolName":"content_reading","toolCallId":"call-1","type":"tool-result","output":{}}]\n```';
      const userMsg = createMessage({ id: 'msg-u', content: 'Read this file', role: 'user' });
      const toolMsg = createMessage({
        id: 'msg-tool',
        content: toolContent,
        role: 'assistant',
        type: 'tool-invocation',
        step: 1,
        handlerId: 'h1',
      });
      // Tool message must be in out-of-window: with visibleWindowSize 10, need >15 msgs before window
      const messages = [
        ...Array.from({ length: 8 }, (_, i) =>
          createMessage({ id: `msg-${i}`, content: `Message ${i}.` })
        ),
        userMsg,
        toolMsg,
        ...Array.from({ length: 12 }, (_, i) =>
          createMessage({ id: `msg-after-${i}`, content: `After ${i}.`, role: 'assistant' })
        ),
      ];
      mockPlugin.conversationRenderer.extractAllConversationMessages = jest
        .fn()
        .mockResolvedValue(messages);
      mockPlugin.conversationRenderer.getConversationProperty = jest
        .fn()
        .mockResolvedValue(createEmptyCompactionData());
      mockPlugin.conversationRenderer.deserializeToolInvocations = jest.fn().mockResolvedValue([
        {
          type: 'tool-result',
          toolName: 'content_reading',
          toolCallId: 'call-1',
          output: {
            artifactType: 'read_content',
            readingResults: [
              {
                blocks: [],
                source: '',
                file: { path: 'Notes/MyFile.md', name: 'MyFile.md' },
              },
            ],
          },
        },
      ]);

      const result = await orchestrator.run({
        conversationTitle: CONVERSATION_TITLE,
        visibleWindowSize: 10,
        config: { turnThreshold: 5 },
      });

      const toolEntry = result.data.messages.find(
        m => m.type === 'tool' && m.toolName === 'content_reading'
      );
      expect(toolEntry).toBeDefined();
      expect(toolEntry).toMatchObject({
        type: 'tool',
        messageId: 'msg-tool',
        toolName: 'content_reading',
        metadata: { files: [{ path: 'Notes/MyFile.md', name: 'MyFile.md' }] },
      });
    });

    it('triggers compaction when token budget is exceeded', async () => {
      const longContent = 'word '.repeat(200);
      const messages = Array.from({ length: 15 }, (_, i) =>
        createMessage({ id: `msg-${i}`, content: i < 10 ? longContent : 'Short.' })
      );
      mockPlugin.conversationRenderer.extractAllConversationMessages = jest
        .fn()
        .mockResolvedValue(messages);
      mockPlugin.conversationRenderer.getConversationProperty = jest
        .fn()
        .mockResolvedValue(createEmptyCompactionData());

      const result = await orchestrator.run({
        conversationTitle: CONVERSATION_TITLE,
        visibleWindowSize: 10,
        config: { turnThreshold: 100, tokenBudget: 500 },
      });

      expect(result.systemMessage).toBeDefined();
      expect(result.data.messages.length).toBeGreaterThan(0);
    });

    it('skips assistant preamble immediately before tool-invocation', async () => {
      const messages = Array.from({ length: 25 }, (_, i) =>
        createMessage({
          id: `msg-${i}`,
          content: `Message ${i}.`,
          role: i % 2 === 0 ? 'user' : 'assistant',
          step: Math.floor(i / 2),
          handlerId: 'h1',
        })
      );
      messages[12] = createMessage({
        id: 'msg-preamble',
        content: "I'll read that file for you.",
        role: 'assistant',
        step: 6,
        handlerId: 'h1',
      });
      messages[13] = createMessage({
        id: 'msg-tool',
        content: '',
        role: 'assistant',
        type: 'tool-invocation',
        step: 6,
        handlerId: 'h1',
      });
      mockPlugin.conversationRenderer.extractAllConversationMessages = jest
        .fn()
        .mockResolvedValue(messages);
      mockPlugin.conversationRenderer.getConversationProperty = jest
        .fn()
        .mockResolvedValue(createEmptyCompactionData());
      mockPlugin.conversationRenderer.deserializeToolInvocations = jest.fn().mockResolvedValue([]);

      const result = await orchestrator.run({
        conversationTitle: CONVERSATION_TITLE,
        visibleWindowSize: 10,
        config: { turnThreshold: 10 },
      });

      const preambleEntry = result.data.messages.find(m => m.messageId === 'msg-preamble');
      expect(preambleEntry).toBeUndefined();
    });

    it('includes recall_compacted_context instruction in system message', async () => {
      const messages = Array.from({ length: 25 }, (_, i) =>
        createMessage({ id: `msg-${i}`, content: `Message ${i}.` })
      );
      mockPlugin.conversationRenderer.extractAllConversationMessages = jest
        .fn()
        .mockResolvedValue(messages);
      mockPlugin.conversationRenderer.getConversationProperty = jest
        .fn()
        .mockResolvedValue(createEmptyCompactionData());

      const result = await orchestrator.run({
        conversationTitle: CONVERSATION_TITLE,
        visibleWindowSize: 10,
        config: { turnThreshold: 10 },
      });

      expect(result.systemMessage).toContain('recall_compacted_context');
      expect(result.systemMessage).toContain('msg-');
    });

    it('excludes reasoning messages from compaction', async () => {
      const reasoningMsg = createMessage({
        id: 'msg-reasoning',
        content: 'Let me think through this step by step...',
        role: 'assistant',
        type: 'reasoning',
        step: 5,
        handlerId: 'h1',
      });
      const messages = [
        ...Array.from({ length: 8 }, (_, i) =>
          createMessage({ id: `msg-${i}`, content: `Message ${i}.` })
        ),
        reasoningMsg,
        ...Array.from({ length: 12 }, (_, i) =>
          createMessage({ id: `msg-after-${i}`, content: `After ${i}.`, role: 'assistant' })
        ),
      ];
      mockPlugin.conversationRenderer.extractAllConversationMessages = jest
        .fn()
        .mockResolvedValue(messages);
      mockPlugin.conversationRenderer.getConversationProperty = jest
        .fn()
        .mockResolvedValue(createEmptyCompactionData());

      const result = await orchestrator.run({
        conversationTitle: CONVERSATION_TITLE,
        visibleWindowSize: 10,
        config: { turnThreshold: 5 },
      });

      const reasoningEntry = result.data.messages.find(m => m.messageId === 'msg-reasoning');
      expect(reasoningEntry).toBeUndefined();
    });

    it('excludes uncompactable tool results (search, list) from compaction', async () => {
      const searchToolContent =
        '```stw-artifact\n[{"toolName":"search","toolCallId":"call-1","type":"tool-result","output":{}}]\n```';
      const listToolContent =
        '```stw-artifact\n[{"toolName":"list","toolCallId":"call-2","type":"tool-result","output":{}}]\n```';
      const userSearch = createMessage({ id: 'msg-u1', content: 'Search for notes', role: 'user' });
      const searchTool = createMessage({
        id: 'msg-search',
        content: searchToolContent,
        role: 'assistant',
        type: 'tool-invocation',
        step: 1,
        handlerId: 'h1',
      });
      const userList = createMessage({ id: 'msg-u2', content: 'List my files', role: 'user' });
      const listTool = createMessage({
        id: 'msg-list',
        content: listToolContent,
        role: 'assistant',
        type: 'tool-invocation',
        step: 2,
        handlerId: 'h1',
      });
      const messages = [
        ...Array.from({ length: 6 }, (_, i) =>
          createMessage({ id: `msg-${i}`, content: `Message ${i}.` })
        ),
        userSearch,
        searchTool,
        userList,
        listTool,
        ...Array.from({ length: 12 }, (_, i) =>
          createMessage({ id: `msg-after-${i}`, content: `After ${i}.`, role: 'assistant' })
        ),
      ];
      mockPlugin.conversationRenderer.extractAllConversationMessages = jest
        .fn()
        .mockResolvedValue(messages);
      mockPlugin.conversationRenderer.getConversationProperty = jest
        .fn()
        .mockResolvedValue(createEmptyCompactionData());
      mockPlugin.conversationRenderer.deserializeToolInvocations = jest.fn().mockResolvedValue([
        { type: 'tool-result', toolName: 'search', toolCallId: 'call-1', output: {} },
        { type: 'tool-result', toolName: 'list', toolCallId: 'call-2', output: {} },
      ]);

      const result = await orchestrator.run({
        conversationTitle: CONVERSATION_TITLE,
        visibleWindowSize: 10,
        config: { turnThreshold: 5 },
      });

      const searchEntry = result.data.messages.find(
        m => m.type === 'tool' && m.toolName === 'search'
      );
      const listEntry = result.data.messages.find(
        m => m.type === 'tool' && m.toolName === 'list'
      );
      expect(searchEntry).toBeUndefined();
      expect(listEntry).toBeUndefined();
    });

    it('when group contains procedural message and tool-invocation, takes tool-invocation only', async () => {
      const toolContent =
        '```stw-artifact\n[{"toolName":"content_reading","toolCallId":"call-1","type":"tool-result","output":{"artifactType":"read_content","readingResults":[{"file":{"path":"Notes/epsilon.md","name":"epsilon.md"}}]}}]\n```';
      const proceduralMsg = createMessage({
        id: '40yvw',
        content: "Now I'll read the epsilon note for you.",
        role: 'assistant',
        step: 6,
        handlerId: 'h1',
      });
      const toolInvocationMsg = createMessage({
        id: 'mt8hz',
        content: toolContent,
        role: 'assistant',
        type: 'tool-invocation',
        step: 6,
        handlerId: 'h1',
      });
      const messages = [
        ...Array.from({ length: 8 }, (_, i) =>
          createMessage({ id: `msg-${i}`, content: `Message ${i}.` })
        ),
        proceduralMsg,
        toolInvocationMsg,
        ...Array.from({ length: 12 }, (_, i) =>
          createMessage({ id: `msg-after-${i}`, content: `After ${i}.`, role: 'assistant' })
        ),
      ];
      mockPlugin.conversationRenderer.extractAllConversationMessages = jest
        .fn()
        .mockResolvedValue(messages);
      mockPlugin.conversationRenderer.getConversationProperty = jest
        .fn()
        .mockResolvedValue(createEmptyCompactionData());
      mockPlugin.conversationRenderer.deserializeToolInvocations = jest.fn().mockResolvedValue([
        {
          type: 'tool-result',
          toolName: 'content_reading',
          toolCallId: 'call-1',
          output: {
            artifactType: 'read_content',
            readingResults: [
              { blocks: [], source: '', file: { path: 'Notes/epsilon.md', name: 'epsilon.md' } },
            ],
          },
        },
      ]);

      const result = await orchestrator.run({
        conversationTitle: CONVERSATION_TITLE,
        visibleWindowSize: 10,
        config: { turnThreshold: 5 },
      });

      const proceduralEntry = result.data.messages.find(m => m.messageId === '40yvw');
      const toolEntry = result.data.messages.find(
        m => m.type === 'tool' && m.messageId === 'mt8hz'
      );
      expect(proceduralEntry).toBeUndefined();
      expect(toolEntry).toBeDefined();
      expect(toolEntry).toMatchObject({
        type: 'tool',
        messageId: 'mt8hz',
        toolName: 'content_reading',
      });
    });

    it('excludes groups with only invalid tool calls (AI_InvalidToolInputError) from compaction', async () => {
      const invalidToolContent =
        '```stw-artifact\n[{"toolName":"edit","toolCallId":"call-1","type":"tool-result","output":"AI_InvalidToolInputError: invalid input"}]\n```';
      const assistantPreamble = createMessage({
        id: 'msg-preamble',
        content: "I'll edit that file.",
        role: 'assistant',
        step: 6,
        handlerId: 'h1',
      });
      const invalidTool = createMessage({
        id: 'msg-invalid',
        content: invalidToolContent,
        role: 'assistant',
        type: 'tool-invocation',
        step: 6,
        handlerId: 'h1',
      });
      const messages = [
        ...Array.from({ length: 8 }, (_, i) =>
          createMessage({ id: `msg-${i}`, content: `Message ${i}.` })
        ),
        assistantPreamble,
        invalidTool,
        ...Array.from({ length: 12 }, (_, i) =>
          createMessage({ id: `msg-after-${i}`, content: `After ${i}.`, role: 'assistant' })
        ),
      ];
      mockPlugin.conversationRenderer.extractAllConversationMessages = jest
        .fn()
        .mockResolvedValue(messages);
      mockPlugin.conversationRenderer.getConversationProperty = jest
        .fn()
        .mockResolvedValue(createEmptyCompactionData());
      mockPlugin.conversationRenderer.deserializeToolInvocations = jest.fn().mockResolvedValue([]);

      const result = await orchestrator.run({
        conversationTitle: CONVERSATION_TITLE,
        visibleWindowSize: 10,
        config: { turnThreshold: 5 },
      });

      const invalidEntry = result.data.messages.find(m => m.messageId === 'msg-invalid');
      const preambleEntry = result.data.messages.find(m => m.messageId === 'msg-preamble');
      expect(invalidEntry).toBeUndefined();
      expect(preambleEntry).toBeUndefined();
    });
  });
});
