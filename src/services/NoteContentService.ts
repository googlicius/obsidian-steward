import { IMAGE_LINK_PATTERN } from 'src/constants';
import { App } from 'obsidian';
import { logger } from 'src/utils/logger';

export class NoteContentService {
  private static instance: NoteContentService;

  private constructor(private app: App) {}

  /**
   * Get the singleton instance of the NoteContentService
   */
  public static getInstance(app?: App): NoteContentService {
    if (app) {
      NoteContentService.instance = new NoteContentService(app);
      return NoteContentService.instance;
    }
    if (!NoteContentService.instance) {
      throw new Error('NoteContentService not initialized');
    }
    return NoteContentService.instance;
  }

  /**
   * Checks if a string is a media file based on its extension
   * @param filename The filename to check
   * @returns True if the file is a media file, false otherwise
   */
  private isMediaFile(filename: string): boolean {
    const mediaExtensions = ['.png', '.jpg', '.jpeg', '.gif', '.mp3', '.mp4', '.wav', '.webm'];
    return mediaExtensions.some(ext => filename.toLowerCase().endsWith(ext));
  }

  /**
   * Extracts wikilinks from text content
   * @param content The text content to extract wikilinks from
   * @returns Array of wikilink paths extracted from the content
   */
  public extractWikilinks(content: string): string[] {
    const wikiLinkRegex = /\[\[([^\]]+)\]\]/g;
    const matches = content.matchAll(wikiLinkRegex);
    const wikilinks: string[] = [];

