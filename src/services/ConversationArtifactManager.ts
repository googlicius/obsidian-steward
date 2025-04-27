/**
 * Types of artifacts that can be stored for conversations
 */
export enum ArtifactType {
	SEARCH_RESULTS = 'search_results',
	MOVE_RESULTS = 'move_results',
	CALCULATION_RESULTS = 'calculation_results',
}

/**
 * Search results artifact
 */
export interface SearchResultsArtifact {
	type: ArtifactType.SEARCH_RESULTS;
	originalResults: any[]; // The original, unpaginated results
}

/**
 * Manages the storage and retrieval of conversation artifacts
 */
export class ConversationArtifactManager {
	private static instance: ConversationArtifactManager;
	private artifacts: Map<string, Map<string, any>> = new Map();

	/**
	 * Get the singleton instance
	 */
	public static getInstance(): ConversationArtifactManager {
		if (!ConversationArtifactManager.instance) {
			ConversationArtifactManager.instance = new ConversationArtifactManager();
		}
		return ConversationArtifactManager.instance;
	}

	/**
	 * Store an artifact for a conversation
	 * @param conversationTitle The title of the conversation
	 * @param artifactId The ID of the artifact (usually a message ID)
	 * @param artifact The artifact to store
	 */
	public storeArtifact(conversationTitle: string, artifactId: string, artifact: any): void {
		if (!this.artifacts.has(conversationTitle)) {
			this.artifacts.set(conversationTitle, new Map());
		}

		this.artifacts.get(conversationTitle)?.set(artifactId, artifact);
	}

	/**
	 * Get an artifact for a conversation
	 * @param conversationTitle The title of the conversation
	 * @param artifactId The ID of the artifact
	 * @returns The artifact, or undefined if not found
	 */
	public getArtifact<T>(conversationTitle: string, artifactId: string): T | undefined {
		return this.artifacts.get(conversationTitle)?.get(artifactId);
	}

	/**
	 * Store search results for a conversation
	 */
	public storeSearchResults(
		conversationTitle: string,
		messageId: string,
		originalResults: any[]
	): void {
		const artifact: SearchResultsArtifact = {
			type: ArtifactType.SEARCH_RESULTS,
			originalResults,
		};

		this.storeArtifact(conversationTitle, messageId, artifact);
	}

	/**
	 * Get the most recent artifact of a specific type for a conversation
	 * @param conversationTitle The title of the conversation
	 * @param type The type of artifact to get
	 * @returns The most recent artifact, or undefined if none found
	 */
	public getMostRecentArtifactByType<T>(
		conversationTitle: string,
		type: ArtifactType
	): T | undefined {
		const conversationArtifacts = this.artifacts.get(conversationTitle);
		if (!conversationArtifacts) {
			return undefined;
		}

		// Get all artifacts of the specified type
		const artifactsOfType: T[] = [];
		conversationArtifacts.forEach(artifact => {
			if (artifact.type === type) {
				artifactsOfType.push(artifact);
			}
		});

		// Return the most recent one (assuming it's the last one added)
		return artifactsOfType.length > 0 ? artifactsOfType[artifactsOfType.length - 1] : undefined;
	}

	public deleteArtifact(conversationTitle: string, messageId: string): boolean {
		const conversationArtifacts = this.artifacts.get(conversationTitle);
		return conversationArtifacts ? conversationArtifacts?.delete(messageId) : true;
	}

	/**
	 * Clear artifacts for a conversation
	 * @param conversationTitle The title of the conversation
	 */
	public clearArtifacts(conversationTitle: string): void {
		this.artifacts.delete(conversationTitle);
	}
}
