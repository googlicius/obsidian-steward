import { MediaTools, MediaGenerationOptions } from './mediaTools';
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
      options: MediaGenerationOptions,
      timestamp: number,
      maxWords?: number
    ) => string;
    const timestamp = 1234567890;

    beforeEach(() => {
      getMediaFilename = (
        mediaTools as unknown as {
          getMediaFilename: (
            options: MediaGenerationOptions,
            timestamp: number,
            maxWords?: number
          ) => string;
        }
      ).getMediaFilename.bind(mediaTools);
    });

    it('includes prompt if 3 words or fewer, retains spaces', () => {
      const options: MediaGenerationOptions = {
        prompt: 'cat dog bird',
        type: 'image',
      };
      const filename = getMediaFilename(options, timestamp);
      expect(filename).toBe('image_cat-dog-bird_1234567890');
    });

    it('sanitizes special characters in prompt', () => {
      const options: MediaGenerationOptions = {
        prompt: 'cat/dog*bird',
        type: 'audio',
      };
      const filename = getMediaFilename(options, timestamp);
      expect(filename).toBe('audio_cat-dog-bird_1234567890');
    });

    it('does not include prompt if more than 3 words', () => {
      const options: MediaGenerationOptions = {
        prompt: 'this is more than three',
        type: 'image',
      };
      const filename = getMediaFilename(options, timestamp);
      expect(filename).toBe('image_1234567890');
    });

    it('does not replace letters with diacritics and other language characters', () => {
      const options: MediaGenerationOptions = {
        prompt: 'café naïve العربية  Москва 文字',
        type: 'image',
      };
      const filename = getMediaFilename(options, timestamp, 6);
      expect(filename).toBe('image_café-naïve-العربية-Москва-文字_1234567890');
    });
  });
});
