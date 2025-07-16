import { MediaTools, MediaGenerationOptions } from './mediaTools';
import { App } from '../__mocks__/obsidian';

describe('MediaTools', () => {
  let app: App;
  let mediaTools: MediaTools;

  beforeEach(() => {
    app = new App();
    // Mock the config and attachmentFolderPath for vault
    (app.vault as any).config = { attachmentFolderPath: 'attachments' };
    mediaTools = MediaTools.getInstance(app as any);
  });

  describe('getMediaFilename', () => {
    const timestamp = 1234567890;

    it('includes prompt if 3 words or fewer, retains spaces', () => {
      const options: MediaGenerationOptions = {
        prompt: 'cat dog bird',
        type: 'image',
      };
      const filename = (mediaTools as any).getMediaFilename(options, timestamp);
      expect(filename).toBe('image_cat-dog-bird_1234567890');
    });

    it('sanitizes special characters in prompt', () => {
      const options: MediaGenerationOptions = {
        prompt: 'cat/dog*bird',
        type: 'audio',
      };
      const filename = (mediaTools as any).getMediaFilename(options, timestamp);
      expect(filename).toBe('audio_cat-dog-bird_1234567890');
    });

    it('does not include prompt if more than 3 words', () => {
      const options: MediaGenerationOptions = {
        prompt: 'this is more than three',
        type: 'image',
      };
      const filename = (mediaTools as any).getMediaFilename(options, timestamp);
      expect(filename).toBe('image_1234567890');
    });

    it('does not replace letters with diacritics and other language characters', () => {
      const options: MediaGenerationOptions = {
        prompt: 'café naïve العربية  Москва 文字',
        type: 'image',
      };
      const filename = (mediaTools as any).getMediaFilename(options, timestamp, 6);
      expect(filename).toBe('image_café-naïve-العربية-Москва-文字_1234567890');
    });
  });
});
