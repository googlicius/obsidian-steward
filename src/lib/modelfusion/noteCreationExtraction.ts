import { generateText } from 'modelfusion';
import { createLLMGenerator } from './llmConfig';
import { noteCreationPrompt } from './prompts/noteCreationPrompt';
import { userLanguagePrompt } from './prompts/languagePrompt';
import { confidenceScorePrompt } from './prompts/confidenceScorePrompt';
import { StewardPluginSettings } from '../../types/interfaces';
import { AbortService } from '../../services/AbortService';

const abortService = AbortService.getInstance();

export interface NoteDetails {
	noteName: string;
	content: string;
}

export interface NoteCreationExtraction {
	notes: NoteDetails[];
	explanation: string;
	confidence: number;
}

/**
 * Extract note creation details from a user query
 * @param userInput Natural language request from the user
 * @param llmConfig LLM configuration settings
 * @returns Extracted note details, explanation, and confidence
 */
export async function extractNoteCreation(
	userInput: string,
	llmConfig: StewardPluginSettings['llm']
): Promise<NoteCreationExtraction> {
	try {
		const response = await generateText({
			model: createLLMGenerator(llmConfig),
			run: { abortSignal: abortService.createAbortController('note-creation') },
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

	if (!Array.isArray(data.notes)) {
		throw new Error('Notes must be an array');
	}

	if (data.notes.length === 0) {
		throw new Error('At least one note must be specified');
	}

	// Validate each note in the array
	for (const note of data.notes) {
		if (!note || typeof note !== 'object') {
			throw new Error('Each note must be an object');
		}

		// noteName is required for note creation
		if (typeof note.noteName !== 'string' || !note.noteName.trim()) {
			throw new Error('Note name must be a non-empty string');
		}

		// content is optional for note creation (can be empty string)
		if (typeof note.content !== 'string') {
			throw new Error('Content must be a string');
		}
	}

	if (typeof data.explanation !== 'string' || !data.explanation.trim()) {
		throw new Error('Explanation must be a non-empty string');
	}

	if (typeof data.confidence !== 'number' || data.confidence < 0 || data.confidence > 1) {
		throw new Error('Confidence must be a number between 0 and 1');
	}

	return {
		notes: data.notes,
		explanation: data.explanation,
		confidence: data.confidence,
	};
}
