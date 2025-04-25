import { ContextData } from './ConversationContextManager';

/**
 * Additional events for command chaining
 */
export enum CommandChainingEvents {
	CONTEXT_ADDED = 'CONTEXT_ADDED',
	CONTEXT_RESOLVED = 'CONTEXT_RESOLVED',
	PIPELINE_STEP_COMPLETED = 'PIPELINE_STEP_COMPLETED',
	PIPELINE_COMPLETED = 'PIPELINE_COMPLETED',
}

/**
 * Payload types for command chaining events
 */
export interface ContextAddedPayload {
	conversationTitle: string;
	context: ContextData;
}

export interface ContextResolvedPayload {
	conversationTitle: string;
	context: ContextData;
	commandType: string;
}

export interface PipelineStepCompletedPayload {
	conversationTitle: string;
	stepType: string;
	result: any;
}

export interface PipelineCompletedPayload {
	conversationTitle: string;
	commandType: string;
	results: Map<string, any>;
}

/**
 * Updates to the event payload map
 * These would be added to the main EventPayloadMap
 */
export type CommandChainingEventPayloadMap = {
	[CommandChainingEvents.CONTEXT_ADDED]: ContextAddedPayload;
	[CommandChainingEvents.CONTEXT_RESOLVED]: ContextResolvedPayload;
	[CommandChainingEvents.PIPELINE_STEP_COMPLETED]: PipelineStepCompletedPayload;
	[CommandChainingEvents.PIPELINE_COMPLETED]: PipelineCompletedPayload;
};
