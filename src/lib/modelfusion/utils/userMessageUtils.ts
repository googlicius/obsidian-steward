import { ImagePart, TextPart } from 'modelfusion';
import { App, TFile } from 'obsidian';
import { IMAGE_LINK_PATTERN } from 'src/constants';
import { MediaTools } from 'src/tools/mediaTools';

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
			wikilinks.push(match[1]);
		}
	}

	return wikilinks;
}

export function getTextContentWithoutImages(userInput: string): string {
	// Create a new RegExp instance with flags each time to avoid stateful issues
	const imageRegex = new RegExp(IMAGE_LINK_PATTERN, 'gi');
	return userInput.replace(imageRegex, '').trim();
}

/**
 * Prepares user message content with images for OpenAI's Vision API
 * @param userInput Original user input text
 * @param app Obsidian App instance for accessing vault
 * @returns An array of content items for OpenAI's ChatMessage.user
 */
export async function prepareUserMessage(
	userInput: string,
	app: App
): Promise<Array<TextPart | ImagePart>> {
	const imagePaths = extractImageLinks(userInput);
	const wikilinks = extractWikilinks(userInput);
	const messageContent: Array<TextPart | ImagePart> = [];

	// Add the original user input first
	messageContent.push({ type: 'text', text: userInput });

	const mediaTools = MediaTools.getInstance(app);

	// Process and add images
	for (const imagePath of imagePaths) {
		try {
			const file = await mediaTools.findFileByNameOrPath(imagePath);

			if (file instanceof TFile) {
				const imageData = await app.vault.readBinary(file);
				const mimeType = getMimeTypeFromExtension(file.extension);

				messageContent.push({
					type: 'image',
					image: imageData,
					mimeType,
				});
			}
		} catch (error) {
			console.error(`Error processing image ${imagePath}:`, error);
		}
	}

	// Process and add wikilink contents
	if (wikilinks.length > 0) {
		let wikiContentText = '';

		for (const wikilink of wikilinks) {
			try {
				const file = await mediaTools.findFileByNameOrPath(wikilink);

				if (file instanceof TFile) {
					const content = await app.vault.read(file);
					wikiContentText += `\nContent of the ${wikilink} file:\n${content}\n`;
				}
			} catch (error) {
				console.error(`Error processing wikilink ${wikilink}:`, error);
			}
		}

		if (wikiContentText) {
			messageContent.push({ type: 'text', text: wikiContentText });
		}
	}

	return messageContent;
}

/**
 * Gets the MIME type from a file extension
 * @param extension The file extension
 * @returns The corresponding MIME type
 */
function getMimeTypeFromExtension(extension: string): string {
	const mimeTypes: Record<string, string> = {
		jpg: 'image/jpeg',
		jpeg: 'image/jpeg',
		png: 'image/png',
		gif: 'image/gif',
		webp: 'image/webp',
		svg: 'image/svg+xml',
	};

	return mimeTypes[extension.toLowerCase()] || 'application/octet-stream';
}
