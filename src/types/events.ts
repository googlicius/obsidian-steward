import { EditorView } from '@codemirror/view';
import { CommandIntentExtraction } from '../lib/modelfusion/intentExtraction';
import { MoveQueryExtractionV2 } from '../lib/modelfusion';
import { IndexedDocument } from '../database/PluginDatabase';
import { GitOperation } from '../solutions/git/GitService';

export enum Events {
	CONVERSATION_NOTE_CREATED = 'CONVERSATION_NOTE_CREATED',
	CONVERSATION_COMMAND_RECEIVED = 'CONVERSATION_COMMAND_RECEIVED',
	CONVERSATION_LINK_INSERTED = 'CONVERSATION_LINK_INSERTED',
	LLM_RESPONSE_RECEIVED = 'LLM_RESPONSE_RECEIVED',
	RESPONSE_READY_TO_INSERT = 'RESPONSE_READY_TO_INSERT',
	MOVE_QUERY_EXTRACTED = 'MOVE_QUERY_EXTRACTED',
	COMMAND_INTENT_EXTRACTED = 'COMMAND_INTENT_EXTRACTED',
	CONFIRMATION_REQUESTED = 'CONFIRMATION_REQUESTED',
	CONFIRMATION_RESPONDED = 'CONFIRMATION_RESPONDED',
	MOVE_FROM_SEARCH_RESULT_CONFIRMED = 'MOVE_FROM_SEARCH_RESULT_CONFIRMED',
	// Git related events
	GIT_OPERATION_PERFORMED = 'GIT_OPERATION_PERFORMED',
	GIT_OPERATION_REVERTED = 'GIT_OPERATION_REVERTED',
	// Operation completion events
	MOVE_OPERATION_COMPLETED = 'MOVE_OPERATION_COMPLETED',
}

export enum ErrorEvents {
	MATH_PROCESSING_ERROR = 'MATH_PROCESSING_ERROR',
	LLM_ERROR = 'LLM_ERROR',
	GIT_ERROR = 'GIT_ERROR',
}

export interface ConversationNoteCreatedPayload {
	view: EditorView;
	from: number;
	to: number;
	title: string;
	commandType: string;
	commandContent: string;
	lang?: string;
}

export interface ConversationCommandReceivedPayload {
	title: string;
	commandType: string;
	commandContent: string;
	lang?: string;
}

export interface ConversationLinkInsertedPayload {
	title: string;
	commandType: string;
	commandContent: string;
	lang?: string;
}

export interface ResponseReadyPayload {
	notePath: string;
	content: string;
	position: number;
}

export interface ErrorPayload {
	notePath: string;
	error: Error;
	position: number;
}

export interface MoveQueryExtractedPayload {
	title: string;
	queryExtraction: MoveQueryExtractionV2;
	filesByOperation?: Map<number, IndexedDocument[]>;
}

export interface MoveFromSearchResultConfirmedPayload {
	title: string;
	destinationFolder: string;
	searchResults: IndexedDocument[];
	explanation: string;
}

export interface CommandIntentExtractedPayload {
	title: string;
	intentExtraction: CommandIntentExtraction;
}

export interface ConfirmationRequestPayload {
	id: string;
	conversationTitle: string;
	message: string;
	type: string;
	context: any;
}

export interface ConfirmationResponsePayload {
	id: string;
	confirmed: boolean;
	conversationTitle: string;
	context?: any; // Additional context data, such as language preference
}

export interface GitOperationPerformedPayload {
	operation: GitOperation;
	commitHash: string;
}

export interface GitOperationRevertedPayload {
	commitHash: string;
	success: boolean;
}

export interface GitErrorPayload {
	error: Error;
	operation?: GitOperation;
}

export interface MoveOperationCompletedPayload {
	title: string;
	operations: Array<{
		sourceQuery: string;
		destinationFolder: string;
		moved: string[];
		errors: string[];
		skipped: string[];
	}>;
}

export type EventPayloadMap = {
	[Events.CONVERSATION_NOTE_CREATED]: ConversationNoteCreatedPayload;
	[Events.CONVERSATION_COMMAND_RECEIVED]: ConversationCommandReceivedPayload;
	[Events.LLM_RESPONSE_RECEIVED]: ResponseReadyPayload;
	[Events.RESPONSE_READY_TO_INSERT]: ResponseReadyPayload;
	[Events.CONVERSATION_LINK_INSERTED]: ConversationLinkInsertedPayload;
	[Events.MOVE_QUERY_EXTRACTED]: MoveQueryExtractedPayload;
	[Events.COMMAND_INTENT_EXTRACTED]: CommandIntentExtractedPayload;
	[Events.CONFIRMATION_REQUESTED]: ConfirmationRequestPayload;
	[Events.CONFIRMATION_RESPONDED]: ConfirmationResponsePayload;
	[Events.MOVE_FROM_SEARCH_RESULT_CONFIRMED]: MoveFromSearchResultConfirmedPayload;
	[Events.GIT_OPERATION_PERFORMED]: GitOperationPerformedPayload;
	[Events.GIT_OPERATION_REVERTED]: GitOperationRevertedPayload;
	[Events.MOVE_OPERATION_COMPLETED]: MoveOperationCompletedPayload;
	[ErrorEvents.MATH_PROCESSING_ERROR]: ErrorPayload;
	[ErrorEvents.LLM_ERROR]: ErrorPayload;
	[ErrorEvents.GIT_ERROR]: GitErrorPayload;
};
