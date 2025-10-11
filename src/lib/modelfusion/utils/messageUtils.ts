import { ImagePart, TextPart } from 'ai';
import { IMAGE_LINK_PATTERN } from 'src/constants';
import { MediaTools } from 'src/tools/mediaTools';
import { NoteContentService } from 'src/services/NoteContentService';
import { resizeImageWithCanvas } from 'src/utils/resizeImageWithCanvas';
import { logger } from 'src/utils/logger';
import type StewardPlugin from 'src/main';

export function getTextContentWithoutImages(input: string): string {
  // Create a new RegExp instance with flags each time to avoid stateful issues
  const imageRegex = new RegExp(IMAGE_LINK_PATTERN, 'gi');
  return input.replace(imageRegex, '').trim();
}

/**
 * Prepares message content with images and wikilinks's content
 * @param input Original input text
 * @param plugin StewardPlugin instance for accessing vault and services
 */
export async function prepareMessage(
  input: string,
  plugin: StewardPlugin
): Promise<Array<TextPart | ImagePart>> {
  const noteContentService = NoteContentService.getInstance(plugin);
  const imagePaths = noteContentService.extractImageLinks(input);
  const wikilinks = noteContentService.extractWikilinks(input);
  const messageContent: Array<TextPart | ImagePart> = [];

  // Add the original user input first
  messageContent.push({ type: 'text', text: input });

  const mediaTools = MediaTools.getInstance(plugin.app);

  // Process and add images
  for (const imagePath of imagePaths) {
    try {
      const file = await mediaTools.findFileByNameOrPath(imagePath);

      if (file) {
        const imageData = await plugin.app.vault.readBinary(file);
        const mimeType = getMimeTypeFromExtension(file.extension);

        if (mimeType) {
          // Resize the image to reduce size using Canvas API
          const resizedImage = await resizeImageWithCanvas(imageData, 800, 0.8);
          messageContent.push({
            type: 'image',
            image: resizedImage.imageData,
            mimeType: resizedImage.mimeType,
          });
        }
      }
    } catch (error) {
      logger.error(`Error processing image ${imagePath}:`, error);
    }
  }

  // Process and add wikilink contents
  if (wikilinks.length > 0) {
    for (const wikilink of wikilinks) {
      try {
        const file = await mediaTools.findFileByNameOrPath(wikilink);

        if (file) {
          const content = await plugin.app.vault.cachedRead(file);
          messageContent.push({
            type: 'text',
            text: `Content of the "${wikilink}" note:\n${content}\n`,
          });
        }
      } catch (error) {
        logger.error(`Error processing wikilink ${wikilink}:`, error);
      }
    }
  }

  return messageContent;
}

/**
 * Gets the MIME type from a file extension
 * @param extension The file extension
 * @returns The corresponding MIME type
 */
function getMimeTypeFromExtension(extension: string): string | undefined {
  const mimeTypes: Record<string, string> = {
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    gif: 'image/gif',
    webp: 'image/webp',
    svg: 'image/svg+xml',
  };

  return mimeTypes[extension.toLowerCase()];
}
