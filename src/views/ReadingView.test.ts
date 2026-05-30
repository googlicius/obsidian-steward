import { TFile, WorkspaceLeaf, App } from 'obsidian';
import { ReadingView } from './ReadingView';
import type StewardPlugin from 'src/main';
import { getBundledInternal } from 'src/utils/bundledInternals';

jest.mock('obsidian', () => {
  const actual = jest.requireActual('obsidian');
  return {
    ...actual,
    MarkdownView: class MockMarkdownView {
      navigation = false;
      app: App;
      file: TFile | null = null;
      getMode = jest.fn().mockReturnValue('source');
      getState = jest.fn().mockReturnValue({ mode: 'source' });
      setState = jest.fn().mockResolvedValue(undefined);
    },
  };
});

function createMockPlugin(): jest.Mocked<StewardPlugin> {
  return {
    settings: {
      stewardFolder: 'Steward',
    },
    app: {},
    startNewChat: jest.fn(),
    openReadingView: jest.fn(),
    toggleViewDockFromView: jest.fn(),
    leafIsInRightSidebar: jest.fn().mockReturnValue(false),
  } as unknown as jest.Mocked<StewardPlugin>;
}

describe('ReadingView', () => {
  let mockPlugin: jest.Mocked<StewardPlugin>;
  let readingView: ReadingView;

  beforeEach(() => {
    mockPlugin = createMockPlugin();
    readingView = new ReadingView({} as unknown as WorkspaceLeaf, mockPlugin);
  });

  describe('getViewType', () => {
    it('should return steward-reading', () => {
      expect(readingView.getViewType()).toBe('steward-reading');
    });
  });

  describe('getDisplayText', () => {
    it('should return history label when no file is open', () => {
      Object.defineProperty(readingView, 'file', { value: null, configurable: true });
      expect(readingView.getDisplayText()).toBe(
        getBundledInternal('i18n').i18next.t('chat.history')
      );
    });
  });
});
