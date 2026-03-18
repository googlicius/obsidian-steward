import { WorkspaceLeaf, TFile, TFolder, App } from 'obsidian';
import { StewardChatView } from './StewardChatView';
import type StewardPlugin from 'src/main';
import { getInstance } from 'src/utils/getInstance';
import i18next from 'i18next';

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

  describe('buildHistoryContent', () => {
    let buildHistoryContent: StewardChatView['buildHistoryContent'];

    beforeEach(() => {
      buildHistoryContent = chatView['buildHistoryContent'].bind(chatView);
    });

    it('should return noConversations message when folder does not exist', async () => {
      mockPlugin.app.vault.getFolderByPath = jest.fn().mockReturnValue(null);

      const result = await buildHistoryContent();

      expect(result).toBe(i18next.t('chat.noConversations'));
    });

    it('should return noConversations message when folder is empty', async () => {
      const mockFolder = getInstance(TFolder, {
        path: 'Steward/Conversations',
        children: [],
      });
      mockPlugin.app.vault.getFolderByPath = jest.fn().mockReturnValue(mockFolder);

      const result = await buildHistoryContent();

      expect(result).toBe(i18next.t('chat.noConversations'));
    });
  });

  describe('buildHistoryDisplayText', () => {
    let buildHistoryDisplayText: StewardChatView['buildHistoryDisplayText'];

    beforeEach(() => {
      buildHistoryDisplayText = chatView['buildHistoryDisplayText'].bind(chatView);
    });

    it('should return file basename when conversation_title is not in frontmatter', () => {
      const mockFile = getInstance(TFile, {
        path: 'Steward/Conversations/my-conversation.md',
        name: 'my-conversation.md',
        basename: 'my-conversation',
        extension: 'md',
      });
      mockPlugin.app.metadataCache.getFileCache = jest.fn().mockReturnValue(null);

      const result = buildHistoryDisplayText(mockFile);

      expect(result).toBe('my-conversation');
    });

    it('should return conversation_title from frontmatter when available', () => {
      const mockFile = getInstance(TFile, {
        path: 'Steward/Conversations/my-conversation.md',
        name: 'my-conversation.md',
        basename: 'my-conversation',
        extension: 'md',
      });
      mockPlugin.app.metadataCache.getFileCache = jest.fn().mockReturnValue({
        frontmatter: {
          conversation_title: 'My Custom Title',
        },
      });

      const result = buildHistoryDisplayText(mockFile);

      expect(result).toBe('My Custom Title');
    });

    it('should escape Obsidian tags in conversation_title', () => {
      const mockFile = getInstance(TFile, {
        path: 'Steward/Conversations/my-conversation.md',
        name: 'my-conversation.md',
        basename: 'my-conversation',
        extension: 'md',
      });
      mockPlugin.app.metadataCache.getFileCache = jest.fn().mockReturnValue({
        frontmatter: {
          conversation_title: 'Meeting with #team',
        },
      });

      const result = buildHistoryDisplayText(mockFile);

      expect(result).toBe('Meeting with `#team`');
    });
  });
});