    for (const match of matches) {
      if (match[1]) {
        // Skip media files
        if (!this.isMediaFile(match[1])) {
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
  public extractImageLinks(content: string): string[] {
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

  /**
   * Get content from a path, which can be a normal path, with an anchor, or with alias
   * @param linkPath The path to the file (e.g., "Note Name", "Note Name#Heading", "Note Name#Heading|Alias")
   * @returns The content of the file or section, properly escaped for YAML
   */
  public async getContentByPath(linkPath: string): Promise<string | null> {
    // Parse the link path to extract path, anchor, and alias
    let path = linkPath;
    let anchor: string | undefined;

    // Check for alias (|)
    const aliasParts = path.split('|');
    if (aliasParts.length > 1) {
      path = aliasParts[0];
      // Alias is not used currently, but we need to remove it from the path
    }

    // Check for anchor (#)
    const anchorParts = path.split('#');
    if (anchorParts.length > 1) {
      path = anchorParts[0];
      anchor = anchorParts[1];
    }

    // Try to find the file
    const file = this.app.metadataCache.getFirstLinkpathDest(path, '');

    if (!file) {
      logger.warn(`Could not resolve link: ${linkPath}`);
      return null;
    }

    try {
      // Read the file content
      const noteContent = await this.app.vault.read(file);

      // Get content based on whether there's an anchor or not
      let contentToInsert = noteContent;

      if (anchor) {
        // Extract content under the specified heading
        contentToInsert = this.extractContentUnderHeading(noteContent, anchor);
      }

      // Extract and process any wikilinks in the content
      contentToInsert = await this.processWikilinksInContent(contentToInsert);

      return contentToInsert;
    } catch (error) {
      logger.error(`Error reading file content for ${linkPath}:`, error);
      return null;
    }
  }

  /**
   * Extract content under a specific heading
   * @param content The full content to search in
   * @param headingText The heading text to find
   * @returns The content under the heading
   */
  public extractContentUnderHeading(content: string, headingText: string): string {
    const result: string[] = [];

    // Find the heading directly
    const headingRegex = new RegExp(`^(#{1,6})\\s+${this.escapeRegExp(headingText)}\\s*$`, 'm');
    const headingMatch = content.match(headingRegex);

    if (!headingMatch) {
      return '';
    }

    // Get heading level and position
    const headingLevel = headingMatch[1].length;
    const headingPosition = content.indexOf(headingMatch[0]);

    // Start iterating from the position after the heading
    const contentAfterHeading = content.substring(headingPosition + headingMatch[0].length);
    const remainingLines = contentAfterHeading.split('\n');

    // Skip the first empty line if it exists
    const startIndex = remainingLines[0].trim() === '' ? 1 : 0;

    for (let i = startIndex; i < remainingLines.length; i++) {
      const line = remainingLines[i];

      // Check if this line is a heading
      const nextHeadingMatch = line.match(/^(#{1,6})\s+(.+)$/);

      if (nextHeadingMatch) {
        const level = nextHeadingMatch[1].length; // Number of # symbols

        // If we find a heading of same or higher level, stop
        if (level <= headingLevel) {
          break;
        }
      }

      // Add this line to the result
      result.push(line);
    }

    return result.join('\n').trim();
  }

  /**
   * Process wikilinks in content and either append their content at the end or replace the wikilinks
   * @param content The content containing wikilinks
   * @param depth The maximum depth level for processing nested wikilinks (default: 1)
   * @returns The content with wikilink contents either appended or replaced
   */
  public async processWikilinksInContent(content: string, depth = 1): Promise<string> {
    // Extract wikilinks from the content
    const wikilinks = this.extractWikilinks(content);

    if (wikilinks.length === 0) {
      return content;
    }

    // Determine mode: if content is just a wikilink, use 'replace', otherwise 'append'
    const isOnlyWikilink = content.trim().match(/^\[\[([^\]]+)\]\]$/);
    const mode = isOnlyWikilink ? 'replace' : 'append';

    // Start with the original content
    let processedContent = content;
    let appendedContent = '\n\n';

    for (const wikilink of wikilinks) {
      try {
        // Find the file by path
        const file = this.app.metadataCache.getFirstLinkpathDest(wikilink.split('#')[0], '');

        if (file) {
          // Read the file content
          const linkedContent = await this.app.vault.read(file);

          // Check if there's an anchor
          const anchorParts = wikilink.split('#');
          let extractedContent = linkedContent;

          if (anchorParts.length > 1) {
            // Extract content under the specified heading
            extractedContent = this.extractContentUnderHeading(linkedContent, anchorParts[1]);
          }

          // Process nested wikilinks if depth > 1
          if (depth > 1 && this.extractWikilinks(extractedContent).length > 0) {
            extractedContent = await this.processWikilinksInContent(extractedContent, depth - 1);
          }

          if (mode === 'append') {
            // Append the content at the end in the specified format
            appendedContent += `The content of [[${wikilink}]]:\n${extractedContent}\n\n`;
          } else if (mode === 'replace') {
            // Replace the wikilink with its content
            const wikiLinkPattern = new RegExp(`\\[\\[${this.escapeRegExp(wikilink)}\\]\\]`, 'g');
            processedContent = processedContent.replace(wikiLinkPattern, extractedContent);
          }
        }
      } catch (error) {
        logger.error(`Error processing wikilink ${wikilink}:`, error);
      }
    }

    // For append mode, add all extracted content at the end of the original content
    return mode === 'append' ? processedContent + appendedContent : processedContent;
  }

  /**
   * Escape special characters in a string for use in a regular expression
   */
  private escapeRegExp(string: string): string {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  /**
   * Formats content as a callout block with the specified type and optional metadata
   * @param content The content to format in a callout
   * @param type The callout type (e.g., 'note', 'warning', 'info', 'search-result')
   * @param metadata Optional metadata to include in the callout header
   * @returns The formatted callout block
   */
  public formatCallout(
    content: string,
    type = 'search-result',
    metadata?: { [key: string]: unknown }
  ): string {
    let metadataStr = '';

    if (metadata && Object.keys(metadata).length > 0) {
      metadataStr =
        ' ' +
        Object.entries(metadata)
          .map(([key, value]) => `${key}:${value}`)
          .join(',');
    }

    return `\n>[!${type}]${metadataStr}\n${content
      .split('\n')
      .map(item => '>' + item)
      .join('\n')}\n\n`;
  }

  /**
   * Extracts content from a callout block
   * @param content The markdown content containing the callout
   * @param type The callout type to extract (e.g., 'user-message', 'search-result')
   * @returns The extracted content without the callout syntax, or null if no matching callout is found
   */
  public extractCalloutContent(content: string, type: string): string | null {
    try {
      // First, find the callout header
      const headerRegex = new RegExp(`\\>\\[!${type}\\](?:.*?)\\n`, 'i');
      const headerMatch = content.match(headerRegex);

      if (!headerMatch || headerMatch.index === undefined) {
        return null;
      }

      // Get the position after the header
      const contentStartPos = headerMatch.index + headerMatch[0].length;

      // Find the end of the callout by looking for the first line that doesn't start with '>'
      // or the end of the content
      const lines = content.substring(contentStartPos).split('\n');
      let endLine = 0;

      for (let i = 0; i < lines.length; i++) {
        if (!lines[i].startsWith('>') && lines[i].trim() !== '') {
          endLine = i;
          break;
        }

        // If we reach the end of the content, set endLine to the last line
        if (i === lines.length - 1) {
          endLine = i + 1;
        }
      }

      // Extract the callout content
      const calloutLines = lines.slice(0, endLine);

      // Remove the '>' prefix from each line
      const calloutContent = calloutLines
        .map(line => (line.startsWith('>') ? line.substring(1) : line))
        .join('\n')
        .trim();

      return calloutContent;
    } catch (error) {
      logger.error('Error extracting callout content:', error);
      return null;
    }
  }
}
