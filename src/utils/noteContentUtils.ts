import { IMAGE_LINK_PATTERN } from 'src/constants';

/**
 * Checks if a string is a media file based on its extension
 * @param filename The filename to check
 * @returns True if the file is a media file, false otherwise
 */
function isMediaFile(filename: string): boolean {
  const mediaExtensions = ['.png', '.jpg', '.jpeg', '.gif', '.mp3', '.mp4', '.wav', '.webm'];
  return mediaExtensions.some(ext => filename.toLowerCase().endsWith(ext));
}

/**
 * Extracts wikilinks from text content
 * @param content The text content to extract wikilinks from
 * @returns Array of wikilink paths extracted from the content
 */
export function extractWikilinks(content: string): string[] {
  const wikiLinkRegex = /\[\[([^\]]+)\]\]/g;
  const matches = content.matchAll(wikiLinkRegex);
  const wikilinks: string[] = [];

  for (const match of matches) {
    if (match[1]) {
      // Skip media files
      if (!isMediaFile(match[1])) {
        wikilinks.push(match[1]);
      }
    }
  }

  return wikilinks;
}

/**
 * Extracts image links from text content
 * @param content The text content to extract image links from
 * @returns Array of image paths extracted from the content
 */
export function extractImageLinks(content: string): string[] {
  // Create a new RegExp instance with flags each time to avoid stateful issues
  const imageRegex = new RegExp(IMAGE_LINK_PATTERN, 'gi');
  const matches = content.matchAll(imageRegex);
  const imagePaths: string[] = [];

  for (const match of matches) {
    if (match[1]) {
      imagePaths.push(match[1]);
    }
  }

  return imagePaths;
}
