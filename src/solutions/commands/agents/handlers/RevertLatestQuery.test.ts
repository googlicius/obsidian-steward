import { TFile, type App } from 'obsidian';
import type StewardPlugin from 'src/main';
import type { AgentHandlerContext } from '../AgentHandlerContext';
import { ArtifactType } from 'src/solutions/artifact';
import { ToolCallPart } from '../../tools/types';
import { ToolName } from '../../toolNames';
import { RevertLatestQuery, RevertToolArgs } from './RevertLatestQuery';

function createMockFile(path: string): TFile {
  const file = new TFile();
  file.path = path;
  file.name = path.split('/').pop() || path;
  file.extension = 'md';
  return file;
}

describe('RevertLatestQuery', () => {
  let handler: RevertLatestQuery;
  let mockAgent: jest.Mocked<AgentHandlerContext>;
  let mockPlugin: jest.Mocked<StewardPlugin>;
  let parentManager: {
    getAllRevertableArtifacts: jest.Mock;
    removeArtifact: jest.Mock;
  };
  let childManager: {
    getAllRevertableArtifacts: jest.Mock;
    removeArtifact: jest.Mock;
  };

  beforeEach(() => {
    parentManager = {
      getAllRevertableArtifacts: jest.fn().mockResolvedValue([]),
      removeArtifact: jest.fn().mockResolvedValue(true),
    };
    childManager = {
      getAllRevertableArtifacts: jest.fn().mockResolvedValue([]),
      removeArtifact: jest.fn().mockResolvedValue(true),
    };

    const mockApp = {
      vault: {
        getAbstractFileByPath: jest.fn(),
        delete: jest.fn().mockResolvedValue(undefined),
        getFileByPath: jest.fn(),
        getFolderByPath: jest.fn(),
        process: jest.fn(),
      },
      fileManager: {
        renameFile: jest.fn().mockResolvedValue(undefined),
        processFrontMatter: jest.fn().mockResolvedValue(undefined),
      },
    } as unknown as App;

    const mockRenderer = {
      extractAllConversationMessages: jest.fn(),
      updateConversationNote: jest.fn().mockResolvedValue('message-id'),
    };

    mockPlugin = {
      app: mockApp,
      conversationRenderer: mockRenderer,
      artifactManagerV2: {
        withTitle: jest.fn((title: string) => {
          if (title.includes('__subagent_')) {
            return childManager;
          }
          return parentManager;
        }),
      },
      trashCleanupService: {
        getAllMetadata: jest.fn().mockResolvedValue({ files: {} }),
        getFileMetadata: jest.fn(),
        removeFileFromTrash: jest.fn(),
      },
    } as unknown as jest.Mocked<StewardPlugin>;

    mockAgent = {
      plugin: mockPlugin,
      renderer: mockRenderer as unknown as AgentHandlerContext['renderer'],
      app: mockApp,
      serializeInvocation: jest.fn().mockResolvedValue(undefined),
      obsidianAPITools: {
        ensureFolderExists: jest.fn().mockResolvedValue(undefined),
      },
    } as unknown as jest.Mocked<AgentHandlerContext>;

    handler = new RevertLatestQuery(mockAgent);
  });

  function buildToolCall(explanation = 'Revert latest query'): ToolCallPart<RevertToolArgs> {
    return {
      type: 'tool-call',
      toolCallId: 'call-1',
      toolName: ToolName.REVERT,
      input: {
        explanation,
      },
    };
  }

  it('returns error when there is no previous user query window', async () => {
    mockAgent.renderer.extractAllConversationMessages = jest.fn().mockResolvedValue([
      {
        id: 'u-1',
        role: 'user',
        content: 'revert',
        intent: 'revert',
      },
    ]);

    const result = await handler.handle(
      {
        title: 'conversation',
        handlerId: 'handler-1',
        lang: 'en',
        intent: { type: 'revert', query: 'revert' },
      },
      { toolCall: buildToolCall() }
    );

    expect(result.status).toBe('error');
    expect(mockAgent.renderer.updateConversationNote).toHaveBeenCalled();
    expect(mockAgent.serializeInvocation).toHaveBeenCalled();
  });

  it('reverts parent and subagent artifacts from latest query', async () => {
    parentManager.getAllRevertableArtifacts.mockResolvedValue([
      {
        artifactType: ArtifactType.CREATED_PATHS,
        id: 'p-a1',
        messageId: 'p-a1',
        createdAt: 100,
        paths: ['Parent/New.md'],
      },
    ]);
    childManager.getAllRevertableArtifacts.mockResolvedValue([
      {
        artifactType: ArtifactType.CREATED_PATHS,
        id: 'c-a1',
        messageId: 'c-a1',
        createdAt: 200,
        paths: ['Child/New.md'],
      },
    ]);

    const spawnContent = ['>[!stw-review]', '>![[conversation__subagent_1]]'].join('\n');

    mockAgent.renderer.extractAllConversationMessages = jest
      .fn()
      .mockImplementation(async (title: string) => {
        if (title === 'conversation') {
          return [
            { id: 'u-1', role: 'user', content: 'query 1', intent: 'vault' },
            {
              id: 'p-a1',
              role: 'assistant',
              content: 'artifact',
              intent: 'create',
              type: 'artifact',
              artifactType: ArtifactType.CREATED_PATHS,
            },
            {
              id: 'spawn-1',
              role: 'assistant',
              content: spawnContent,
              intent: 'spawn_subagent',
              type: 'tool-invocation',
            },
            { id: 'u-2', role: 'user', content: 'revert', intent: 'revert' },
            {
              id: 'a-after-1',
              role: 'assistant',
              content: 'Reverting all operations from the latest user query',
              intent: 'revert_latest_query',
              type: 'text',
            },
          ];
        }
        if (title === 'conversation__subagent_1') {
          return [
            { id: 'u-s1', role: 'user', content: 'child task', intent: 'vault' },
            {
              id: 'c-a1',
              role: 'assistant',
              content: 'artifact',
              intent: 'create',
              type: 'artifact',
              artifactType: ArtifactType.CREATED_PATHS,
            },
          ];
        }
        return [];
      });

    mockPlugin.app.vault.getAbstractFileByPath = jest.fn((path: string) => createMockFile(path));

    const result = await handler.handle(
      {
        title: 'conversation',
        handlerId: 'handler-1',
        lang: 'en',
        intent: { type: 'revert', query: 'revert' },
      },
      { toolCall: buildToolCall() }
    );

    expect(result.status).toBe('success');
    expect(mockPlugin.app.vault.delete).toHaveBeenCalledTimes(2);
    expect(parentManager.removeArtifact).toHaveBeenCalledWith('p-a1', 'Revert latest query');
    expect(childManager.removeArtifact).toHaveBeenCalledWith('c-a1', 'Revert latest query');
  });

  it('continues best-effort when one artifact fails', async () => {
    parentManager.getAllRevertableArtifacts.mockResolvedValue([
      {
        artifactType: ArtifactType.CREATED_PATHS,
        id: 'a-1',
        messageId: 'a-1',
        createdAt: 100,
        paths: ['A.md'],
      },
      {
        artifactType: ArtifactType.CREATED_PATHS,
        id: 'a-2',
        messageId: 'a-2',
        createdAt: 90,
        paths: ['B.md'],
      },
    ]);

    mockAgent.renderer.extractAllConversationMessages = jest.fn().mockResolvedValue([
      { id: 'u-1', role: 'user', content: 'query 1', intent: 'vault' },
      {
        id: 'a-1',
        role: 'assistant',
        content: 'artifact',
        intent: 'create',
        type: 'artifact',
        artifactType: ArtifactType.CREATED_PATHS,
      },
      {
        id: 'a-2',
        role: 'assistant',
        content: 'artifact',
        intent: 'create',
        type: 'artifact',
        artifactType: ArtifactType.CREATED_PATHS,
      },
      { id: 'u-2', role: 'user', content: 'revert', intent: 'revert' },
      {
        id: 'a-after-2',
        role: 'assistant',
        content: 'Reverting all operations from the latest user query',
        intent: 'revert_latest_query',
        type: 'text',
      },
    ]);

    mockPlugin.app.vault.getAbstractFileByPath = jest.fn((path: string) => createMockFile(path));
    mockPlugin.app.vault.delete = jest.fn(async (file: TFile) => {
      if (file.path === 'A.md') {
        throw new Error('delete failed');
      }
      return undefined;
    });

    const result = await handler.handle(
      {
        title: 'conversation',
        handlerId: 'handler-1',
        lang: 'en',
        intent: { type: 'revert', query: 'revert' },
      },
      { toolCall: buildToolCall() }
    );

    expect(result.status).toBe('success');
    expect(mockPlugin.app.vault.delete).toHaveBeenCalledTimes(2);
    expect(parentManager.removeArtifact).toHaveBeenCalledWith('a-2', 'Revert latest query');
  });
});
