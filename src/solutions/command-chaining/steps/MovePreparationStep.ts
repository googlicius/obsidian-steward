import { PipelineStep, PipelineContext } from '../CommandPipeline';
import { ResultType } from '../ConversationContextManager';
import { StepType } from './StepTypes';

/**
 * Step for move preparation
 */
export const MovePreparationStep: PipelineStep = {
	type: StepType.MOVE_PREPARATION,

	execute: async (input: any, context: PipelineContext) => {
		// If we have previous search results, use them
		if (context.previousResults && context.previousResults.type === ResultType.SEARCH_RESULTS) {
			// Extract destination from the move command
			const commandContent = context.originalCommand;

			// Extract the move query with focus on destination
			const queryExtraction =
				await context.plugin.obsidianAPITools.extractMoveQuery(commandContent);

			// Use the files from the previous search results
			const searchResults = context.previousResults.data.results;

			// Map the files to the operations
			const filesByOperation = new Map<number, any[]>();
			filesByOperation.set(0, searchResults.documents);

			return {
				queryExtraction,
				filesByOperation,
			};
		} else {
			// No previous results to reference, proceed with normal move flow
			const commandContent = input.resolvedCommand || context.originalCommand;

			// Extract the move query
			const queryExtraction =
				await context.plugin.obsidianAPITools.extractMoveQuery(commandContent);

			// Get files by the query extraction
			const filesByOperation =
				await context.plugin.obsidianAPITools.getFilesByMoveQueryExtraction(queryExtraction);

			return {
				queryExtraction,
				filesByOperation,
			};
		}
	},

	handleError: async (error: Error, input: any, context: PipelineContext) => {
		await context.plugin.updateConversationNote(
			context.conversationTitle,
			`Error preparing move: ${error.message}`,
			'Steward'
		);
	},
};
