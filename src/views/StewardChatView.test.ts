import { WorkspaceLeaf, App } from 'obsidian';
import { StewardChatView } from './StewardChatView';
import type StewardPlugin from 'src/main';

jest.mock('obsidian', () => {
  const actual = jest.requireActual('obsidian');
  return {
    ...actual,
    MarkdownView: class MockMarkdownView {
      navigation = false;
      app: App;
    },
  };
});

function createMockPlugin(): jest.Mocked<StewardPlugin> {
  const mockApp = {
    vault: {
      getFolderByPath: jest.fn(),
    },
    metadataCache: {
      getFileCache: jest.fn(),
    },
  };
  return {
    settings: {
      stewardFolder: 'Steward',
    },
    app: mockApp,
  } as unknown as jest.Mocked<StewardPlugin>;
}

describe('StewardChatView', () => {
  let mockPlugin: jest.Mocked<StewardPlugin>;
  let chatView: StewardChatView;

  beforeEach(() => {
    mockPlugin = createMockPlugin();
    chatView = new StewardChatView({} as unknown as WorkspaceLeaf, mockPlugin);
    chatView.app = mockPlugin.app;
  });

  describe('getViewType', () => {
    it('should return steward-conversation', () => {
      expect(chatView.getViewType()).toBe('steward-conversation');
    });
  });
});
