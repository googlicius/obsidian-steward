import { SuperAgent } from './SuperAgent';
import type StewardPlugin from 'src/main';
import { type App } from 'obsidian';
import { streamText } from 'ai';
import { AgentHandlerParams, Intent, IntentResultStatus } from '../../types';
import { ToolName } from '../../ToolRegistry';
import { ArtifactType } from 'src/solutions/artifact';
import { VaultDelete } from '../handlers/VaultDelete';
import { RevertDelete } from '../handlers/RevertDelete';
import { ContentReadingResult } from 'src/services/ContentReadingService';
import { getClassifier } from 'src/lib/modelfusion';
import * as handlers from '../handlers';

// Mock individual functions from the ai package
jest.mock('ai', () => {
  const originalModule = jest.requireActual('ai');

  return {
    ...originalModule,
    streamText: jest.fn(),
    tool: jest.fn().mockImplementation(config => config),
  };
});

// Mock uniqueID
jest.mock('src/utils/uniqueID', () => ({
  uniqueID: jest.fn(() => 'mock-id-123'),
}));

// Mock getClassifier to avoid classification in tests
jest.mock('src/lib/modelfusion', () => ({
  getClassifier: jest.fn(),
}));

function createMockPlugin(): jest.Mocked<StewardPlugin> {
  const mockApp = {
    vault: {
      cachedRead: jest.fn().mockResolvedValue(''),
    },
  } as unknown as App;

  const mockRenderer = {
    addGeneratingIndicator: jest.fn(),
    addUserMessage: jest.fn().mockResolvedValue('user-message-id-123'),
    updateConversationNote: jest.fn().mockResolvedValue('message-id-123'),
    streamConversationNote: jest.fn().mockImplementation(async ({ stream }) => {
      // Consume the stream to ensure textDone resolves
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      for await (const _chunk of stream) {
        // Consume all chunks
      }
    }),
    serializeToolInvocation: jest.fn(),
    extractConversationHistory: jest.fn().mockResolvedValue([]),
    updateConversationFrontmatter: jest.fn(),
    getConversationProperty: jest.fn().mockResolvedValue(undefined),
  };

  const mockArtifactManager = {
    withTitle: jest.fn().mockReturnValue({
      storeArtifact: jest.fn().mockResolvedValue('artifact-id-123'),
      getMostRecentArtifactOfTypes: jest.fn(),
      getArtifactById: jest.fn(),
    }),
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
    contentReadingService: {
      readContent: jest.fn(),
    },
    userMessageService: {
      sanitizeQuery: jest.fn((query: string) => query),
    },
    conversationRenderer: mockRenderer,
    artifactManagerV2: mockArtifactManager,
  } as unknown as StewardPlugin;

  return mockPlugin as unknown as jest.Mocked<StewardPlugin>;
}

