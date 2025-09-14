import { MediaTools } from './mediaTools';
import { App as ObsidianApp } from 'obsidian';

// Mock the Obsidian modules
jest.mock('obsidian', () => ({
  App: jest.fn().mockImplementation(() => ({
    vault: {
      config: { attachmentFolderPath: 'attachments' },
      getAbstractFileByPath: jest.fn(),
      createBinary: jest.fn().mockResolvedValue(undefined),
      createFolder: jest.fn().mockResolvedValue(undefined),
    },
    fileManager: {
      trashFile: jest.fn().mockResolvedValue(undefined),
    },
  })),
  TFile: jest.fn().mockImplementation(() => ({
    path: '',
    extension: '',
    name: '',
  })),
}));

describe('MediaTools', () => {
  let app: jest.Mocked<ObsidianApp>;
  let mediaTools: MediaTools;

  beforeEach(() => {
    // Clear all mocks
    jest.clearAllMocks();

    // Create a new App instance for each test
    app = new ObsidianApp() as jest.Mocked<ObsidianApp>;
    mediaTools = MediaTools.getInstance(app);
  });

  describe('getMediaFilename', () => {
    let getMediaFilename: (
      prompt: string,
      type: 'image' | 'audio',
      timestamp: number,
      maxWords?: number
    ) => string;
    const timestamp = 1234567890;

    beforeEach(() => {
      getMediaFilename = mediaTools['getMediaFilename'].bind(mediaTools);
    });

    it('includes prompt if 3 words or fewer, retains spaces', () => {
      const filename = getMediaFilename('cat dog bird', 'image', timestamp);
      expect(filename).toBe('image_cat-dog-bird_1234567890');
    });

    it('sanitizes special characters in prompt', () => {
      const filename = getMediaFilename('cat/dog*bird', 'audio', timestamp);
      expect(filename).toBe('audio_cat-dog-bird_1234567890');
    });

    it('does not include prompt if more than 3 words', () => {
      const filename = getMediaFilename('this is more than three', 'image', timestamp);
      expect(filename).toBe('image_1234567890');
    });

    it('does not replace letters with diacritics and other language characters', () => {
      const filename = getMediaFilename('café naïve العربية  Москва 文字', 'image', timestamp, 6);
      expect(filename).toBe('image_café-naïve-العربية-Москва-文字_1234567890');
    });
  });
});
