import { RevertEditResults } from './RevertEditResults';
import { type SuperAgent } from '../SuperAgent';
import type StewardPlugin from 'src/main';
import { ArtifactType, Change, FileChangeSet } from 'src/solutions/artifact';
import { TFile, type App } from 'obsidian';
import { ToolCallPart } from '../../tools/types';
import { RevertEditResultsToolArgs } from './RevertEditResults';

function createMockPlugin(): jest.Mocked<StewardPlugin> {
  const mockApp = {
    vault: {
      getFileByPath: jest.fn(),
      process: jest.fn(),
    },
  } as unknown as App;

  const mockRenderer = {
    updateConversationNote: jest.fn().mockResolvedValue('message-id-123'),
    serializeInvocation: jest.fn(),
  };

  const mockArtifactManager = {
    withTitle: jest.fn().mockReturnValue({
      getArtifactById: jest.fn(),
      removeArtifact: jest.fn().mockResolvedValue(undefined),
    }),
  };

  const mockPlugin = {
    app: mockApp,
    artifactManagerV2: mockArtifactManager,
    conversationRenderer: mockRenderer,
  } as unknown as StewardPlugin;

  return mockPlugin as unknown as jest.Mocked<StewardPlugin>;
}

describe('RevertEditResults', () => {
  let revertEditResults: RevertEditResults;
  let mockAgent: jest.Mocked<SuperAgent>;
  let mockPlugin: jest.Mocked<StewardPlugin>;

  beforeEach(() => {
    mockPlugin = createMockPlugin();
    mockAgent = {
      plugin: mockPlugin,
      renderer: mockPlugin.conversationRenderer,
      app: mockPlugin.app,
      serializeInvocation: jest.fn(),
    } as unknown as jest.Mocked<SuperAgent>;
    revertEditResults = new RevertEditResults(mockAgent);
  });

  describe('handle', () => {
    it('should revert a simple replacement change', async () => {
      const originalContent = 'Original content';
      const newContent = 'Modified content';
      const filePath = 'test.md';

      const change: Change = {
        startLine: 0,
        endLine: 0,
        originalContent,
        newContent,
        mode: 'replace_by_lines',
      };

      const fileChangeSet: FileChangeSet = {
        path: filePath,
        changes: [change],
      };

      const artifact = {
        artifactType: ArtifactType.EDIT_RESULTS,
        files: [fileChangeSet],
        id: 'artifact-123',
      };

      const mockFile = new TFile();
      mockFile.path = filePath;
      mockFile.name = 'test.md';
      mockFile.extension = 'md';

      mockPlugin.app.vault.getFileByPath = jest.fn().mockReturnValue(mockFile);
      mockPlugin.artifactManagerV2.withTitle = jest.fn().mockReturnValue({
        getArtifactById: jest.fn().mockResolvedValue(artifact),
        removeArtifact: jest.fn().mockResolvedValue(undefined),
      });

      // Spy on the vault.process method
      let processedContent = '';
      const processSpy = jest
        .spyOn(mockPlugin.app.vault, 'process')
        .mockImplementation(async (file, processor) => {
          processedContent = processor(newContent);
          return processedContent;
        });

      const toolCall: ToolCallPart<RevertEditResultsToolArgs> = {
        type: 'tool-call',
        toolCallId: 'call-123',
        toolName: 'revert_edit_results',
        input: {
          artifactId: 'artifact-123',
          explanation: 'Revert test',
        },
      };

      const params = {
        title: 'test-title',
        handlerId: 'handler-123',
        lang: null,
        intent: {
          type: 'revert_edit_results',
          query: 'revert',
        },
      };

      await revertEditResults.handle(params, { toolCall });

      // Verify that vault.process was called
      expect(processSpy).toHaveBeenCalledTimes(1);
      // Verify the processed content is the original content (reverted)
      expect(processedContent).toBe(originalContent);
    });

    it('should revert multiple changes in reverse order', async () => {
      const originalContent1 = 'First original';
      const newContent1 = 'First modified';
      const originalContent2 = 'Second original';
      const newContent2 = 'Second modified';
      const filePath = 'test.md';

      const currentFileContent = `${newContent1}\nMiddle content\n${newContent2}`;
      const expectedRevertedContent = `${originalContent1}\nMiddle content\n${originalContent2}`;

      const changes: Change[] = [
        {
          startLine: 0,
          endLine: 0,
          originalContent: originalContent1,
          newContent: newContent1,
          mode: 'replace_by_lines',
        },
        {
          startLine: 2,
          endLine: 2,
          originalContent: originalContent2,
          newContent: newContent2,
          mode: 'replace_by_lines',
        },
      ];

      const fileChangeSet: FileChangeSet = {
        path: filePath,
        changes,
      };

      const artifact = {
        artifactType: ArtifactType.EDIT_RESULTS,
        files: [fileChangeSet],
        id: 'artifact-123',
      };

      const mockFile = new TFile();
      mockFile.path = filePath;
      mockFile.name = 'test.md';
      mockFile.extension = 'md';

      mockPlugin.app.vault.getFileByPath = jest.fn().mockReturnValue(mockFile);
      mockPlugin.artifactManagerV2.withTitle = jest.fn().mockReturnValue({
        getArtifactById: jest.fn().mockResolvedValue(artifact),
        removeArtifact: jest.fn().mockResolvedValue(undefined),
      });

      // Spy on the vault.process method
      let processedContent = '';
      const processSpy = jest
        .spyOn(mockPlugin.app.vault, 'process')
        .mockImplementation(async (file, processor) => {
          processedContent = processor(currentFileContent);
          return processedContent;
        });

      const toolCall: ToolCallPart<RevertEditResultsToolArgs> = {
        type: 'tool-call',
        toolCallId: 'call-123',
        toolName: 'revert_edit_results',
        input: {
          artifactId: 'artifact-123',
          explanation: 'Revert multiple changes',
        },
      };

      const params = {
        title: 'test-title',
        handlerId: 'handler-123',
        lang: null,
        intent: {
          type: 'revert_edit_results',
          query: 'revert',
        },
      };

      await revertEditResults.handle(params, { toolCall });

      // Verify that vault.process was called
      expect(processSpy).toHaveBeenCalledTimes(1);
      // Verify the processed content matches the expected reverted content
      expect(processedContent).toBe(expectedRevertedContent);
    });

    it('should revert an insertion (remove inserted content)', async () => {
      const insertedContent = 'New inserted line';
      const filePath = 'test.md';
      const currentFileContent = `Line 1\n${insertedContent}\nLine 2`;
      const expectedRevertedContent = 'Line 1\nLine 2';

      const change: Change = {
        startLine: 1,
        endLine: 1,
        originalContent: '', // Empty originalContent means this was an insertion
        newContent: insertedContent,
        mode: 'insert',
      };

      const fileChangeSet: FileChangeSet = {
        path: filePath,
        changes: [change],
      };

      const artifact = {
        artifactType: ArtifactType.EDIT_RESULTS,
        files: [fileChangeSet],
        id: 'artifact-123',
      };

      const mockFile = new TFile();
      mockFile.path = filePath;
      mockFile.name = 'test.md';
      mockFile.extension = 'md';

      mockPlugin.app.vault.getFileByPath = jest.fn().mockReturnValue(mockFile);
      mockPlugin.artifactManagerV2.withTitle = jest.fn().mockReturnValue({
        getArtifactById: jest.fn().mockResolvedValue(artifact),
        removeArtifact: jest.fn().mockResolvedValue(undefined),
      });

      let processedContent = '';
      const processSpy = jest
        .spyOn(mockPlugin.app.vault, 'process')
        .mockImplementation(async (file, processor) => {
          processedContent = processor(currentFileContent);
          return processedContent;
        });

      const toolCall: ToolCallPart<RevertEditResultsToolArgs> = {
        type: 'tool-call',
        toolCallId: 'call-123',
        toolName: 'revert_edit_results',
        input: {
          artifactId: 'artifact-123',
          explanation: 'Revert insertion',
        },
      };

      const params = {
        title: 'test-title',
        handlerId: 'handler-123',
        lang: null,
        intent: {
          type: 'revert_edit_results',
          query: 'revert',
        },
      };

      await revertEditResults.handle(params, { toolCall });

      expect(processSpy).toHaveBeenCalledTimes(1);
      expect(processedContent).toBe(expectedRevertedContent);
    });

    it('should revert a deletion (restore deleted content)', async () => {
      const deletedContent = 'Deleted line';
      const filePath = 'test.md';
      const currentFileContent = 'Line 1\nLine 2';
      const expectedRevertedContent = `Line 1\n${deletedContent}\nLine 2`;

      const change: Change = {
        startLine: 1,
        endLine: 1,
        originalContent: deletedContent,
        newContent: '', // Empty newContent means this was a deletion
        mode: 'delete',
        contextBefore: 'Line 1',
        contextAfter: 'Line 2',
      };

      const fileChangeSet: FileChangeSet = {
        path: filePath,
        changes: [change],
      };

      const artifact = {
        artifactType: ArtifactType.EDIT_RESULTS,
        files: [fileChangeSet],
        id: 'artifact-123',
      };

      const mockFile = new TFile();
      mockFile.path = filePath;
      mockFile.name = 'test.md';
      mockFile.extension = 'md';

      mockPlugin.app.vault.getFileByPath = jest.fn().mockReturnValue(mockFile);
      mockPlugin.artifactManagerV2.withTitle = jest.fn().mockReturnValue({
        getArtifactById: jest.fn().mockResolvedValue(artifact),
        removeArtifact: jest.fn().mockResolvedValue(undefined),
      });

      let processedContent = '';
      const processSpy = jest
        .spyOn(mockPlugin.app.vault, 'process')
        .mockImplementation(async (file, processor) => {
          processedContent = processor(currentFileContent);
          return processedContent;
        });

      const toolCall: ToolCallPart<RevertEditResultsToolArgs> = {
        type: 'tool-call',
        toolCallId: 'call-123',
        toolName: 'revert_edit_results',
        input: {
          artifactId: 'artifact-123',
          explanation: 'Revert deletion',
        },
      };

      const params = {
        title: 'test-title',
        handlerId: 'handler-123',
        lang: null,
        intent: {
          type: 'revert_edit_results',
          query: 'revert',
        },
      };

      await revertEditResults.handle(params, { toolCall });

      expect(processSpy).toHaveBeenCalledTimes(1);
      expect(processedContent).toBe(expectedRevertedContent);
    });

    it('should revert replacement with context', async () => {
      const originalContent = 'Original text';
      const newContent = 'Modified text';
      const filePath = 'test.md';
      const currentFileContent = `Before\n${newContent}\nAfter`;
      const expectedRevertedContent = `Before\n${originalContent}\nAfter`;

      const change: Change = {
        startLine: 1,
        endLine: 1,
        originalContent,
        newContent,
        mode: 'replace_by_lines',
        contextBefore: 'Before',
        contextAfter: 'After',
      };

      const fileChangeSet: FileChangeSet = {
        path: filePath,
        changes: [change],
      };

      const artifact = {
        artifactType: ArtifactType.EDIT_RESULTS,
        files: [fileChangeSet],
        id: 'artifact-123',
      };

      const mockFile = new TFile();
      mockFile.path = filePath;
      mockFile.name = 'test.md';
      mockFile.extension = 'md';

      mockPlugin.app.vault.getFileByPath = jest.fn().mockReturnValue(mockFile);
      mockPlugin.artifactManagerV2.withTitle = jest.fn().mockReturnValue({
        getArtifactById: jest.fn().mockResolvedValue(artifact),
        removeArtifact: jest.fn().mockResolvedValue(undefined),
      });

      let processedContent = '';
      const processSpy = jest
        .spyOn(mockPlugin.app.vault, 'process')
        .mockImplementation(async (file, processor) => {
          processedContent = processor(currentFileContent);
          return processedContent;
        });

      const toolCall: ToolCallPart<RevertEditResultsToolArgs> = {
        type: 'tool-call',
        toolCallId: 'call-123',
        toolName: 'revert_edit_results',
        input: {
          artifactId: 'artifact-123',
          explanation: 'Revert with context',
        },
      };

      const params = {
        title: 'test-title',
        handlerId: 'handler-123',
        lang: null,
        intent: {
          type: 'revert_edit_results',
          query: 'revert',
        },
      };

      await revertEditResults.handle(params, { toolCall });

      expect(processSpy).toHaveBeenCalledTimes(1);
      expect(processedContent).toBe(expectedRevertedContent);
    });

    it('should revert multiple files', async () => {
      const filePath1 = 'test1.md';
      const filePath2 = 'test2.md';
      const originalContent1 = 'Original 1';
      const newContent1 = 'Modified 1';
      const originalContent2 = 'Original 2';
      const newContent2 = 'Modified 2';

      const fileChangeSet1: FileChangeSet = {
        path: filePath1,
        changes: [
          {
            startLine: 0,
            endLine: 0,
            originalContent: originalContent1,
            newContent: newContent1,
            mode: 'replace_by_lines',
          },
        ],
      };

      const fileChangeSet2: FileChangeSet = {
        path: filePath2,
        changes: [
          {
            startLine: 0,
            endLine: 0,
            originalContent: originalContent2,
            newContent: newContent2,
            mode: 'replace_by_lines',
          },
        ],
      };

      const artifact = {
        artifactType: ArtifactType.EDIT_RESULTS,
        files: [fileChangeSet1, fileChangeSet2],
        id: 'artifact-123',
      };

      const mockFile1 = new TFile();
      mockFile1.path = filePath1;
      mockFile1.name = 'test1.md';
      mockFile1.extension = 'md';

      const mockFile2 = new TFile();
      mockFile2.path = filePath2;
      mockFile2.name = 'test2.md';
      mockFile2.extension = 'md';

      mockPlugin.app.vault.getFileByPath = jest
        .fn()
        .mockReturnValueOnce(mockFile1)
        .mockReturnValueOnce(mockFile2);

      mockPlugin.artifactManagerV2.withTitle = jest.fn().mockReturnValue({
        getArtifactById: jest.fn().mockResolvedValue(artifact),
        removeArtifact: jest.fn().mockResolvedValue(undefined),
      });

      const processedContents: string[] = [];
      const processSpy = jest
        .spyOn(mockPlugin.app.vault, 'process')
        .mockImplementation(async (file, processor) => {
          const currentContent = file.path === filePath1 ? newContent1 : newContent2;
          const processed = processor(currentContent);
          processedContents.push(processed);
          return processed;
        });

      const toolCall: ToolCallPart<RevertEditResultsToolArgs> = {
        type: 'tool-call',
        toolCallId: 'call-123',
        toolName: 'revert_edit_results',
        input: {
          artifactId: 'artifact-123',
          explanation: 'Revert multiple files',
        },
      };

      const params = {
        title: 'test-title',
        handlerId: 'handler-123',
        lang: null,
        intent: {
          type: 'revert_edit_results',
          query: 'revert',
        },
      };

      await revertEditResults.handle(params, { toolCall });

      expect(processSpy).toHaveBeenCalledTimes(2);
      expect(processedContents).toHaveLength(2);
      expect(processedContents).toContain(originalContent1);
      expect(processedContents).toContain(originalContent2);
    });

    it('should handle file not found gracefully', async () => {
      const filePath = 'nonexistent.md';
      const change: Change = {
        startLine: 0,
        endLine: 0,
        originalContent: 'Original',
        newContent: 'Modified',
        mode: 'replace_by_lines',
      };

      const fileChangeSet: FileChangeSet = {
        path: filePath,
        changes: [change],
      };

      const artifact = {
        artifactType: ArtifactType.EDIT_RESULTS,
        files: [fileChangeSet],
        id: 'artifact-123',
      };

      mockPlugin.app.vault.getFileByPath = jest.fn().mockReturnValue(null);
      mockPlugin.artifactManagerV2.withTitle = jest.fn().mockReturnValue({
        getArtifactById: jest.fn().mockResolvedValue(artifact),
        removeArtifact: jest.fn().mockResolvedValue(undefined),
      });

      const processSpy = jest.spyOn(mockPlugin.app.vault, 'process');

      const toolCall: ToolCallPart<RevertEditResultsToolArgs> = {
        type: 'tool-call',
        toolCallId: 'call-123',
        toolName: 'revert_edit_results',
        input: {
          artifactId: 'artifact-123',
          explanation: 'Revert nonexistent file',
        },
      };

      const params = {
        title: 'test-title',
        handlerId: 'handler-123',
        lang: null,
        intent: {
          type: 'revert_edit_results',
          query: 'revert',
        },
      };

      await revertEditResults.handle(params, { toolCall });

      // vault.process should not be called when file is not found
      expect(processSpy).not.toHaveBeenCalled();
    });
  });
});
