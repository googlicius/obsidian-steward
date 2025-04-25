import { SearchResult } from '../../searchIndexer';
import { MoveQueryExtraction } from '../../tools/obsidianAPITools';

/**
 * Types of results that can be stored in the context
 */
export enum ResultType {
	SEARCH_RESULTS = 'SEARCH_RESULTS',
	MOVE_RESULTS = 'MOVE_RESULTS',
	CALCULATION_RESULTS = 'CALCULATION_RESULTS',
	// Add more result types as needed
}

/**
 * Generic type for contextual data storage
 */
export interface ContextData {
	type: ResultType;
	data: any;
	timestamp: number;
	description?: string;
}

/**
 * Specific type for search results
 */
export interface SearchResultsContext extends ContextData {
	type: ResultType.SEARCH_RESULTS;
	data: {
		results: {
			totalCount: number;
			documents: SearchResult[];
		};
		queryExtraction: any; // The original query extraction
	};
	description: string; // Human readable description of the search
}

/**
 * Specific type for move results
 */
export interface MoveResultsContext extends ContextData {
	type: ResultType.MOVE_RESULTS;
	data: {
		operations: Array<{
			sourceQuery: string;
			destinationFolder: string;
			moved: string[];
			errors: string[];
			skipped: string[];
		}>;
		queryExtraction: MoveQueryExtraction;
	};
	description: string;
}

/**
 * Manages the context for conversations, allowing commands to reference previous results
 */
export class ConversationContextManager {
	// Store contexts by conversation title
	private conversationContexts: Map<string, ContextData[]> = new Map();

	/**
	 * Adds a context to a conversation
	 * @param conversationTitle The title of the conversation
	 * @param context The context data to add
	 */
	public addContext(conversationTitle: string, context: ContextData): void {
		if (!this.conversationContexts.has(conversationTitle)) {
			this.conversationContexts.set(conversationTitle, []);
		}

		// Add the context to the beginning of the array for recency
		this.conversationContexts.get(conversationTitle)?.unshift(context);
	}

	/**
	 * Gets all contexts for a conversation
	 * @param conversationTitle The title of the conversation
	 * @returns Array of context data
	 */
	public getContexts(conversationTitle: string): ContextData[] {
		return this.conversationContexts.get(conversationTitle) || [];
	}

	/**
	 * Gets the most recent context of a specific type for a conversation
	 * @param conversationTitle The title of the conversation
	 * @param type The type of context to get
	 * @returns The most recent context of the specified type or undefined if not found
	 */
	public getMostRecentContextByType(
		conversationTitle: string,
		type: ResultType
	): ContextData | undefined {
		const contexts = this.conversationContexts.get(conversationTitle) || [];
		return contexts.find(context => context.type === type);
	}

	/**
	 * Clears the contexts for a conversation
	 * @param conversationTitle The title of the conversation
	 */
	public clearContexts(conversationTitle: string): void {
		this.conversationContexts.delete(conversationTitle);
	}

	/**
	 * Checks if there's a reference to previous results in the command content
	 * @param commandContent The command content to check
	 * @returns True if the command references previous results
	 */
	public static hasPreviousResultReference(commandContent: string): boolean {
		// Simple check for phrases indicating reference to previous results
		const referenceKeywords = [
			'them',
			'those',
			'these',
			'the results',
			'previous results',
			'that',
			'last search',
			'those files',
			'these files',
			'all of them',
			'previous search',
			'last command',
		];

		const normalizedContent = commandContent.toLowerCase();
		return referenceKeywords.some(keyword => normalizedContent.includes(keyword));
	}
}
