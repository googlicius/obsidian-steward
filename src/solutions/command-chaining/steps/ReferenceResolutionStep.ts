import { PipelineStep, PipelineContext } from '../CommandPipeline';
import { ResultType } from '../ConversationContextManager';
import { GeneratorText } from '../../../main';
import { getTranslation } from '../../../i18n';
import { ConversationContextManager } from '../ConversationContextManager';
import { StepType } from './StepTypes';

/**
 * Step for resolving references to previous results
 */
export const ReferenceResolutionStep: PipelineStep = {
	type: StepType.REFERENCE_RESOLUTION,

	shouldExecute: async (input: string, context: PipelineContext) => {
		// Check if the command references previous results
		return ConversationContextManager.hasPreviousResultReference(input);
	},

	execute: async (input: string, context: PipelineContext) => {
		// Determine what type of previous result we need based on the current command type
		let requiredResultType: ResultType;

		switch (context.commandType) {
			case 'move':
				// For move commands, we need search results
				requiredResultType = ResultType.SEARCH_RESULTS;
				break;
			default:
				throw new Error(
					`Unsupported command type for reference resolution: ${context.commandType}`
				);
		}

		// Get the most recent context of the required type
		const previousContext = context.contextManager.getMostRecentContextByType(
			context.conversationTitle,
			requiredResultType
		);

		if (!previousContext) {
			throw new Error(`No previous ${requiredResultType} found to reference.`);
		}

		// Update the UI to show we're processing the reference
		await context.plugin.addGeneratingIndicator(
			context.conversationTitle,
			GeneratorText.ExtractingIntent
		);

		// Store the previous results in the current context
		context.previousResults = previousContext;

		// Return the enhanced input with resolved references
		return {
			originalInput: input,
			previousResults: previousContext,
			resolvedCommand: input, // Potentially modify this to include the resolved references
		};
	},

	handleError: async (error: Error, input: string, context: PipelineContext) => {
		// Provide a user-friendly error message
		const t = getTranslation(context.lang);
		await context.plugin.updateConversationNote(
			context.conversationTitle,
			t('errors.referenceResolutionFailed', { error: error.message }),
			'Steward'
		);
	},
};
