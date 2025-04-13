import { EditorView } from '@codemirror/view';
import { MoveQueryExtraction } from '../tools/obsidianAPITools';

export enum Events {
	CONVERSATION_NOTE_CREATED = 'CONVERSATION_NOTE_CREATED',
	CONVERSATION_NOTE_UPDATED = 'CONVERSATION_NOTE_UPDATED',
	CONVERSATION_LINK_INSERTED = 'CONVERSATION_LINK_INSERTED',
	LLM_RESPONSE_RECEIVED = 'LLM_RESPONSE_RECEIVED',
	RESPONSE_READY_TO_INSERT = 'RESPONSE_READY_TO_INSERT',
	MOVE_QUERY_EXTRACTED = 'MOVE_QUERY_EXTRACTED',
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
}

export interface ConversationNoteUpdatedPayload {
	title: string;
	commandType: string;
	commandContent: string;
}

export interface ConversationLinkInsertedPayload {
	title: string;
	commandType: string;
	commandContent: string;
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
}

export type EventPayloadMap = {
	[Events.CONVERSATION_NOTE_CREATED]: ConversationNoteCreatedPayload;
	[Events.CONVERSATION_NOTE_UPDATED]: ConversationNoteUpdatedPayload;
	[Events.LLM_RESPONSE_RECEIVED]: ResponseReadyPayload;
	[Events.RESPONSE_READY_TO_INSERT]: ResponseReadyPayload;
	[Events.CONVERSATION_LINK_INSERTED]: ConversationLinkInsertedPayload;
	[Events.MOVE_QUERY_EXTRACTED]: MoveQueryExtractedPayload;
	[ErrorEvents.MATH_PROCESSING_ERROR]: ErrorPayload;
	[ErrorEvents.LLM_ERROR]: ErrorPayload;
};
