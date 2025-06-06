import { generateText } from 'modelfusion';
import { userLanguagePrompt } from '../prompts/languagePrompt';
import { searchPromptV2 } from '../prompts/searchPromptV2';
import { confidenceScorePrompt } from '../prompts/confidenceScorePrompt';
import { validateLanguage, validateConfidence } from '../validators';
import { getObsidianLanguage } from 'src/utils/getObsidianLanguage';
import { logger } from 'src/utils/logger';
import { getTranslation } from 'src/i18n';
import { StewardPluginSettings } from 'src/types/interfaces';
import { createLLMGenerator } from '../llmConfig';
import { AbortService } from 'src/services/AbortService';

const abortService = AbortService.getInstance();

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
 * @param llmConfig LLM configuration settings
 * @param systemPrompts System prompts to add to the prompt
 * @param lang The language of the user
 * @returns Extracted search parameters and explanation
 */
export async function extractSearchQueryV2({
	userInput,
	systemPrompts = [],
	llmConfig,
	lang,
}: {
	userInput: string;
	llmConfig: StewardPluginSettings['llm'];
	systemPrompts?: string[];
	lang?: string;
}): Promise<SearchQueryExtractionV2> {
	// Check if input is wrapped in quotation marks for direct search
	const quotedRegex = /^["'](.+)["']$/;
	const match = userInput.trim().match(quotedRegex);

	const t = getTranslation(lang);

	if (match) {
		const searchTerm = match[1];
		return {
			operations: [
				{
					keywords: [`"${searchTerm}"`],
					tags: [],
					filenames: [],
					folders: [],
				},
			],
			explanation: t('search.searchingFor', { searchTerm }),
			lang: lang || getObsidianLanguage(),
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
			explanation: t('search.searchingForTags', {
				tags: tags.map(tag => `#${tag}`).join(', '),
			}),
			lang: lang || getObsidianLanguage(),
			confidence: 1,
		};
	}

	try {
		// Use ModelFusion to generate the response
		const response = await generateText({
			model: createLLMGenerator(llmConfig),
			run: { abortSignal: abortService.createAbortController('search-query-v2') },
			prompt: [
				userLanguagePrompt,
				searchPromptV2,
				...systemPrompts.map(prompt => ({ role: 'system', content: prompt })),
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
			logger.error(`Operation ${index}: keywords must be an array`);
			op.keywords = [];
		}
		if (!Array.isArray(op.tags)) {
			logger.error(`Operation ${index}: tags must be an array`);
			op.tags = [];
		}
		if (!Array.isArray(op.filenames)) {
			logger.error(`Operation ${index}: filenames must be an array`);
			op.filenames = [];
		}
		if (!Array.isArray(op.folders)) {
			logger.error(`Operation ${index}: folders must be an array`);
			op.folders = [];
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
