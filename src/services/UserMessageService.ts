import type { ImagePart, TextPart } from 'ai';
import { IMAGE_EXTENSIONS, IMAGE_LINK_PATTERN, STW_SOURCE_AT_PATH_PATTERN } from 'src/constants';
import type StewardPlugin from 'src/main';
import { logger } from 'src/utils/logger';
import { decodePath } from 'src/utils/pathEncoding';
import { resizeImageWithCanvas } from 'src/utils/resizeImageWithCanvas';

export class UserMessageService {
  static instance: UserMessageService;

  private constructor(private plugin: StewardPlugin) {}

  static getInstance(plugin?: StewardPlugin): UserMessageService {
    if (plugin) {
      UserMessageService.instance = new UserMessageService(plugin);
      return UserMessageService.instance;
    }
    if (!UserMessageService.instance) {
      throw new Error('UserMessageService not initialized');
    }
    return UserMessageService.instance;
  }

  /**
   * Removes image links from text content
   */
  public getTextContentWithoutImages(input: string): string {
    // Create a new RegExp instance with flags each time to avoid stateful issues
    const imageRegex = new RegExp(IMAGE_LINK_PATTERN, 'gi');
    return input.replace(imageRegex, '').trim();
  }

  /**
   * Attaches metadata to the query if available in conversation frontmatter
   */
  public async attachMetadataToQuery(query: string, conversationTitle?: string): Promise<string> {
    if (!conversationTitle) {
      return query;
    }

    const currentNote = await this.plugin.conversationRenderer.getConversationProperty<string>(
      conversationTitle,
      'current_note'
    );

    let metadata = '';

    if (currentNote) {
      metadata = ['---', `current_note: ${currentNote}`, '---'].join('\n');
    }

    return metadata ? `${metadata}\n\n${query}` : query;
  }

  /**
   * Prepares message content with images
   * @param input Original input text
   */
  public async prepareMessage(input: string): Promise<Array<TextPart | ImagePart>> {
    const messageContent: Array<TextPart | ImagePart> = [];

    // Add the original user input first
    messageContent.push({ type: 'text', text: input });

    return messageContent;
  }

  /**
   * Sanitize the query: trim outer whitespace, collapse horizontal whitespace
   * within each line, preserve line breaks. Short `@path` datasource references
   * are stripped of the leading `@` and URL-decoded so the LLM sees a clean
   * path (e.g. `@Notes/My%20Note.md` -> `Notes/My Note.md`). Only tokens that
   * match STW_SOURCE_AT_PATH_PATTERN and are preceded by whitespace or line
   * start are rewritten; stray `@` characters are left untouched.
   */
  public sanitizeQuery(query: string): string {
    const atRefRegex = new RegExp('(^|\\s)' + STW_SOURCE_AT_PATH_PATTERN, 'g');
    return query
      .split(/\r\n|\r|\n/)
      .map(line => line.replace(/[ \t]+/g, ' ').trim())
      .join('\n')
      .replace(atRefRegex, (_match, leading: string, encodedPath: string) => {
        return `${leading}${decodePath(encodedPath)}`;
      })
      .trim();
  }

  public async getImagePartsFromPaths(paths: string[]): Promise<Array<[string, ImagePart]>> {
    const imageParts: Array<[string, ImagePart]> = [];

    for (const path of paths) {
      try {
        const file = await this.plugin.mediaTools.findFileByNameOrPath(path);

        if (file) {
          const imageData = await this.plugin.app.vault.readBinary(file);

          // Resize the image to reduce size using Canvas API
          const resizedImage = await resizeImageWithCanvas(imageData, 800, 0.8);
          imageParts.push([
            path,
            {
              type: 'image',
              image: resizedImage.imageData,
              mediaType: resizedImage.mimeType,
            },
          ]);
        } else {
          logger.warn(`File not found for image ${path}`);
        }
      } catch (error) {
        logger.error(`Error processing image ${path}:`, error);
      }
    }

    return imageParts;
  }

  public hasReadableContent(query: string): boolean {
    const readableExtensions = ['md', ...IMAGE_EXTENSIONS].join('|');
    // Pattern: filename characters (alphanumeric, underscore, hyphen) followed by dot and extension
    const readableContentPattern = new RegExp(`[a-zA-Z0-9_-]+\\.(${readableExtensions})`, 'i');
    return readableContentPattern.test(query);
  }
}
