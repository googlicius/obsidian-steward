import { generateText } from 'modelfusion';
import { imageCommandPrompt } from './prompts/imageCommandPrompt';
import { StewardPluginSettings } from 'src/types/interfaces';
import { createLLMGenerator } from './llmConfig';
import { validateConfidence, validateLanguage } from './validators';
import { AbortService } from '../../services/AbortService';
import { userLanguagePrompt } from './prompts/languagePrompt';

const abortService = AbortService.getInstance();

/**
 * Represents the extracted image generation details
 */
export interface ImageExtraction {
	text: string;
	size?: string;
	quality?: string;
	model?: string;
	explanation: string;
	confidence?: number;
	lang?: string;
}

/**
 * Extract image generation details from a user query
 * @param userInput Natural language request for image generation
 * @returns Extracted image generation details
 */
export async function extractImageQuery(
	userInput: string,
	llmConfig: StewardPluginSettings['llm']
): Promise<ImageExtraction> {
	try {
		const response = await generateText({
			model: createLLMGenerator(llmConfig),
			run: { abortSignal: abortService.createAbortController('image') },
			prompt: [
				userLanguagePrompt,
				imageCommandPrompt,
				{
					role: 'user',
					content: userInput,
				},
			],
		});

		// Parse and validate the JSON response
		const parsed = JSON.parse(response);
		return validateImageExtraction(parsed);
	} catch (error) {
		console.error('Error extracting image generation parameters:', error);
		throw error;
	}
}

/**
 * Validate that the image extraction contains all required fields
 */
function validateImageExtraction(data: any): ImageExtraction {
	if (!data || typeof data !== 'object') {
		throw new Error('Invalid response format');
	}

	if (typeof data.text !== 'string' || !data.text.trim()) {
		throw new Error('Text must be a non-empty string');
	}

	if (typeof data.explanation !== 'string' || !data.explanation.trim()) {
		throw new Error('Explanation must be a non-empty string');
	}

	// Optional fields
	const size = data.size && typeof data.size === 'string' ? data.size.trim() : undefined;
	const quality =
		data.quality && typeof data.quality === 'string' ? data.quality.trim() : undefined;
	const model = data.model && typeof data.model === 'string' ? data.model.trim() : undefined;
	const confidence =
		data.confidence !== undefined ? validateConfidence(data.confidence) : undefined;
	const lang = data.lang ? validateLanguage(data.lang) : undefined;

	return {
		text: data.text.trim(),
		size,
		quality,
		model,
		explanation: data.explanation.trim(),
		confidence,
		lang,
	};
}
