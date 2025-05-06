import Dexie, { Table } from 'dexie';

export interface EmbeddingEntry {
	id?: number;
	modelName: string; // Name of the embedding model used
	clusterName: string; // Name of the cluster this embedding belongs to
	valueText: string; // Original text value that was embedded
	embedding: number[]; // The actual embedding vector
	createdAt: number; // Timestamp when the embedding was created
}

export interface ClusterVersionEntry {
	id?: number;
	modelName: string; // Name of the model
	clusterName: string; // Name of the specific cluster
	version: string; // Version hash of the cluster content
	updatedAt: number; // Timestamp when the version was updated
}

/**
 * Database for storing embeddings for EmbeddingSimilarityClassifier
 */
export class EmbeddingsDatabase extends Dexie {
	embeddings!: Table<EmbeddingEntry>;
	clusterVersions!: Table<ClusterVersionEntry>;

	constructor() {
		super('embeddings-cache');

		// Version 1 had missing compound indexes
		this.version(1).stores({
			embeddings: '++id, modelName, clusterName, valueText, createdAt',
			clusterVersions: '++id, modelName, clusterName, version, updatedAt',
		});

		// Version 2 adds the compound indexes
		this.version(2).stores({
			embeddings: '++id, modelName, clusterName, valueText, createdAt, [modelName+clusterName]',
			clusterVersions: '++id, modelName, clusterName, version, updatedAt, [modelName+clusterName]',
		});
	}

	/**
	 * Store a batch of embeddings in the database
	 * @param entries Embedding entries to store
	 */
	async storeEmbeddings(entries: Omit<EmbeddingEntry, 'id'>[]) {
		return this.embeddings.bulkAdd(entries);
	}

	/**
	 * Get all embeddings for a specific model
	 * @param modelName Name of the embedding model
	 */
	async getEmbeddingsForModel(modelName: string): Promise<EmbeddingEntry[]> {
		return this.embeddings.where('modelName').equals(modelName).toArray();
	}

	/**
	 * Get embeddings for a specific model and cluster
	 * @param modelName Name of the embedding model
	 * @param clusterName Name of the cluster
	 */
	async getEmbeddingsForCluster(modelName: string, clusterName: string): Promise<EmbeddingEntry[]> {
		return this.embeddings
			.where('[modelName+clusterName]')
			.equals([modelName, clusterName])
			.toArray();
	}

	/**
	 * Clear all embeddings for a specific model
	 * @param modelName Name of the embedding model
	 */
	async clearEmbeddingsForModel(modelName: string) {
		return this.embeddings.where('modelName').equals(modelName).delete();
	}

	/**
	 * Clear embeddings for a specific model and cluster
	 * @param modelName Name of the embedding model
	 * @param clusterName Name of the cluster
	 */
	async clearEmbeddingsForCluster(modelName: string, clusterName: string) {
		return this.embeddings
			.where('[modelName+clusterName]')
			.equals([modelName, clusterName])
			.delete();
	}

	/**
	 * Check if there are any embeddings stored for a specific model
	 * @param modelName Name of the embedding model
	 */
	async hasEmbeddingsForModel(modelName: string): Promise<boolean> {
		const count = await this.embeddings.where('modelName').equals(modelName).count();
		return count > 0;
	}

	/**
	 * Store a version hash for a specific cluster in a model
	 * @param modelName Name of the model
	 * @param clusterName Name of the cluster
	 * @param version Version hash of the cluster
	 */
	async storeClusterVersion(
		modelName: string,
		clusterName: string,
		version: string
	): Promise<number> {
		// Delete any existing version for this model and cluster
		await this.clusterVersions
			.where('[modelName+clusterName]')
			.equals([modelName, clusterName])
			.delete();

		// Store the new version
		return this.clusterVersions.add({
			modelName,
			clusterName,
			version,
			updatedAt: Date.now(),
		});
	}

	/**
	 * Get the stored version hash for a specific cluster
	 * @param modelName Name of the model
	 * @param clusterName Name of the cluster
	 * @returns The version hash or null if not found
	 */
	async getClusterVersion(modelName: string, clusterName: string): Promise<string | null> {
		const entry = await this.clusterVersions
			.where('[modelName+clusterName]')
			.equals([modelName, clusterName])
			.first();
		return entry ? entry.version : null;
	}

	/**
	 * Get all cluster versions for a model
	 * @param modelName Name of the model
	 * @returns Map of cluster names to version hashes
	 */
	async getAllClusterVersions(modelName: string): Promise<Map<string, string>> {
		const entries = await this.clusterVersions.where('modelName').equals(modelName).toArray();

		const versionMap = new Map<string, string>();
		for (const entry of entries) {
			versionMap.set(entry.clusterName, entry.version);
		}

		return versionMap;
	}
}
