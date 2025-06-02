import { generateText } from 'modelfusion';
import { mediaCommandPrompt } from './prompts/mediaCommandPrompt';
import { userLanguagePrompt } from './prompts/languagePrompt';
import { confidenceScorePrompt } from './prompts/confidenceScorePrompt';
import { validateLanguage, validateConfidence } from './validators';
import { getObsidianLanguage } from '../../utils/getObsidianLanguage';
import { AbortService } from '../../services/AbortService';
import { StewardPluginSettings } from 'src/types/interfaces';
import { createLLMGenerator } from './llmConfig';

// Get the singleton instance of AbortService
const abortService = AbortService.getInstance();

/**
 * Represents the extracted media generation parameters
 */
export interface MediaCommandExtraction {
	type?: 'image' | 'audio';
	text: string;
	voice?: string;
	model?: string;
	size?: string;
	quality?: 'standard' | 'hd';
	explanation: string;
	lang?: string;
	confidence: number;
}

/**
 * Extract media generation parameters from a user query
 * @param userInput Natural language request for media generation
 * @returns Extracted media generation parameters
 */
export async function extractMediaCommand(
	userInput: string,
	llmConfig: StewardPluginSettings['llm'],
	type?: 'image' | 'audio'
): Promise<MediaCommandExtraction> {
	// Check if input is wrapped in quotation marks for direct extraction
	const quotedRegex = /^["'](.+)["']$/;
	const match = userInput.trim().match(quotedRegex);

	if (match) {
		const content = match[1];

		return {
			text: content,
			explanation: `Generating media with content: "${content}"`,
			lang: getObsidianLanguage(),
			confidence: 1,
		};
	}

	userInput = type ? `/${type} ${userInput}` : userInput;

	try {
		// Create an operation-specific abort signal
		const abortSignal = abortService.createAbortController('media-extraction');

		// Use ModelFusion to generate the response
		const response = await generateText({
			model: createLLMGenerator(llmConfig),
			run: { abortSignal },
			prompt: [
				userLanguagePrompt,
				mediaCommandPrompt,
				confidenceScorePrompt,
				{ role: 'user', content: userInput },
			],
		});

		// Parse and validate the JSON response
		const parsed = JSON.parse(response);
		return validateMediaCommandExtraction(parsed);
	} catch (error) {
		console.error('Error extracting media command:', error);
		throw error;
	}
}

/**
 * Validate that the media command extraction contains all required fields
 */
function validateMediaCommandExtraction(data: any): MediaCommandExtraction {
	if (!data || typeof data !== 'object') {
		throw new Error('Invalid response format');
	}

	if (data.type !== 'image' && data.type !== 'audio') {
		throw new Error('Type must be either "image" or "audio"');
	}

	if (typeof data.text !== 'string' || !data.text.trim()) {
		throw new Error('Text must be a non-empty string');
	}

	// Validate image-specific fields
	if (data.type === 'image') {
		if (data.size && typeof data.size !== 'string') {
			throw new Error('Size must be a string');
		}
		if (data.quality && data.quality !== 'standard' && data.quality !== 'hd') {
			throw new Error('Quality must be either "standard" or "hd"');
		}
		if (data.model && !['dall-e-2', 'dall-e-3'].includes(data.model)) {
			throw new Error('Model must be either "dall-e-2" or "dall-e-3"');
		}
	}

	// Validate audio-specific fields
	if (data.type === 'audio') {
		if (data.voice && typeof data.voice !== 'string') {
			throw new Error('Voice must be a string');
		}
		if (data.model && !['openai', 'elevenlabs'].includes(data.model)) {
			throw new Error('Model must be either "openai" or "elevenlabs"');
		}
	}

	if (typeof data.explanation !== 'string' || !data.explanation.trim()) {
		throw new Error('Explanation must be a non-empty string');
	}

	const lang = validateLanguage(data.lang);
	const confidence = validateConfidence(data.confidence);

	return {
		type: data.type,
		text: data.text.trim(),
		size: data.size,
		quality: data.quality,
		voice: data.voice,
		model: data.model,
		explanation: data.explanation.trim(),
		lang,
		confidence,
	};
}
