import { generateText, openai } from 'modelfusion';
import { userLanguagePrompt } from './prompts/languagePrompt';
import { searchPromptV2 } from './prompts/searchPromptV2';
import { confidenceScorePrompt } from './prompts/confidenceScorePrompt';
import { validateLanguage, validateConfidence } from './validators';
import { getObsidianLanguage } from '../../utils/getObsidianLanguage';

/**
 * Represents a single search operation with v2 parameters
 */
export interface SearchOperationV2 {
	keywords: string[];
	tags: string[];
	filenames: string[];
	folders: string[];
}

/**
 * Represents the extracted search parameters from a natural language request (v2)
 */
export interface SearchQueryExtractionV2 {
	operations: SearchOperationV2[];
	explanation: string;
	lang?: string;
	confidence: number;
}

/**
 * Extract search parameters from a natural language request using AI (v2)
 * @param userInput Natural language request from the user
 * @returns Extracted search parameters and explanation
 */
export async function extractSearchQueryV2(userInput: string): Promise<SearchQueryExtractionV2> {
	// Check if input is wrapped in quotation marks for direct search
	const quotedRegex = /^["'](.+)["']$/;
	const match = userInput.trim().match(quotedRegex);

	if (match) {
		const searchTerm = match[1];
		return {
			operations: [
				{
					keywords: [searchTerm],
					tags: [],
					filenames: [],
					folders: [],
				},
			],
			explanation: `Searching for "${searchTerm}"`,
			lang: getObsidianLanguage(),
			confidence: 1,
		};
	}

	// Check if input only contains tags
	const trimmedInput = userInput.trim();
	const tagRegex = /#([^\s#]+)/g;
	const tags = [...trimmedInput.matchAll(tagRegex)].map(match => match[1]);

	// If the input only contains tags (after removing tag patterns, only whitespace remains)
	if (tags.length > 0 && trimmedInput.replace(tagRegex, '').trim() === '') {
		return {
			operations: [
				{
					keywords: [],
					tags,
					filenames: [],
					folders: [],
				},
			],
			explanation: `Searching for tags: ${tags.map(tag => `#${tag}`).join(', ')}`,
			lang: getObsidianLanguage(),
			confidence: 1,
		};
	}

	try {
		// Use ModelFusion to generate the response
		const response = await generateText({
			model: openai.ChatTextGenerator({
				model: 'gpt-4-turbo-preview',
				temperature: 0.2,
				responseFormat: { type: 'json_object' },
			}),
			prompt: [
				userLanguagePrompt,
				searchPromptV2,
				confidenceScorePrompt,
				{ role: 'user', content: userInput },
			],
		});

		// Parse and validate the JSON response
		const parsed = JSON.parse(response);
		return validateSearchQueryExtractionV2(parsed);
	} catch (error) {
		console.error('Error extracting search query:', error);
		throw error;
	}
}

/**
 * Validate that the search query extraction v2 contains all required fields
 */
function validateSearchQueryExtractionV2(data: any): SearchQueryExtractionV2 {
	if (!data || typeof data !== 'object') {
		throw new Error('Invalid response format');
	}

	if (!Array.isArray(data.operations)) {
		throw new Error('Operations must be an array');
	}

	// Validate each operation
	data.operations.forEach((op: any, index: number) => {
		if (!Array.isArray(op.keywords)) {
			throw new Error(`Operation ${index}: keywords must be an array`);
		}
		if (!Array.isArray(op.tags)) {
			throw new Error(`Operation ${index}: tags must be an array`);
		}
		if (!Array.isArray(op.filenames)) {
			throw new Error(`Operation ${index}: filenames must be an array`);
		}
		if (!Array.isArray(op.folders)) {
			throw new Error(`Operation ${index}: folders must be an array`);
		}
	});

	if (typeof data.explanation !== 'string' || !data.explanation.trim()) {
		throw new Error('Explanation must be a non-empty string');
	}

	const lang = validateLanguage(data.lang);
	const confidence = validateConfidence(data.confidence);

	// Create a validated result
	const result: SearchQueryExtractionV2 = {
		operations: data.operations,
		explanation: data.explanation,
		lang,
		confidence,
	};

	return result;
}
