import { generateText } from 'modelfusion';
import { StewardPluginSettings } from '../../types/interfaces';
import { createLLMGenerator } from './llmConfig';
import { contentReadingPrompt } from './prompts/contentReadingPrompt';
import { userLanguagePrompt } from './prompts/languagePrompt';
import { logger } from '../../utils/logger';

/**
 * Content reading extraction result
 */
export interface ContentReadingExtraction {
	readType: 'selected' | 'above' | 'below' | 'entire';
	/**
	 * Element type to look for. Supports AND/OR conditions:
	 *  - For OR conditions, use comma-separated values (e.g., "table, code")
	 *  - For AND conditions, use "+" between types (e.g., "paragraph+list")
	 *  - Can combine both: "paragraph+list, code+table" means (paragraph AND list) OR (code AND table)
	 */
	elementType: string | null;
	blocksToRead: number;
	foundPlaceholder: string;
	confidence: number;
	explanation: string;
	lang?: string;
}

/**
 * Extract content reading instructions from user input
 * @param userInput The user's input
 * @param llmConfig The LLM configuration
 * @returns Content reading extraction
 */
export async function extractContentReading(
	userInput: string,
	llmConfig: StewardPluginSettings['llm'],
	lang?: string
): Promise<ContentReadingExtraction> {
	try {
		logger.log('Extracting content reading from user input');

		// Generate the response using the LLM
		const response = await generateText({
			model: createLLMGenerator(llmConfig),
			prompt: [userLanguagePrompt, contentReadingPrompt, { role: 'user', content: userInput }],
		});

		// Parse and validate the JSON response
		const parsed = JSON.parse(response);

		// Validate and ensure the response has the required fields
		const result: ContentReadingExtraction = {
			readType: validateReadType(parsed.readType),
			elementType: parsed.elementType,
			blocksToRead: validateBlocksToRead(parsed.blocksToRead),
			foundPlaceholder: parsed.foundPlaceholder,
			confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0.5,
			explanation: parsed.explanation || 'Content reading extraction',
			lang: parsed.lang,
		};

		logger.log('Content reading extraction result:', result);
		return result;
	} catch (error) {
		logger.error('Error extracting content reading:', error);
		// Return a default extraction if there's an error
		return {
			readType: 'above',
			elementType: null,
			blocksToRead: 1,
			foundPlaceholder: '',
			confidence: 0.5,
			explanation: 'Failed to extract content reading instructions',
		};
	}
}

/**
 * Validate the read type
 * @param readType The read type to validate
 * @returns A valid read type
 */
function validateReadType(readType: string): ContentReadingExtraction['readType'] {
	const validReadTypes: ContentReadingExtraction['readType'][] = [
		'selected',
		'above',
		'below',
		'entire',
	];

	if (validReadTypes.includes(readType as ContentReadingExtraction['readType'])) {
		return readType as ContentReadingExtraction['readType'];
	}

	return 'above';
}

/**
 * Validate the blocks to read count
 * @param blocksToRead The number of blocks to read
 * @returns A valid blocks count
 */
function validateBlocksToRead(blocksToRead: any): number {
	if (typeof blocksToRead === 'number' && blocksToRead > 0) {
		return Math.min(Math.round(blocksToRead), 20); // Cap at 20 blocks for safety
	}
	return 1; // Default to 1 block
}
