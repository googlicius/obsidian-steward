import { EditorView } from '@codemirror/view';
import { MoveQueryExtraction } from '../tools/obsidianAPITools';
import { SearchResult } from '../searchIndexer';

export enum Events {
	CONVERSATION_NOTE_CREATED = 'CONVERSATION_NOTE_CREATED',
	CONVERSATION_NOTE_UPDATED = 'CONVERSATION_NOTE_UPDATED',
	CONVERSATION_LINK_INSERTED = 'CONVERSATION_LINK_INSERTED',
	LLM_RESPONSE_RECEIVED = 'LLM_RESPONSE_RECEIVED',
	RESPONSE_READY_TO_INSERT = 'RESPONSE_READY_TO_INSERT',
	MOVE_QUERY_EXTRACTED = 'MOVE_QUERY_EXTRACTED',
	COMMAND_INTENT_EXTRACTED = 'COMMAND_INTENT_EXTRACTED',
	CONFIRMATION_REQUESTED = 'CONFIRMATION_REQUESTED',
	CONFIRMATION_RESPONDED = 'CONFIRMATION_RESPONDED',
}

export enum ErrorEvents {
	MATH_PROCESSING_ERROR = 'MATH_PROCESSING_ERROR',
	LLM_ERROR = 'LLM_ERROR',
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

export interface ConversationNoteUpdatedPayload {
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
	queryExtraction: MoveQueryExtraction;
	filesByOperation?: Map<number, SearchResult[]>;
}

export interface CommandIntentExtractedPayload {
	title: string;
	intentExtraction: CommandIntentExtraction;
}

export interface CommandIntentExtraction {
	commandType: string;
	content: string;
	explanation: string;
	confidence: number;
	lang?: string;
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

export type EventPayloadMap = {
	[Events.CONVERSATION_NOTE_CREATED]: ConversationNoteCreatedPayload;
	[Events.CONVERSATION_NOTE_UPDATED]: ConversationNoteUpdatedPayload;
	[Events.LLM_RESPONSE_RECEIVED]: ResponseReadyPayload;
	[Events.RESPONSE_READY_TO_INSERT]: ResponseReadyPayload;
	[Events.CONVERSATION_LINK_INSERTED]: ConversationLinkInsertedPayload;
	[Events.MOVE_QUERY_EXTRACTED]: MoveQueryExtractedPayload;
	[Events.COMMAND_INTENT_EXTRACTED]: CommandIntentExtractedPayload;
	[Events.CONFIRMATION_REQUESTED]: ConfirmationRequestPayload;
	[Events.CONFIRMATION_RESPONDED]: ConfirmationResponsePayload;
	[ErrorEvents.MATH_PROCESSING_ERROR]: ErrorPayload;
	[ErrorEvents.LLM_ERROR]: ErrorPayload;
};
