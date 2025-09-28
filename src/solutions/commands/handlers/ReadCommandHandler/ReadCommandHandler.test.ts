import { ReadCommandHandler } from './ReadCommandHandler';
import type StewardPlugin from 'src/main';
import { type App } from 'obsidian';
import { type NoteContentService } from 'src/services/NoteContentService';
import { CommandHandlerParams, CommandResultStatus } from '../../CommandHandler';
import { generateId, generateText } from 'ai';
import { CommandIntent } from 'src/types/types';
import { ContentReadingResult } from 'src/services/ContentReadingService';

// Mock individual functions from the ai package
jest.mock('ai', () => {
  const originalModule = jest.requireActual('ai');

  return {
    ...originalModule,
    generateText: jest.fn(),
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
    updateConversationNote: jest.fn().mockResolvedValue('message-id-123'),
    serializeToolInvocation: jest.fn(),
  };

  const mockArtifactManager = {
    storeArtifact: jest.fn(),
  };

  const mockPlugin = {
    settings: {
      stewardFolder: 'Steward',
    },
    app: mockApp,
    registerEvent: jest.fn(),
    llmService: {
      getLLMConfig: jest.fn().mockResolvedValue({
        model: 'mock-model',
        temperature: 0.2,
      }),
    },
    abortService: {
      createAbortController: jest.fn().mockReturnValue(new AbortController()),
    },
    editor: {
      getLine: jest.fn().mockReturnValue('Test line content'),
    },
    noteContentService: {
      formatCallout: jest.fn().mockImplementation(content => `[Callout] ${content}`),
    },
    contentReadingService: {
      readContent: jest.fn(),
    },
    conversationRenderer: mockRenderer,
    artifactManager: mockArtifactManager,
  } as unknown as StewardPlugin;

  return {
    ...mockPlugin,
    noteContentService: mockPlugin.noteContentService as unknown as NoteContentService,
  } as unknown as jest.Mocked<StewardPlugin>;
}

describe('ReadCommandHandler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('handle', () => {
    it('should call handle function once when query contains one _read type_', async () => {
      // Arrange
      const mockPlugin = createMockPlugin();
      const handler = new ReadCommandHandler(mockPlugin);

      // Spy on the handle method to track calls
      const handleSpy = jest.spyOn(handler, 'handle');

      // Mock the extraction result
      const mockExtraction = {
        response: {
          id: generateId(),
        },
        text: 'Extracted text content',
        steps: [],
        toolCalls: [
          {
            toolName: 'contentReading',
            args: {
              readType: 'above',
              noteName: 'Test Note',
              elementType: 'paragraph',
              blocksToRead: 1,
              foundPlaceholder: 'Found {{number}} paragraphs',
              confidence: 0.9,
              explanation: 'Reading content above the cursor',
            },
          },
        ],
      };

      (generateText as jest.Mock).mockResolvedValue(mockExtraction);

      // Mock the content reading result
      const mockReadingResult: Partial<ContentReadingResult> = {
        blocks: [
          {
            content: 'Test paragraph content',
            startLine: 0,
            endLine: 1,
            types: ['paragraph'],
          },
        ],
      };

      (mockPlugin.contentReadingService.readContent as jest.Mock).mockResolvedValue(
        mockReadingResult
      );

      // Create command params
      const params: CommandHandlerParams = {
        title: 'Test Conversation',
        command: {
          commandType: 'read',
          query: 'Read text above, read type: above',
          model: 'mock-model',
        } as CommandIntent,
      };

      // Act
      const result = await handler.handle(params);

      // Assert
      expect(result).toMatchObject({
        status: CommandResultStatus.SUCCESS,
      });
      expect(handleSpy).toHaveBeenCalledTimes(1);
      expect(generateText).toHaveBeenCalledTimes(1);
    });

    it('should call handle function twice when query contains two _read type_ and 1 tool call', async () => {
      // Arrange
      const mockPlugin = createMockPlugin();
      const handler = new ReadCommandHandler(mockPlugin);

      // Spy on the handle method to track calls
      const handleSpy = jest.spyOn(handler, 'handle');

      // Mock the extraction result
      const mockExtraction = {
        response: {
          id: generateId(),
        },
        text: 'Extracted text content',
        steps: [],
        toolCalls: [
          {
            toolName: 'contentReading',
            args: {
              readType: 'above',
              noteName: 'Test Note',
              elementType: 'paragraph',
              blocksToRead: 1,
              foundPlaceholder: 'Found {{number}} paragraphs',
              confidence: 0.9,
              explanation: 'Reading content above the cursor',
            },
          },
        ],
      };

      (generateText as jest.Mock).mockResolvedValue(mockExtraction);

      // Mock the content reading result
      const mockReadingResult: Partial<ContentReadingResult> = {
        blocks: [
          {
            content: 'Test paragraph content',
            startLine: 0,
            endLine: 1,
            types: ['paragraph'],
          },
        ],
      };

      (mockPlugin.contentReadingService.readContent as jest.Mock).mockResolvedValue(
        mockReadingResult
      );

      // Create command params
      const params: CommandHandlerParams = {
        title: 'Test Conversation',
        command: {
          commandType: 'read',
          query: 'Read text above, read type: above; Read table above; read type: above',
          model: 'mock-model',
        } as CommandIntent,
      };

      // Act
      const result = await handler.handle(params);

      // Assert
      expect(result).toMatchObject({
        status: CommandResultStatus.SUCCESS,
      });
      expect(handleSpy).toHaveBeenCalledTimes(2);
      expect(generateText).toHaveBeenCalledTimes(2);
    });

    it('should call handle function once when query contains two _read type_ and 2 simultaneously tool calls', async () => {
      // Arrange
      const mockPlugin = createMockPlugin();
      const handler = new ReadCommandHandler(mockPlugin);

      // Spy on the handle method to track calls
      const handleSpy = jest.spyOn(handler, 'handle');

      // Mock the extraction result
      const mockExtraction = {
        text: 'Extracted text content',
        steps: [],
        toolCalls: [
          {
            toolName: 'contentReading',
            args: {
              readType: 'above',
              noteName: 'Test Note',
              elementType: 'paragraph',
              blocksToRead: 1,
              foundPlaceholder: 'Found {{number}} paragraphs',
              confidence: 0.9,
              explanation: 'Reading content above the cursor',
            },
          },
          {
            toolName: 'contentReading',
            args: {
              readType: 'above',
              noteName: 'Test Note',
              elementType: 'table',
              blocksToRead: 1,
              foundPlaceholder: 'Found {{number}} tables',
              confidence: 0.9,
              explanation: 'Reading content above the cursor',
            },
          },
        ],
      };

      (generateText as jest.Mock).mockResolvedValue(mockExtraction);

      // Mock the content reading result
      const mockReadingResult: Partial<ContentReadingResult> = {
        blocks: [
          {
            content: 'Test paragraph content',
            startLine: 0,
            endLine: 1,
            types: ['paragraph'],
          },
        ],
      };

      (mockPlugin.contentReadingService.readContent as jest.Mock).mockResolvedValue(
        mockReadingResult
      );

      // Create command params
      const params: CommandHandlerParams = {
        title: 'Test Conversation',
        command: {
          commandType: 'read',
          query: 'Read text above, read type: above; Read table above; read type: above',
          model: 'mock-model',
        } as CommandIntent,
      };

      // Act
      const result = await handler.handle(params);

      // Assert
      expect(result).toMatchObject({
        status: CommandResultStatus.SUCCESS,
      });
      expect(handleSpy).toHaveBeenCalledTimes(1);
      expect(generateText).toHaveBeenCalledTimes(1);
    });

    it('should return needs_confirmation status when reading entire content, and return success status when confirmed', async () => {
      // Arrange
      const mockPlugin = createMockPlugin();
      const handler = new ReadCommandHandler(mockPlugin);

      // Mock the extraction result
      const mockExtraction = {
        response: {
          id: generateId(),
        },
        text: 'Extracted text content',
        toolCalls: [
          {
            toolName: 'contentReading',
            args: {
              readType: 'entire',
              noteName: 'Test Note',
              blocksToRead: -1,
              confidence: 0.9,
              explanation: 'Reading content above the cursor',
            },
          },
        ],
      };

      (generateText as jest.Mock).mockResolvedValue(mockExtraction);

      // Mock the content reading result
      const mockReadingResult: Partial<ContentReadingResult> = {
        blocks: [
          {
            content: 'Test paragraph content',
            startLine: 0,
            endLine: 1,
            types: ['paragraph'],
          },
        ],
      };

      (mockPlugin.contentReadingService.readContent as jest.Mock).mockResolvedValue(
        mockReadingResult
      );

      // Create command params
      const params: CommandHandlerParams = {
        title: 'Test Conversation',
        command: {
          commandType: 'read',
          query: 'Read entire note Test',
          model: 'mock-model',
        } as CommandIntent,
      };

      // Act
      const result = await handler.handle(params);
      const confirmedResult = await handler.handle(params, {
        extraction: mockExtraction,
        readEntireConfirmed: true,
      });

      // Assert
      expect(result).toMatchObject({
        status: CommandResultStatus.NEEDS_CONFIRMATION,
      });
      expect(confirmedResult).toMatchObject({
        status: CommandResultStatus.SUCCESS,
      });
    });
  });
});
