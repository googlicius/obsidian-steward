import { ImagePart, TextPart } from 'ai';
import { IMAGE_LINK_PATTERN } from 'src/constants';
import { NoteContentService } from 'src/services/NoteContentService';
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
  const wikilinks = noteContentService.extractWikilinks(input);
  const messageContent: Array<TextPart | ImagePart> = [];

  // Add the original user input first
  messageContent.push({ type: 'text', text: input });

  // Process and add images
  const images = await noteContentService.getImagesFromInput(input);
  for (const [path, imagePart] of images) {
    messageContent.push({ type: 'text', text: path }, imagePart);
  }

  // Process and add wikilink contents
  if (wikilinks.length > 0) {
    for (const wikilink of wikilinks) {
      try {
        const file = await plugin.mediaTools.findFileByNameOrPath(wikilink);

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
