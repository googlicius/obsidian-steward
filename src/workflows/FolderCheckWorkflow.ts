import {
	WorkflowContext,
	WorkflowStep,
	WorkflowStepResult,
	WorkflowDefinition,
} from './WorkflowEngine';
import { UpdateConversationStep, FolderExistenceStep, CreateFolderStep } from './CommonSteps';
import StewardPlugin from '../main';

/**
 * A sample step that gets a folder path from user input
 */
class ParseFolderPathStep extends WorkflowStep {
	constructor(options: { id: string; name?: string }) {
		super({
			id: options.id,
			name: options.name,
		});
	}

	async run(input: string, context: WorkflowContext): Promise<WorkflowStepResult> {
		try {
			// Simple parsing - in a real implementation this might use AI
			// to extract a folder path from a natural language query
			const folderPathMatch = input.match(/folder\s+(?:path\s+)?[`'""]?([^`'""]+)[`'""]?/i);
			let folderPath = folderPathMatch ? folderPathMatch[1].trim() : null;

			// If no match found, use a default path or the input itself
			if (!folderPath) {
				if (input.includes('/')) {
					// Assume the input might be a direct path
					folderPath = input.trim();
				} else {
					// No clear folder path found
					return {
						success: false,
						output: null,
						error: new Error('Could not determine a folder path from your input.'),
					};
				}
			}

			// Normalize path
			folderPath = folderPath.replace(/\\/g, '/');

			return {
				success: true,
				output: {
					folderPath,
					originalInput: input,
				},
			};
		} catch (error) {
			return {
				success: false,
				output: null,
				error,
			};
		}
	}
}

/**
 * Creates a folder check workflow that verifies if a folder exists
 * and offers to create it if it doesn't
 */
export function createFolderCheckWorkflow(plugin: StewardPlugin): WorkflowDefinition {
	return {
		id: 'folder_check',
		name: 'Folder Check & Creation',
		steps: [
			// Step 1: Parse the folder path from user input
			new ParseFolderPathStep({
				id: 'parse_folder_path',
				name: 'Parse Folder Path',
			}),

			// Step 2: Update the conversation with initial response
			new UpdateConversationStep({
				id: 'initial_response',
				getMessage: input => `I'll check if the folder \`${input.folderPath}\` exists.`,
			}),

			// Step 3: Check if the folder exists and ask for confirmation if not
			new FolderExistenceStep({
				id: 'check_folder_existence',
				getFolderPath: input => input.folderPath,
			}),

			// Step 4: Create the folder if confirmed
			new CreateFolderStep({
				id: 'create_folder',
				getFolderPath: input => input.folderPath,
			}),

			// Step 5: Final response
			new UpdateConversationStep({
				id: 'final_response',
				getMessage: (input, context) =>
					`The folder \`${input.folderPath}\` is now available for use.`,
			}),
		],
	};
}
