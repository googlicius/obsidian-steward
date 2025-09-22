import { ReadCommandHandler } from './ReadCommandHandler';
import type StewardPlugin from 'src/main';
import { NoteContentService } from 'src/services/NoteContentService';
import { type App } from 'obsidian';
import { generateText } from 'ai';

// Mock the LLMService
jest.mock('src/services/LLMService', () => ({
  LLMService: {
    getInstance: jest.fn().mockReturnValue({
      getLLMConfig: jest.fn().mockResolvedValue({
        model: 'mock-model',
        temperature: 0.2,
      }),
    }),
  },
}));

// Mock the AbortService
jest.mock('src/services/AbortService', () => ({
  AbortService: {
    getInstance: jest.fn().mockReturnValue({
      createAbortController: jest.fn().mockReturnValue({ abort: jest.fn() }),
    }),
  },
}));

// Mock the AI SDK
jest.mock('ai', () => ({
  generateText: jest.fn(),
  tool: jest.fn(),
}));

function createMockPlugin(): jest.Mocked<StewardPlugin> {
  const mockApp = {
    vault: {
      cachedRead: jest.fn().mockResolvedValue(''),
    },
  } as unknown as App;

  const mockPlugin = {
    settings: {
      stewardFolder: 'Steward',
    },
    app: mockApp,
    registerEvent: jest.fn(),
  } as unknown as StewardPlugin;

  return {
    ...mockPlugin,
    noteContentService: NoteContentService.getInstance(mockApp),
    llmService: {
      getLLMConfig: jest.fn().mockResolvedValue({
        model: 'mock-model',
        temperature: 0.2,
      }),
    },
    abortService: {
      createAbortController: jest.fn().mockReturnValue({ abort: jest.fn() }),
    },
    contentReadingService: {
      readContent: jest.fn(),
    },
    editor: {
      getLine: jest.fn().mockReturnValue(''),
    },
    conversationRenderer: {
      updateConversationNote: jest.fn(),
      addGeneratingIndicator: jest.fn(),
      extractConversationHistory: jest.fn().mockResolvedValue([]),
    },
    artifactManager: {
      storeArtifact: jest.fn(),
      getMostRecentArtifactByType: jest.fn(),
      deleteArtifact: jest.fn(),
    },
  } as unknown as jest.Mocked<StewardPlugin>;
}

describe('ReadCommandHandler', () => {
  let readCommandHandler: ReadCommandHandler;
  let mockPlugin: jest.Mocked<StewardPlugin>;

  beforeEach(() => {
    mockPlugin = createMockPlugin();
    readCommandHandler = new ReadCommandHandler(mockPlugin);
  });

  describe('handle', () => {
    it('should call generateText with maxSteps: 1 when query contains "read type:" once', async () => {
      // Arrange
      const mockGenerateTextResult = {
        text: 'Test response',
        toolCalls: [],
        toolResults: [],
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
        finishReason: 'stop' as const,
      };

      const mockGenerateText = generateText as jest.MockedFunction<typeof generateText>;
      mockGenerateText.mockResolvedValue(
        mockGenerateTextResult as unknown as ReturnType<typeof generateText>
      );

      const params = {
        title: 'test-title',
        command: {
          commandType: 'read' as const,
          query: 'Read content from my note with read type: above',
          model: 'test-model',
        },
        lang: 'en',
      };

      // Act
      await readCommandHandler.handle(params);

      // Assert
      expect(mockGenerateText).toHaveBeenCalledWith(
        expect.objectContaining({
          maxSteps: 1,
        })
      );
    });

    it('should call generateText with maxSteps: 2 when query contains "read type:" twice', async () => {
      // Arrange
      const mockGenerateTextResult = {
        text: 'Test response',
        toolCalls: [],
        toolResults: [],
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
        finishReason: 'stop' as const,
      };

      const mockGenerateText = generateText as jest.MockedFunction<typeof generateText>;
      mockGenerateText.mockResolvedValue(
        mockGenerateTextResult as unknown as ReturnType<typeof generateText>
      );

      const params = {
        title: 'test-title',
        command: {
          commandType: 'read' as const,
          query: 'Read content with read type: above and read type: below',
          model: 'test-model',
        },
        lang: 'en',
      };

      // Act
      await readCommandHandler.handle(params);

      // Assert
      expect(mockGenerateText).toHaveBeenCalledWith(
        expect.objectContaining({
          maxSteps: 2,
        })
      );
    });

    it('should call generateText with maxSteps: 5 when query contains no "read type:" phrases', async () => {
      // Arrange
      const mockGenerateTextResult = {
        text: 'Test response',
        toolCalls: [],
        toolResults: [],
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
        finishReason: 'stop' as const,
      };

      const mockGenerateText = generateText as jest.MockedFunction<typeof generateText>;
      mockGenerateText.mockResolvedValue(
        mockGenerateTextResult as unknown as ReturnType<typeof generateText>
      );

      const params = {
        title: 'test-title',
        command: {
          commandType: 'read' as const,
          query: 'Just read some content from my note',
          model: 'test-model',
        },
        lang: 'en',
      };

      // Act
      await readCommandHandler.handle(params);

      // Assert
      expect(mockGenerateText).toHaveBeenCalledWith(
        expect.objectContaining({
          maxSteps: 5,
        })
      );
    });
  });
});
