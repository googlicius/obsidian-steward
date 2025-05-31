import { generateText } from 'modelfusion';
import { createLLMGenerator } from './llmConfig';
import { destinationFolderPrompt } from './prompts/destinationFolderPrompt';
import { userLanguagePrompt } from './prompts/languagePrompt';
import { StewardPluginSettings } from '../../types/interfaces';
import { AbortService } from '../../services/AbortService';

const abortService = AbortService.getInstance();

/**
 * Represents the extracted destination folder parameters
 */
export interface DestinationFolderExtraction {
	destinationFolder: string;
	explanation: string;
	lang?: string;
}

/**
 * Extract destination folder from a user query for moving or copying files
 * @param userInput Natural language request to move or copy files
 * @param llmConfig LLM configuration settings
 * @returns Extracted destination folder
 */
export async function extractDestinationFolder(
	userInput: string,
	llmConfig: StewardPluginSettings['llm']
): Promise<DestinationFolderExtraction> {
	try {
		// Use ModelFusion to generate the response
		const response = await generateText({
			model: createLLMGenerator(llmConfig),
			run: { abortSignal: abortService.createAbortController('destination-folder') },
			prompt: [userLanguagePrompt, destinationFolderPrompt, { role: 'user', content: userInput }],
		});

		// Parse and validate the JSON response
		const parsed = JSON.parse(response);
		return validateDestinationFolderExtraction(parsed);
	} catch (error) {
		console.error('Error extracting destination folder:', error);
		throw error;
	}
}

/**
 * Validate the extracted destination folder parameters
 * @param extraction The extracted parameters to validate
 * @returns Validated extraction object
 */
function validateDestinationFolderExtraction(extraction: any): DestinationFolderExtraction {
	if (!extraction.destinationFolder || typeof extraction.destinationFolder !== 'string') {
		throw new Error('Invalid destination folder extraction: missing or invalid destinationFolder');
	}

	if (!extraction.explanation || typeof extraction.explanation !== 'string') {
		throw new Error('Invalid destination folder extraction: missing or invalid explanation');
	}

	return {
		destinationFolder: extraction.destinationFolder,
		explanation: extraction.explanation,
		lang: extraction.lang,
	};
}