describe('SuperAgent', () => {
  let superAgent: SuperAgent;
  let mockPlugin: jest.Mocked<StewardPlugin>;
  let mockSaveEmbedding: jest.Mock;

  // Mock window for setTimeout
  beforeAll(() => {
    global.window = {
      setInterval: (fn: () => void, ms: number) => {
        return setInterval(fn, ms);
      },
      clearInterval: (id: NodeJS.Timeout) => {
        return clearInterval(id);
      },
      setTimeout: (fn: () => void, ms: number) => {
        return setTimeout(fn, ms);
      },
      clearTimeout: (id: NodeJS.Timeout) => {
        return clearTimeout(id);
      },
    } as unknown as Window & typeof globalThis;
  });

  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    mockPlugin = createMockPlugin();
    superAgent = new SuperAgent(mockPlugin);

    // Set up default classifier mock for all tests
    mockSaveEmbedding = jest.fn().mockResolvedValue(undefined);
    const mockDoClassify = jest.fn().mockResolvedValue(null);
    const mockClassifier = {
      saveEmbedding: mockSaveEmbedding,
      doClassify: mockDoClassify,
    };

    (getClassifier as jest.Mock).mockReturnValue(mockClassifier);

    // Set up default streamText mock with a generator that completes immediately
    // Note: streamText returns { fullStream, toolCalls }, not { textStream, toolCalls }
    (streamText as jest.Mock).mockReturnValue({
      fullStream: (async function* () {
        // Yield a text-delta chunk to signal text content
        yield { type: 'text-delta', textDelta: '' };
        // Generator completes after yielding, signaling end of stream
      })(),
      toolCalls: Promise.resolve([]),
    });
  });

  afterEach(() => {
    // Only run pending timers if fake timers are active
    try {
      jest.runOnlyPendingTimers();
    } catch {
      // Ignore if fake timers are not active
    }
    jest.useRealTimers();
  });

  describe('handle - messages and tool calls', () => {
    it('should include user message as the latest message only in the first iteration', async () => {
      const params: AgentHandlerParams = {
        title: 'test-conversation',
        intent: {
          type: 'vault',
          query: 'test query',
        } as Intent,
      };

      // Mock extractConversationHistory to return empty array for first call
      // and conversation history for subsequent calls
      mockPlugin.conversationRenderer.extractConversationHistory = jest
        .fn()
        .mockResolvedValueOnce([]) // First call - no history
        .mockResolvedValueOnce([
          // Second call - should have user message and assistant response from first iteration
          {
            role: 'user',
            content: [{ type: 'text', text: 'test query' }],
          },
          {
            role: 'assistant',
            content: '',
          },
        ]);

      // First iteration - no handlerId
      await superAgent.handle(params);

      expect(streamText).toHaveBeenCalledTimes(1);
      const firstCall = (streamText as jest.Mock).mock.calls[0][0];
      expect(firstCall.messages).toHaveLength(1);
      expect(firstCall.messages[0].role).toBe('user');

      // Second iteration - with invocationCount to indicate it's not the first iteration
      const paramsWithInvocationCount: AgentHandlerParams = {
        ...params,
        handlerId: 'existing-handler-id',
        invocationCount: 1,
      };
      await superAgent.handle(paramsWithInvocationCount);

      expect(streamText).toHaveBeenCalledTimes(2);
      const secondCall = (streamText as jest.Mock).mock.calls[1][0];

      // Should have conversation history (user + assistant) but NOT add new user message
      expect(secondCall.messages).toHaveLength(2);
      expect(secondCall.messages[0].role).toBe('user');
      expect(secondCall.messages[1].role).toBe('assistant');
    });

    it('should have only ACTIVATE tool active by default', async () => {
      const params: AgentHandlerParams = {
        title: 'test-conversation',
        intent: {
          type: 'vault',
          query: 'test query',
        } as Intent,
      };

      await superAgent.handle(params);

      expect(streamText).toHaveBeenCalledTimes(1);
      const call = (streamText as jest.Mock).mock.calls[0][0];
      const toolsObject = call.tools;

      // Check that only ACTIVATE tool is in the tools object (active)
      expect(toolsObject).toBeDefined();
      expect(Object.keys(toolsObject).length).toBe(1);
      expect(toolsObject[ToolName.ACTIVATE]).toBeDefined();
    });

    it('should create manual tool call for delete when DELETE tool is active and artifact exists', async () => {
      const artifactId = 'artifact-123';
      const mockArtifact = {
        id: artifactId,
        artifactType: ArtifactType.SEARCH_RESULTS,
        createdAt: Date.now(),
      };

      // Create a mock artifact manager that returns the artifact
      const mockGetMostRecentArtifactOfTypes = jest.fn().mockResolvedValue(mockArtifact);
      mockPlugin.artifactManagerV2.withTitle = jest.fn().mockReturnValue({
        getMostRecentArtifactOfTypes: mockGetMostRecentArtifactOfTypes,
        storeArtifact: jest.fn().mockResolvedValue('artifact-id-123'),
        getArtifactById: jest.fn(),
      });

      // Mock VaultDelete.handle to return success
      const mockVaultDeleteHandle = jest.fn().mockResolvedValue({
        status: IntentResultStatus.SUCCESS,
      });

      // Access the private _vaultDelete property and replace it with a mock
      const mockVaultDelete = {
        handle: mockVaultDeleteHandle,
      } as unknown as VaultDelete;

      // Use Object.defineProperty to set the private property
      Object.defineProperty(superAgent, '_vaultDelete', {
        value: mockVaultDelete,
        writable: true,
        configurable: true,
      });

      const params: AgentHandlerParams = {
        title: 'test-conversation',
        intent: {
          type: 'vault',
          query: 'delete files',
        } as Intent,
        activeTools: [ToolName.DELETE],
        // Set invocationCount to a truthy value to skip classifyTasksFromQuery
        // and use classifyTasksFromActiveTools directly
        invocationCount: 1,
      };

      // The manual tool call should bypass streamText
      await superAgent.handle(params);

      // Should not call streamText because manual tool call was created
      expect(streamText).not.toHaveBeenCalled();

      // Verify artifact manager was called to get the artifact
      expect(mockPlugin.artifactManagerV2.withTitle).toHaveBeenCalledWith('test-conversation');
      expect(mockGetMostRecentArtifactOfTypes).toHaveBeenCalledWith([
        ArtifactType.SEARCH_RESULTS,
        ArtifactType.CREATED_NOTES,
        ArtifactType.LIST_RESULTS,
      ]);
    });

    it('should not create manual tool call when multiple tools are active', async () => {
      const mockArtifact = {
        id: 'artifact-123',
        artifactType: ArtifactType.SEARCH_RESULTS,
        createdAt: Date.now(),
      };

      mockPlugin.artifactManagerV2.withTitle = jest.fn().mockReturnValue({
        getMostRecentArtifactOfTypes: jest.fn().mockResolvedValue(mockArtifact),
      });

      const params: AgentHandlerParams = {
        title: 'test-conversation',
        intent: {
          type: 'vault',
          query: 'delete files',
        } as Intent,
        activeTools: [ToolName.DELETE, ToolName.CREATE],
      };

      await superAgent.handle(params);

      // Should call streamText because manual tool call is not created when multiple tools are active
      expect(streamText).toHaveBeenCalledTimes(1);
    });

    it('should not create manual tool call when no artifact exists', async () => {
      mockPlugin.artifactManagerV2.withTitle = jest.fn().mockReturnValue({
        getMostRecentArtifactOfTypes: jest.fn().mockResolvedValue(undefined),
      });

      const params: AgentHandlerParams = {
        title: 'test-conversation',
        intent: {
          type: 'vault',
          query: 'delete files',
        } as Intent,
        activeTools: [ToolName.DELETE],
      };

      await superAgent.handle(params);

      // Should call streamText because no artifact exists
      expect(streamText).toHaveBeenCalledTimes(1);
    });
  });

  describe('handle - revert tasks', () => {
    it('should create manual tool call for simple revert with one-word query', async () => {
      const artifactId = 'artifact-123';
      const mockArtifact = {
        id: artifactId,
        artifactType: ArtifactType.DELETED_FILES,
        createdAt: Date.now(),
      };

      // Create a mock artifact manager that returns the artifact
      const mockGetMostRecentArtifactOfTypes = jest.fn().mockResolvedValue(mockArtifact);
      mockPlugin.artifactManagerV2.withTitle = jest.fn().mockReturnValue({
        getMostRecentArtifactOfTypes: mockGetMostRecentArtifactOfTypes,
        storeArtifact: jest.fn().mockResolvedValue('artifact-id-123'),
        getArtifactById: jest.fn(),
      });

      // Mock RevertDelete.handle to return success
      const mockRevertDeleteHandle = jest.fn().mockResolvedValue({
        status: IntentResultStatus.SUCCESS,
      });

      // Access the private _revertDelete property and replace it with a mock
      const mockRevertDelete = {
        handle: mockRevertDeleteHandle,
      } as unknown as RevertDelete;

      // Use Object.defineProperty to set the private property
      Object.defineProperty(superAgent, '_revertDelete', {
        value: mockRevertDelete,
        writable: true,
        configurable: true,
      });

      const params: AgentHandlerParams = {
        title: 'test-conversation',
        intent: {
          type: 'revert',
          query: 'undo',
        } as Intent,
        // Set activeTools with a revert tool to ensure classifyTasksFromActiveTools classifies as 'revert'
        activeTools: [ToolName.REVERT_DELETE],
        // Set invocationCount to ensure classifyTasksFromActiveTools is used
        invocationCount: 1,
      };

      // The manual tool call should bypass streamText
      await superAgent.handle(params);

      // Should not call streamText because manual tool call was created
      expect(streamText).not.toHaveBeenCalled();

      // Verify RevertDelete.handle was called with the correct manual tool call
      expect(mockRevertDeleteHandle).toHaveBeenCalledTimes(1);
      const revertCall = mockRevertDeleteHandle.mock.calls[0];
      expect(revertCall[1].toolCall.toolName).toBe(ToolName.REVERT_DELETE);
      expect(revertCall[1].toolCall.input.artifactId).toBe(artifactId);
    });

    it('should have GET_MOST_RECENT_ARTIFACT, GET_ARTIFACT_BY_ID, and ACTIVATE tools active by default for revert tasks', async () => {
      const params: AgentHandlerParams = {
        title: 'test-conversation',
        intent: {
          type: 'revert',
          query: 'revert something',
        } as Intent,
        // Set activeTools with a revert tool to ensure classifyTasksFromActiveTools classifies as 'revert'
        // This will activate the default tools: GET_MOST_RECENT_ARTIFACT, GET_ARTIFACT_BY_ID
        // Plus ACTIVATE tool, and the revert tool itself will also be active
        activeTools: [ToolName.REVERT_DELETE],
        invocationCount: 1,
      };

      await superAgent.handle(params);

      expect(streamText).toHaveBeenCalledTimes(1);
      const call = (streamText as jest.Mock).mock.calls[0][0];
      const toolsObject = call.tools;

      // When classifiedTasks includes 'revert', default tools are activated:
      // GET_MOST_RECENT_ARTIFACT, GET_ARTIFACT_BY_ID
      // Plus ACTIVATE tool
      // Plus the revert tool from activeTools (REVERT_DELETE)
      expect(toolsObject).toBeDefined();

      // Verify default tools are active
      expect(toolsObject[ToolName.GET_MOST_RECENT_ARTIFACT]).toBeDefined();
      expect(toolsObject[ToolName.GET_ARTIFACT_BY_ID]).toBeDefined();
      expect(toolsObject[ToolName.ACTIVATE]).toBeDefined();

      // The revert tool from activeTools is also active
      expect(toolsObject[ToolName.REVERT_DELETE]).toBeDefined();

      // Verify other revert tools are NOT active (they need to be activated via ACTIVATE tool)
      expect(toolsObject[ToolName.REVERT_MOVE]).toBeUndefined();
      expect(toolsObject[ToolName.REVERT_CREATE]).toBeUndefined();
      expect(toolsObject[ToolName.REVERT_FRONTMATTER]).toBeUndefined();
      expect(toolsObject[ToolName.REVERT_RENAME]).toBeUndefined();
    });

    it('should not create manual tool call for multi-word query', async () => {
      const mockArtifact = {
        id: 'artifact-123',
        artifactType: ArtifactType.DELETED_FILES,
        createdAt: Date.now(),
      };

      mockPlugin.artifactManagerV2.withTitle = jest.fn().mockReturnValue({
        getMostRecentArtifactOfTypes: jest.fn().mockResolvedValue(mockArtifact),
        storeArtifact: jest.fn().mockResolvedValue('artifact-id-123'),
        getArtifactById: jest.fn(),
      });

      const params: AgentHandlerParams = {
        title: 'test-conversation',
        intent: {
          type: 'revert',
          query: 'undo the last operation',
        } as Intent,
        // Set invocationCount to ensure classifyTasksFromActiveTools is used
        invocationCount: 1,
      };

      // Multi-word query should not create manual tool call
      await superAgent.handle(params);

      // Should call streamText because manual tool call is not created for multi-word queries
      expect(streamText).toHaveBeenCalledTimes(1);
    });
  });

  describe('handle - read tasks', () => {
    it('should return needs_confirmation when the confirmation tool is used', async () => {
      // Mock the content reading result
      const mockReadingResult: Partial<ContentReadingResult> = {
        blocks: [
          {
            content: 'Test paragraph content',
            startLine: 0,
            endLine: 1,
            sections: [{ type: 'paragraph', startLine: 0, endLine: 1 }],
          },
        ],
      };

      (mockPlugin.contentReadingService.readContent as jest.Mock).mockResolvedValue(
        mockReadingResult
      );

      // Mock streamText to return a CONFIRMATION tool call
      (streamText as jest.Mock).mockReturnValue({
        fullStream: (async function* () {
          // Yield a text-delta chunk to signal text content
          yield { type: 'text-delta', textDelta: '' };
          // Generator completes after yielding, signaling end of stream
        })(),
        toolCalls: Promise.resolve([
          {
            toolName: ToolName.CONFIRMATION,
            toolCallId: 'tool-call-1',
            input: {
              message: 'Do you confirm?',
            },
          },
        ]),
      });

      // Create agent params
      const params: AgentHandlerParams = {
        title: 'Test Conversation',
        intent: {
          type: 'read',
          query: 'Read entire note Test',
          model: 'mock-model',
        } as Intent,
        // Set invocationCount to ensure classifyTasksFromActiveTools is used
        invocationCount: 1,
      };

      // Act
      const handlePromise = superAgent.handle(params);
      const result = await handlePromise;

      // Assert
      expect(result).toMatchObject({
        status: IntentResultStatus.NEEDS_CONFIRMATION,
      });
    });
  });

  describe('handle - save classified tasks as embedding', () => {
    it('should NOT call saveEmbedding when conversationHistory is empty', async () => {
      const params: AgentHandlerParams = {
        title: 'test-conversation',
        intent: {
          type: 'vault',
          query: 'test query',
        } as Intent,
        activeTools: [ToolName.LIST],
      };

      // Use global mockSaveEmbedding from beforeEach

      // @ts-expect-error - Accessing private method for testing
      const mockExecuteStreamText = jest.spyOn(superAgent, 'executeStreamText') as jest.SpyInstance;

      mockExecuteStreamText.mockResolvedValue({
        toolCalls: [],
        conversationHistory: [],
      });

      await superAgent.handle(params);

      expect(mockSaveEmbedding).not.toHaveBeenCalled();
    });

    it('should call saveEmbedding with correct query and clusterName', async () => {
      const params: AgentHandlerParams = {
        title: 'test-conversation',
        intent: {
          type: 'vault',
          query: 'test query',
        } as Intent,
        activeTools: [ToolName.LIST],
      };

      // Use global mockSaveEmbedding from beforeEach

      // @ts-expect-error - Accessing private method for testing
      const mockExecuteStreamText = jest.spyOn(superAgent, 'executeStreamText') as jest.SpyInstance;

      mockExecuteStreamText.mockResolvedValue({
        toolCalls: [],
        conversationHistory: [
          {
            role: 'user',
            content: [{ type: 'text', text: 'test query' }],
          },
        ],
      });

      await superAgent.handle(params);

      // Wait for the promise to resolve since saveEmbedding is called without awaiting
      // With fake timers, we need to run all timers and flush promises
      await jest.runAllTimersAsync();

      expect(mockSaveEmbedding).toHaveBeenCalledTimes(1);
      expect(mockSaveEmbedding).toHaveBeenCalledWith('test query', 'vault');
    });

    it('should NOT saveEmbeddings when ignoreClassify is true', async () => {
      const params: AgentHandlerParams = {
        title: 'test-conversation',
        intent: {
          type: 'vault',
          query: 'test query',
        } as Intent,
        activeTools: [ToolName.LIST],
        upstreamOptions: {
          ignoreClassify: true,
        },
      };

      // @ts-expect-error - Accessing private method for testing
      const mockExecuteStreamText = jest.spyOn(superAgent, 'executeStreamText') as jest.SpyInstance;

      mockExecuteStreamText.mockResolvedValue({
        toolCalls: [],
        conversationHistory: [
          {
            role: 'user',
            content: [{ type: 'text', text: 'test query' }],
          },
        ],
      });

      await superAgent.handle(params);

      // Wait for any pending promises
      await jest.runAllTimersAsync();

      expect(mockSaveEmbedding).not.toHaveBeenCalled();
    });

    it('should NOT saveEmbeddings when the settings.embedding.enabled is false', async () => {
      // Set embedding.enabled to false
      mockPlugin.settings.embedding.enabled = false;

      const params: AgentHandlerParams = {
        title: 'test-conversation',
        intent: {
          type: 'vault',
          query: 'test query',
        } as Intent,
        activeTools: [ToolName.LIST],
      };

      // @ts-expect-error - Accessing private method for testing
      const mockExecuteStreamText = jest.spyOn(superAgent, 'executeStreamText') as jest.SpyInstance;

      mockExecuteStreamText.mockResolvedValue({
        toolCalls: [],
        conversationHistory: [
          {
            role: 'user',
            content: [{ type: 'text', text: 'test query' }],
          },
        ],
      });

      await superAgent.handle(params);

      // Wait for any pending promises
      await jest.runAllTimersAsync();

      expect(mockSaveEmbedding).not.toHaveBeenCalled();

      // Reset for other tests
      mockPlugin.settings.embedding.enabled = true;
    });

    it('should NOT saveEmbeddings when classifiedTasks is empty', async () => {
      const params: AgentHandlerParams = {
        title: 'test-conversation',
        intent: {
          type: ' ',
          query: 'test query',
        } as Intent,
        // No activeTools - this will result in empty classifiedTasks from classifyTasksFromActiveTools
        activeTools: [],
      };

      // Mock getClassifier to return a classifier that returns empty classifiedTasks
      const mockDoClassify = jest.fn().mockResolvedValue(null); // No classification
      const mockClassifier = {
        saveEmbedding: mockSaveEmbedding,
        doClassify: mockDoClassify,
      };

      (getClassifier as jest.Mock).mockReturnValue(mockClassifier);

      // @ts-expect-error - Accessing private method for testing
      const mockExecuteStreamText = jest.spyOn(superAgent, 'executeStreamText') as jest.SpyInstance;

      mockExecuteStreamText.mockResolvedValue({
        toolCalls: [],
        conversationHistory: [
          {
            role: 'user',
            content: [{ type: 'text', text: 'test query' }],
          },
        ],
      });

      await superAgent.handle(params);

      // Wait for any pending promises
      await jest.runAllTimersAsync();

      // Should not save embedding because classifiedTasks is empty
      expect(mockSaveEmbedding).not.toHaveBeenCalled();
    });

    it('should NOT saveEmbeddings when there are more than one user query in the conversation history', async () => {
      const params: AgentHandlerParams = {
        title: 'test-conversation',
        intent: {
          type: 'vault',
          query: 'test query',
        } as Intent,
        activeTools: [ToolName.LIST],
      };

      // @ts-expect-error - Accessing private method for testing
      const mockExecuteStreamText = jest.spyOn(superAgent, 'executeStreamText') as jest.SpyInstance;

      // Mock conversation history with more than one user message
      mockExecuteStreamText.mockResolvedValue({
        toolCalls: [],
        conversationHistory: [
          {
            role: 'user',
            content: [{ type: 'text', text: 'first query' }],
          },
          {
            role: 'assistant',
            content: '',
          },
          {
            role: 'user',
            content: [{ type: 'text', text: 'test query' }],
          },
        ],
      });

      await superAgent.handle(params);

      // Wait for any pending promises
      await jest.runAllTimersAsync();

      // Should not save embedding because there are multiple user messages
      expect(mockSaveEmbedding).not.toHaveBeenCalled();
    });
  });

  describe('handle - continue or stop processing', () => {
    it('should stop processing when classifiedTasks contains a single task from SINGLE_TURN_TASKS', async () => {
      const toolName = ToolName.SEARCH;
      const mockHandler = 'search';

      const params: AgentHandlerParams = {
        title: 'test-conversation',
        intent: {
          type: 'search',
          query: 'test query',
        } as Intent,
        activeTools: [toolName],
        invocationCount: 1, // Use classifyTasksFromActiveTools
      };

      // Mock executeStreamText to return toolCalls
      // @ts-expect-error - Accessing private method for testing
      const mockExecuteStreamText = jest.spyOn(superAgent, 'executeStreamText') as jest.SpyInstance;

      mockExecuteStreamText.mockResolvedValue({
        toolCalls: [
          {
            toolName,
            toolCallId: 'tool-call-1',
            input: {},
          },
        ],
        conversationHistory: [],
      });

      // Mock the handler to return SUCCESS
      const mockHandlerHandle = jest.fn().mockResolvedValue({
        status: IntentResultStatus.SUCCESS,
      });

      const mockHandlerInstance = {
        handle: mockHandlerHandle,
        // Mock extractSearchQueryWithoutLLM for search handler
        extractSearchQueryWithoutLLM: jest.fn().mockReturnValue(null),
      };

      // Set the appropriate handler property
      Object.defineProperty(superAgent, `_${mockHandler}`, {
        value: mockHandlerInstance,
        writable: true,
        configurable: true,
      });

      // Mock renderIndicator to verify it's NOT called (since we stop processing)
      const renderIndicatorSpy = jest.spyOn(superAgent, 'renderIndicator');

      // Spy on handle to verify it's not called recursively
      const handleSpy = jest.spyOn(superAgent, 'handle');

      await superAgent.handle(params, { remainingSteps: 5 });

      // Verify executeStreamText was called once
      expect(mockExecuteStreamText).toHaveBeenCalledTimes(1);

      // Verify the handler was called
      expect(mockHandlerHandle).toHaveBeenCalledTimes(1);

      // Verify renderIndicator was NOT called (since stopProcessingForClassifiedTask returns true)
      expect(renderIndicatorSpy).not.toHaveBeenCalled();

      // Verify handle was NOT called recursively (should only be called once - the initial call)
      // Since stopProcessingForClassifiedTask returns true, the recursive call at line 840 should not happen
      expect(handleSpy).toHaveBeenCalledTimes(1);
    });

    it('should continue processing when classifiedTasks contains multiple tasks', async () => {
      const params: AgentHandlerParams = {
        title: 'test-conversation',
        intent: {
          type: 'vault',
          query: 'test query',
        } as Intent,
        activeTools: [ToolName.LIST, ToolName.SEARCH], // Multiple tools = multiple tasks
        invocationCount: 1,
      };

      // @ts-expect-error - Accessing private method for testing
      const mockExecuteStreamText = jest.spyOn(superAgent, 'executeStreamText') as jest.SpyInstance;

      mockExecuteStreamText.mockResolvedValue({
        toolCalls: [
          {
            toolName: ToolName.LIST,
            toolCallId: 'tool-call-1',
            input: {},
          },
        ],
        conversationHistory: [],
      });

      // Mock vaultList handler
      const mockVaultListHandle = jest.fn().mockResolvedValue({
        status: IntentResultStatus.SUCCESS,
      });

      const mockVaultList = {
        handle: mockVaultListHandle,
      };

      Object.defineProperty(superAgent, '_vaultList', {
        value: mockVaultList,
        writable: true,
        configurable: true,
      });

      // Spy on handle to verify it IS called recursively
      const handleSpy = jest.spyOn(superAgent, 'handle');

      // Mock renderIndicator to verify it IS called (since we continue processing)
      const renderIndicatorSpy = jest.spyOn(superAgent, 'renderIndicator');

      await superAgent.handle(params, { remainingSteps: 5 });

      // Verify handle was called recursively (more than once)
      // Since stopProcessingForClassifiedTask returns false for multiple tasks, recursive call should happen
      expect(handleSpy.mock.calls.length).toBeGreaterThan(1);

      // Verify renderIndicator was called (since we continue processing)
      expect(renderIndicatorSpy).toHaveBeenCalled();
    });

    it('should continue processing when classifiedTasks is a single turn tasks but the current tool calls not belong to the task', async () => {
      const params: AgentHandlerParams = {
        title: 'test-conversation',
        intent: {
          type: ' ',
          query: 'test query',
        } as Intent,
        activeTools: [ToolName.SEARCH, ToolName.LIST], // Both search and list tools
        invocationCount: 1, // Use classifyTasksFromActiveTools
      };

      // Mock executeStreamText to return toolCalls with both SEARCH and LIST
      // @ts-expect-error - Accessing private method for testing
      const mockExecuteStreamText = jest.spyOn(superAgent, 'executeStreamText') as jest.SpyInstance;

      mockExecuteStreamText.mockResolvedValue({
        toolCalls: [
          {
            toolName: ToolName.SEARCH,
            toolCallId: 'tool-call-1',
            input: {},
          },
          {
            toolName: ToolName.LIST,
            toolCallId: 'tool-call-2',
            input: {},
          },
        ],
        conversationHistory: [],
      });

      // Mock search handler
      const mockSearchHandle = jest.fn().mockResolvedValue({
        status: IntentResultStatus.SUCCESS,
      });

      const mockSearchInstance = {
        handle: mockSearchHandle,
        extractSearchQueryWithoutLLM: jest.fn().mockReturnValue(null),
      };

      Object.defineProperty(superAgent, '_search', {
        value: mockSearchInstance,
        writable: true,
        configurable: true,
      });

      // Mock vaultList handler
      const mockVaultListHandle = jest.fn().mockResolvedValue({
        status: IntentResultStatus.SUCCESS,
      });

      const mockVaultList = {
        handle: mockVaultListHandle,
      };

      Object.defineProperty(superAgent, '_vaultList', {
        value: mockVaultList,
        writable: true,
        configurable: true,
      });

      // Spy on handle to verify it IS called recursively (processing continues)
      const handleSpy = jest.spyOn(superAgent, 'handle');

      // Mock renderIndicator to verify it IS called (since we continue processing)
      const renderIndicatorSpy = jest.spyOn(superAgent, 'renderIndicator');

      await superAgent.handle(params, { remainingSteps: 5 });

      // Verify executeStreamText was called
      expect(mockExecuteStreamText).toHaveBeenCalled();

      // Verify both handlers were called
      expect(mockSearchHandle).toHaveBeenCalled();
      expect(mockVaultListHandle).toHaveBeenCalled();

      // Verify handle was called recursively (more than once)
      // Since LIST doesn't belong to 'search' task, stopProcessingForClassifiedTask should return false
      // and processing should continue
      expect(handleSpy.mock.calls.length).toBeGreaterThan(1);

      // Verify renderIndicator was called (since we continue processing)
      expect(renderIndicatorSpy).toHaveBeenCalled();
    });

    it('should continue processing when classifiedTasks contains a task NOT in SINGLE_TURN_TASKS', async () => {
      const params: AgentHandlerParams = {
        title: 'test-conversation',
        intent: {
          type: 'vault',
          query: 'test query',
        } as Intent,
        activeTools: [ToolName.LIST], // vault task, not in SINGLE_TURN_TASKS
        invocationCount: 1,
      };

      // @ts-expect-error - Accessing private method for testing
      const mockExecuteStreamText = jest.spyOn(superAgent, 'executeStreamText') as jest.SpyInstance;

      mockExecuteStreamText.mockResolvedValue({
        toolCalls: [
          {
            toolName: ToolName.LIST,
            toolCallId: 'tool-call-1',
            input: {},
          },
        ],
        conversationHistory: [],
      });

      // Mock vaultList handler
      const mockVaultListHandle = jest.fn().mockResolvedValue({
        status: IntentResultStatus.SUCCESS,
      });

      const mockVaultList = {
        handle: mockVaultListHandle,
      };

      Object.defineProperty(superAgent, '_vaultList', {
        value: mockVaultList,
        writable: true,
        configurable: true,
      });

      // Spy on handle to verify it IS called recursively
      const handleSpy = jest.spyOn(superAgent, 'handle');

      // Mock renderIndicator to verify it IS called (since we continue processing)
      const renderIndicatorSpy = jest.spyOn(superAgent, 'renderIndicator');

      await superAgent.handle(params, { remainingSteps: 5 });

      // Verify handle was called recursively (more than once)
      // Since 'vault' is not in SINGLE_TURN_TASKS, stopProcessingForClassifiedTask returns false
      expect(handleSpy.mock.calls.length).toBeGreaterThan(1);

      // Verify renderIndicator was called (since we continue processing)
      expect(renderIndicatorSpy).toHaveBeenCalled();
    });

    it('should continue processing when there are no tool calls but hasTodoIncomplete is true', async () => {
      const params: AgentHandlerParams = {
        title: 'test-conversation',
        intent: {
          type: 'vault',
          query: 'test query',
        } as Intent,
        activeTools: [ToolName.LIST],
        invocationCount: 1,
      };

      // @ts-expect-error - Accessing private method for testing
      const mockExecuteStreamText = jest.spyOn(superAgent, 'executeStreamText') as jest.SpyInstance;

      // Mock executeStreamText to return NO tool calls (empty array)
      mockExecuteStreamText.mockResolvedValue({
        toolCalls: [],
        conversationHistory: [],
      });

      // Mock getConversationProperty to return a todo list with incomplete steps
      const mockTodoListState: handlers.TodoListState = {
        steps: [
          {
            task: 'Step 1',
            status: 'completed',
          },
          {
            task: 'Step 2',
            status: 'in_progress', // Incomplete step
          },
          {
            task: 'Step 3',
            // No status means pending/incomplete
          },
        ],
        currentStep: 2,
        createdBy: 'ai',
      };

      mockPlugin.conversationRenderer.getConversationProperty = jest
        .fn()
        .mockImplementation(async (title: string, property: string) => {
          if (property === 'todo_list') {
            return mockTodoListState;
          }
          return undefined;
        });

      // Spy on handle to verify it IS called recursively
      const handleSpy = jest.spyOn(superAgent, 'handle');

      // Mock renderIndicator to verify it IS called (since we continue processing)
      const renderIndicatorSpy = jest.spyOn(superAgent, 'renderIndicator');

      await superAgent.handle(params, { remainingSteps: 5 });

      // Verify executeStreamText was called
      expect(mockExecuteStreamText).toHaveBeenCalled();

      // Verify getConversationProperty was called to check todo list
      expect(mockPlugin.conversationRenderer.getConversationProperty).toHaveBeenCalledWith(
        params.title,
        'todo_list'
      );

      // Verify handle was called recursively (more than once)
      // Since hasTodoIncomplete is true, processing should continue
      expect(handleSpy.mock.calls.length).toBeGreaterThan(1);

      // Verify renderIndicator was called (since we continue processing)
      expect(renderIndicatorSpy).toHaveBeenCalled();
    });
  });

  describe('handle - max step count', () => {
    it('should return NEEDS_CONFIRMATION when remainingSteps reaches 0', async () => {
      const params: AgentHandlerParams = {
        title: 'test-conversation',
        intent: {
          type: 'vault',
          query: 'test query',
        } as Intent,
        activeTools: [ToolName.LIST],
      };

      // @ts-expect-error - Accessing private method for testing
      const mockExecuteStreamText = jest.spyOn(superAgent, 'executeStreamText') as jest.SpyInstance;

      // Mock executeStreamText to return toolCalls
      mockExecuteStreamText.mockResolvedValue({
        toolCalls: [
          {
            toolName: ToolName.LIST,
            toolCallId: 'tool-call-1',
            input: {},
          },
        ],
        conversationHistory: [],
      });

      // Mock vaultList handler
      const mockVaultListHandle = jest.fn().mockResolvedValue({
        status: IntentResultStatus.SUCCESS,
      });

      const mockVaultList = {
        handle: mockVaultListHandle,
      };

      Object.defineProperty(superAgent, '_vaultList', {
        value: mockVaultList,
        writable: true,
        configurable: true,
      });

      // Start with remainingSteps = 1, so after processing, nextRemainingSteps = 0
      const result = await superAgent.handle(params, { remainingSteps: 1 });

      // Verify the result has NEEDS_CONFIRMATION status
      expect(result.status).toBe(IntentResultStatus.NEEDS_CONFIRMATION);

      // Type narrowing for ConfirmationResult
      if (result.status === IntentResultStatus.NEEDS_CONFIRMATION) {
        expect(result.confirmationMessage).toBeDefined();
        expect(result.onConfirmation).toBeDefined();
        expect(result.onRejection).toBeDefined();
      }

      // Verify updateConversationNote was called with the confirmation message
      expect(mockPlugin.conversationRenderer.updateConversationNote).toHaveBeenCalledWith(
        expect.objectContaining({
          path: params.title,
          newContent: expect.any(String),
          lang: params.lang,
          handlerId: expect.any(String),
          includeHistory: false,
        })
      );
    });

    it('should call handle with MAX_STEP_COUNT when onConfirmation is called', async () => {
      const params: AgentHandlerParams = {
        title: 'test-conversation',
        intent: {
          type: 'vault',
          query: 'test query',
        } as Intent,
        activeTools: [ToolName.LIST],
      };

      // @ts-expect-error - Accessing private method for testing
      const mockExecuteStreamText = jest.spyOn(superAgent, 'executeStreamText') as jest.SpyInstance;

      // First call: remainingSteps = 1, will return NEEDS_CONFIRMATION
      mockExecuteStreamText.mockResolvedValueOnce({
        toolCalls: [
          {
            toolName: ToolName.LIST,
            toolCallId: 'tool-call-1',
            input: {},
          },
        ],
        conversationHistory: [],
      });

      // Mock vaultList handler
      const mockVaultListHandle = jest.fn().mockResolvedValue({
        status: IntentResultStatus.SUCCESS,
      });

      const mockVaultList = {
        handle: mockVaultListHandle,
      };

      Object.defineProperty(superAgent, '_vaultList', {
        value: mockVaultList,
        writable: true,
        configurable: true,
      });

      // Spy on handle to verify it's called with MAX_STEP_COUNT
      const handleSpy = jest.spyOn(superAgent, 'handle');

      // Second call: when onConfirmation is called, should use MAX_STEP_COUNT (20)
      mockExecuteStreamText.mockResolvedValueOnce({
        toolCalls: [],
        conversationHistory: [],
      });

      // Start with remainingSteps = 1 to trigger NEEDS_CONFIRMATION
      const result = await superAgent.handle(params, { remainingSteps: 1 });

      // Verify we got NEEDS_CONFIRMATION
      expect(result.status).toBe(IntentResultStatus.NEEDS_CONFIRMATION);

      // Type narrowing for ConfirmationResult
      if (result.status === IntentResultStatus.NEEDS_CONFIRMATION) {
        expect(result.onConfirmation).toBeDefined();

        // Call onConfirmation
        await result.onConfirmation('confirmed');
      }

      // Verify handle was called again with remainingSteps = 20 (MAX_STEP_COUNT)
      expect(handleSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          title: params.title,
          intent: params.intent,
          activeTools: params.activeTools,
          invocationCount: 1, // Should be incremented
        }),
        expect.objectContaining({
          remainingSteps: 20, // MAX_STEP_COUNT
        })
      );
    });
  });

  describe('handle - system prompt and fallbacks', () => {
    it('should include system prompt from provider at the first message', async () => {
      const params: AgentHandlerParams = {
        title: 'test-conversation',
        intent: {
          type: 'vault',
          query: 'test query',
        } as Intent,
      };

      const providerSystemPrompt = 'This is a custom system prompt from the provider';

      // Mock getLLMConfig to return a systemPrompt
      mockPlugin.llmService.getLLMConfig = jest.fn().mockResolvedValue({
        model: 'mock-model',
        temperature: 0.2,
        maxOutputTokens: 2048,
        systemPrompt: providerSystemPrompt,
      });

      // Mock extractConversationHistory to return empty array (first iteration)
      mockPlugin.conversationRenderer.extractConversationHistory = jest.fn().mockResolvedValue([]);

      await superAgent.handle(params);

      // Verify addUserMessage was called for the first iteration
      expect(mockPlugin.conversationRenderer.addUserMessage).toHaveBeenCalledTimes(1);
      expect(mockPlugin.conversationRenderer.addUserMessage).toHaveBeenCalledWith({
        path: 'test-conversation',
        newContent: 'test query',
        step: undefined,
        contentFormat: 'hidden',
      });

      // Verify streamText was called
      expect(streamText).toHaveBeenCalledTimes(1);
      const call = (streamText as jest.Mock).mock.calls[0][0];

      // Verify messages array includes system message with provider system prompt
      expect(call.messages).toBeDefined();
      expect(call.messages.length).toBeGreaterThan(0);
      expect(call.messages[0].role).toBe('system');
      expect(call.messages[0].content).toBe(providerSystemPrompt);

      // Verify user message is also included (should be the second message)
      expect(call.messages[1].role).toBe('user');
      expect(call.messages[1].content).toBe('test query');
    });

    it('should still include the user message at the first message after fallback happens in the first iteration', async () => {
      const params: AgentHandlerParams = {
        title: 'test-conversation',
        intent: {
          type: 'vault',
          query: 'test query',
          model: 'original-model',
        } as Intent,
      };

      // Mock modelFallbackService to be enabled and return a fallback model
      const mockModelFallbackService = {
        isEnabled: jest.fn().mockReturnValue(true),
        switchToNextModel: jest.fn().mockResolvedValue('fallback-model'),
        getCurrentModel: jest.fn().mockResolvedValue(undefined),
      };
      Object.defineProperty(mockPlugin, 'modelFallbackService', {
        get: () => mockModelFallbackService,
        configurable: true,
      });

      // Mock getLLMConfig to return config
      mockPlugin.llmService.getLLMConfig = jest.fn().mockResolvedValue({
        model: 'mock-model',
        temperature: 0.2,
        maxOutputTokens: 2048,
      });

      // Mock extractConversationHistory to return empty array (first iteration, no history yet)
      // IMPORTANT: Return a NEW array each time to avoid mutation issues
      mockPlugin.conversationRenderer.extractConversationHistory = jest
        .fn()
        .mockImplementation(() => Promise.resolve([]));

      // Make toolCalls promise reject on first call to trigger fallback
      // Use mockImplementation to trigger onError callback, which is how errors are actually handled
      let callCount = 0;
      (streamText as jest.Mock).mockImplementation(config => {
        callCount++;
        if (callCount === 1) {
          // First call: trigger onError callback to simulate an error
          // This is how errors are actually handled in the real code
          // Use Promise.resolve().then() to defer to next microtask (works with fake timers)
          Promise.resolve().then(() => {
            if (config.onError) {
              config.onError({ error: new Error('Model error') });
            }
          });
          return {
            fullStream: (async function* () {
              yield { type: 'text-delta', textDelta: '' };
            })(),
            toolCalls: new Promise(() => {
              // Never resolves - will be rejected via streamErrorPromise when onError is called
            }),
          };
        } else {
          // Second call (after fallback): succeed
          return {
            fullStream: (async function* () {
              yield { type: 'text-delta', textDelta: '' };
            })(),
            toolCalls: Promise.resolve([]),
          };
        }
      });

      // Call safeHandle (which will handle the fallback)
      await superAgent.safeHandle(params);

      // Verify modelFallbackService was called
      expect(mockModelFallbackService.isEnabled).toHaveBeenCalled();
      expect(mockModelFallbackService.switchToNextModel).toHaveBeenCalledWith('test-conversation');

      // Verify streamText was called twice (first fails, second succeeds after fallback)
      expect(streamText).toHaveBeenCalledTimes(2);

      // Verify the first call included the user message (invocationCount is undefined/falsy)
      const firstCall = (streamText as jest.Mock).mock.calls[0][0];
      expect(firstCall.messages).toBeDefined();
      expect(firstCall.messages.length).toBeGreaterThan(0);
      // The user message should be included in the first call
      const firstCallUserMessage = firstCall.messages.find(
        (m: { role: string }) => m.role === 'user'
      );
      expect(firstCallUserMessage).toBeDefined();
      expect(firstCallUserMessage.content).toBe('test query');

      // Verify the second call (after fallback) - since history is still empty, user message should still be included
      expect(mockPlugin.conversationRenderer.extractConversationHistory).toHaveBeenCalledTimes(2);

      // Verify that the second call to streamText includes the user message
      // Even though invocationCount is 1, since the history is empty, the user message should still be included
      const secondCall = (streamText as jest.Mock).mock.calls[1][0];
      expect(secondCall.messages).toBeDefined();
      expect(Array.isArray(secondCall.messages)).toBe(true);

      // The user message should still be included in the second call because history is empty
      const secondCallUserMessage = secondCall.messages.find(
        (m: { role: string }) => m.role === 'user'
      );
      expect(secondCallUserMessage).toBeDefined();
      expect(secondCallUserMessage.content).toBe('test query');
    });

    it('should NOT append then user message again after fallback happens in the next iterations', async () => {
      const params: AgentHandlerParams = {
        title: 'test-conversation',
        intent: {
          type: 'vault',
          query: 'test query',
          model: 'original-model',
        } as Intent,
        invocationCount: 1, // Start with invocationCount > 0 to simulate a subsequent iteration
      };

      // Mock modelFallbackService to be enabled and return a fallback model
      const mockModelFallbackService = {
        isEnabled: jest.fn().mockReturnValue(true),
        switchToNextModel: jest.fn().mockResolvedValue('fallback-model'),
        getCurrentModel: jest.fn().mockResolvedValue(undefined),
      };
      Object.defineProperty(mockPlugin, 'modelFallbackService', {
        get: () => mockModelFallbackService,
        configurable: true,
      });

      // Mock getLLMConfig to return config
      mockPlugin.llmService.getLLMConfig = jest.fn().mockResolvedValue({
        model: 'mock-model',
        temperature: 0.2,
        maxOutputTokens: 2048,
      });

      // Mock extractConversationHistory to return history with user message
      // This simulates that we're in a subsequent iteration where history already exists
      const historyMessages = [
        { role: 'user', content: 'previous query' },
        { role: 'assistant', content: 'previous response' },
      ];
      mockPlugin.conversationRenderer.extractConversationHistory = jest
        .fn()
        .mockResolvedValue(historyMessages);

      // Reset addUserMessage mock to track calls
      mockPlugin.conversationRenderer.addUserMessage = jest
        .fn()
        .mockResolvedValue('user-message-id-123');

      // Make toolCalls promise reject on first call to trigger fallback
      let callCount = 0;
      (streamText as jest.Mock).mockImplementation(config => {
        callCount++;
        if (callCount === 1) {
          // First call: trigger onError callback to simulate an error
          Promise.resolve().then(() => {
            if (config.onError) {
              config.onError({ error: new Error('Model error') });
            }
          });
          return {
            fullStream: (async function* () {
              yield { type: 'text-delta', textDelta: '' };
            })(),
            toolCalls: new Promise(() => {
              // Never resolves - will be rejected via streamErrorPromise when onError is called
            }),
          };
        } else {
          // Second call (after fallback): succeed
          return {
            fullStream: (async function* () {
              yield { type: 'text-delta', textDelta: '' };
            })(),
            toolCalls: Promise.resolve([]),
          };
        }
      });

      // Call safeHandle (which will handle the fallback)
      await superAgent.safeHandle(params);

      // Verify modelFallbackService was called
      expect(mockModelFallbackService.isEnabled).toHaveBeenCalled();
      expect(mockModelFallbackService.switchToNextModel).toHaveBeenCalledWith('test-conversation');

      // Verify streamText was called twice (first fails, second succeeds after fallback)
      expect(streamText).toHaveBeenCalledTimes(2);

      // Verify addUserMessage was NOT called because invocationCount > 0
      // This is the key assertion: after fallback, invocationCount is preserved (1),
      // so the user message should NOT be appended again
      expect(mockPlugin.conversationRenderer.addUserMessage).not.toHaveBeenCalled();

      // Verify the first call (fallback) does NOT push the user message to messages array
      const firstCall = (streamText as jest.Mock).mock.calls[0][0];
      expect(firstCall.messages).toEqual(historyMessages);

      // Verify the second call (after fallback) does NOT push the user message to messages array
      const secondCall = (streamText as jest.Mock).mock.calls[1][0];
      expect(secondCall.messages).toEqual(historyMessages);
    });
  });
});
