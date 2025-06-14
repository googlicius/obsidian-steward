import { generateText } from 'modelfusion';
import { createLLMGenerator } from '../llmConfig';
import { noteGenerationPrompt } from '../prompts/noteGenerationPrompt';
import { userLanguagePrompt } from '../prompts/languagePrompt';
import { confidenceScorePrompt } from '../prompts/confidenceScorePrompt';
import { StewardPluginSettings } from 'src/types/interfaces';
import { AbortService } from 'src/services/AbortService';

const abortService = AbortService.getInstance();
export interface NoteGenerationExtraction {
	noteName?: string;
	instructions: string;
	style?: string;
	explanation: string;
	confidence: number;
	modifiesNote: boolean;
}

/**
 * Extract note generation details from a user query
 * @param params Parameters for the note generation extraction
 * @returns Extracted note name, instructions, style preferences, and explanation
 */
export async function extractNoteGeneration(params: {
	userInput: string;
	systemPrompts?: string[];
	llmConfig: StewardPluginSettings['llm'];
	recentlyCreatedNote?: string;
}): Promise<NoteGenerationExtraction> {
	const { userInput, systemPrompts = [], llmConfig, recentlyCreatedNote } = params;
	try {
		const response = await generateText({
			model: createLLMGenerator(llmConfig),
			run: { abortSignal: abortService.createAbortController('note-generation') },
			prompt: [
				userLanguagePrompt,
				confidenceScorePrompt,
				noteGenerationPrompt,
				...systemPrompts.map(prompt => ({ role: 'system', content: prompt })),
				{
					role: 'system',
					content: recentlyCreatedNote
						? `The user has recently created a note: ${recentlyCreatedNote}. If no specific note is mentioned, you can assume they want to generate content in this note.`
						: '',
				},
				{ role: 'user', content: userInput },
			],
		});

		// Parse and validate the JSON response
		const parsed = JSON.parse(response);

		// If no note name is provided but there's a recently created note, use that
		if ((!parsed.noteName || parsed.noteName === '') && recentlyCreatedNote) {
			parsed.noteName = recentlyCreatedNote;
			parsed.explanation = `${parsed.explanation} Using the recently created note: ${recentlyCreatedNote}`;
		}

		return validateNoteGenerationExtraction(parsed);
	} catch (error) {
		console.error('Error extracting note generation details:', error);
		throw error;
	}
}

/**
 * Validate that the note generation extraction contains all required fields
 */
function validateNoteGenerationExtraction(data: any): NoteGenerationExtraction {
	if (!data || typeof data !== 'object') {
		throw new Error('Invalid response format');
	}

	// noteName is optional, but if provided, must be a valid string
	if (data.noteName !== undefined && data.noteName !== null && typeof data.noteName !== 'string') {
		throw new Error('Note name must be a string or null');
	}

	if (typeof data.instructions !== 'string' || !data.instructions.trim()) {
		throw new Error('Instructions must be a non-empty string');
	}

	// style is optional, but if provided, must be a valid string
	if (data.style !== undefined && typeof data.style !== 'string') {
		data.style = ''; // Default to empty string if invalid
	}

	if (typeof data.explanation !== 'string' || !data.explanation.trim()) {
		throw new Error('Explanation must be a non-empty string');
	}

	if (typeof data.confidence !== 'number' || data.confidence < 0 || data.confidence > 1) {
		throw new Error('Confidence must be a number between 0 and 1');
	}

	if (typeof data.modifiesNote !== 'boolean') {
		throw new Error('modifiesNote must be a boolean');
	}

	return {
		noteName: data.noteName,
		instructions: data.instructions,
		style: data.style,
		explanation: data.explanation,
		confidence: data.confidence,
		modifiesNote: data.modifiesNote,
	};
}
