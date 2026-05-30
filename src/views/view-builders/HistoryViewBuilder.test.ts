import { TFile, TFolder, App } from 'obsidian';
import { HistoryViewBuilder } from './HistoryViewBuilder';
import type StewardPlugin from 'src/main';
import { getInstance } from 'src/utils/getInstance';
import { getBundledInternal } from 'src/utils/bundledInternals';

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

describe('HistoryViewBuilder', () => {
  let mockPlugin: jest.Mocked<StewardPlugin>;
  let historyViewBuilder: HistoryViewBuilder;

  beforeEach(() => {
    mockPlugin = createMockPlugin();
    historyViewBuilder = new HistoryViewBuilder(mockPlugin.app, mockPlugin);
  });

  describe('getFilePath', () => {
    it('should return the History note path under stewardFolder', () => {
      expect(historyViewBuilder.getFilePath()).toBe('Steward/History.md');
    });
  });

  describe('buildContent', () => {
    it('should return noConversations message when folder does not exist', async () => {
      mockPlugin.app.vault.getFolderByPath = jest.fn().mockReturnValue(null);

      const result = await historyViewBuilder.buildContent();

      expect(result).toBe(getBundledInternal('i18n').i18next.t('chat.noConversations'));
    });

    it('should return noConversations message when folder is empty', async () => {
      const mockFolder = getInstance(TFolder, {
        path: 'Steward/Conversations',
        children: [],
      });
      mockPlugin.app.vault.getFolderByPath = jest.fn().mockReturnValue(mockFolder);

      const result = await historyViewBuilder.buildContent();

      expect(result).toBe(getBundledInternal('i18n').i18next.t('chat.noConversations'));
    });
  });

  describe('buildHistoryDisplayText', () => {
    let buildHistoryDisplayText: HistoryViewBuilder['buildHistoryDisplayText'];

    beforeEach(() => {
      buildHistoryDisplayText =
        historyViewBuilder['buildHistoryDisplayText'].bind(historyViewBuilder);
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
