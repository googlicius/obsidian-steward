import { generateText } from 'modelfusion';
import { createLLMGenerator } from './llmConfig';
import { noteCreationPrompt } from './prompts/noteCreationPrompt';
import { userLanguagePrompt } from './prompts/languagePrompt';
import { confidenceScorePrompt } from './prompts/confidenceScorePrompt';
import { StewardPluginSettings } from '../../types/interfaces';

export interface NoteCreationExtraction {
	noteName: string;
	content: string;
	contentSource: 'user-given' | 'generated';
	explanation: string;
	confidence: number;
}

/**
 * Extract note creation details from a user query
 * @param userInput Natural language request from the user
 * @param llmConfig LLM configuration settings
 * @returns Extracted note name, content, content source, and explanation
 */
export async function extractNoteCreation(
	userInput: string,
	llmConfig: StewardPluginSettings['llm']
): Promise<NoteCreationExtraction> {
	try {
		const response = await generateText({
			model: createLLMGenerator(llmConfig),
			prompt: [
				userLanguagePrompt,
				confidenceScorePrompt,
				noteCreationPrompt,
				{ role: 'user', content: userInput },
			],
		});

		// Parse and validate the JSON response
		const parsed = JSON.parse(response);
		return validateNoteCreationExtraction(parsed);
	} catch (error) {
		console.error('Error extracting note creation details:', error);
		throw error;
	}
}

/**
 * Validate that the note creation extraction contains all required fields
 */
function validateNoteCreationExtraction(data: any): NoteCreationExtraction {
	if (!data || typeof data !== 'object') {
		throw new Error('Invalid response format');
	}

	if (typeof data.noteName !== 'string' || !data.noteName.trim()) {
		throw new Error('Note name must be a non-empty string');
	}

	if (typeof data.content !== 'string' || !data.content.trim()) {
		throw new Error('Content must be a non-empty string');
	}

	if (data.contentSource !== 'user-given' && data.contentSource !== 'generated') {
		throw new Error('Content source must be either "user-given" or "generated"');
	}

	if (typeof data.explanation !== 'string' || !data.explanation.trim()) {
		throw new Error('Explanation must be a non-empty string');
	}

	if (typeof data.confidence !== 'number' || data.confidence < 0 || data.confidence > 1) {
		throw new Error('Confidence must be a number between 0 and 1');
	}

	return {
		noteName: data.noteName.trim(),
		content: data.content.trim(),
		contentSource: data.contentSource,
		explanation: data.explanation.trim(),
		confidence: data.confidence,
	};
}
