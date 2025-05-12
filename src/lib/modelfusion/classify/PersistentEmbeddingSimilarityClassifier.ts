/* eslint-disable no-mixed-spaces-and-tabs */
import {
	Vector,
	FunctionCallOptions,
	cosineSimilarity,
	EmbeddingModel,
	embed,
	embedMany,
	Classifier,
	ClassifierSettings,
} from 'modelfusion';
import { EmbeddingsDatabase, EmbeddingEntry } from 'src/database/EmbeddingsDatabase';
import { logger } from 'src/utils/logger';
import crypto from 'crypto';

export interface ValueCluster<VALUE extends string, NAME extends string> {
	name: NAME;
	values: VALUE[];
}

export interface PersistentEmbeddingSimilarityClassifierSettings<
	VALUE extends string,
	CLUSTERS extends Array<ValueCluster<VALUE, string>>,
> extends ClassifierSettings {
	staticClusterValues?: CLUSTERS;
	prefixedClusterValue?: CLUSTERS;
	clusters: CLUSTERS;
	embeddingModel: EmbeddingModel<VALUE>;
	similarityThreshold: number;
	modelName?: string;
	forceRefresh?: boolean;
	refreshClusters?: string[];
}

type ClusterNames<CLUSTERS> =
	CLUSTERS extends Array<ValueCluster<string, infer NAME>> ? NAME : never;

/**
 * Classifies values based on their distance to the values from a set of clusters.
 * When the distance is below a certain threshold, the value is classified as belonging to the cluster,
 * and the cluster name is returned. Otherwise, the value is classified as null.
 *
 * This version persists embeddings to IndexedDB for faster startup times.
 */
export class PersistentEmbeddingSimilarityClassifier<
	VALUE extends string,
	CLUSTERS extends Array<ValueCluster<VALUE, string>>,
> implements
		Classifier<
			VALUE,
			ClusterNames<CLUSTERS> | null,
			PersistentEmbeddingSimilarityClassifierSettings<VALUE, CLUSTERS>
		>
{
	readonly settings: PersistentEmbeddingSimilarityClassifierSettings<VALUE, CLUSTERS>;
	private db: EmbeddingsDatabase;

	readonly modelInformation = {
		provider: 'modelfusion',
		modelName: 'PersistentEmbeddingSimilarityClassifier',
	};

	private embeddings:
		| Array<{
				embedding: Vector;
				clusterValue: VALUE;
				clusterName: string;
		  }>
		| undefined;

	constructor(settings: PersistentEmbeddingSimilarityClassifierSettings<VALUE, CLUSTERS>) {
		this.settings = settings;
		this.db = new EmbeddingsDatabase();
	}

	/**
	 * Get model name used for storage
	 */
	getModelStorageName(): string {
		return (
			this.settings.modelName ||
			`${this.settings.embeddingModel.modelInformation.provider}-${this.settings.embeddingModel.modelInformation.modelName}`
		);
	}

	/**
	 * Generate a version hash for a specific cluster
	 * @param cluster The cluster to hash
	 */
	private generateClusterHash(cluster: ValueCluster<VALUE, string>): string {
		// Sort values for consistent hash
		const sortedValues = [...cluster.values].sort();
		// Create a string representation
		const clusterString = JSON.stringify({
			name: cluster.name,
			values: sortedValues,
		});
		// Generate a hash
		return crypto.createHash('md5').update(clusterString).digest('hex');
	}

	/**
	 * Check which clusters have changed by comparing version hashes
	 * @returns Map of cluster names that need to be refreshed
	 */
	private async detectChangedClusters(): Promise<Map<string, ValueCluster<VALUE, string>>> {
		try {
			const modelName = this.getModelStorageName();

			// Get stored versions of all clusters
			const storedVersions = await this.db.getAllClusterVersions(modelName);

			// Map to store clusters that need to be refreshed
			const changedClusters = new Map<string, ValueCluster<VALUE, string>>();

			// Check each cluster for changes
			for (const cluster of this.settings.clusters) {
				const clusterName = cluster.name;
				const currentHash = this.generateClusterHash(cluster);
				const storedHash = storedVersions.get(clusterName);

				// If forced refresh for all clusters or specific clusters
				if (
					this.settings.forceRefresh ||
					(this.settings.refreshClusters && this.settings.refreshClusters.includes(clusterName))
				) {
					changedClusters.set(clusterName, cluster);
					logger.log(`Cluster "${clusterName}" marked for forced refresh`);
					continue;
				}

				// If no stored hash or hash has changed
				if (!storedHash || currentHash !== storedHash) {
					changedClusters.set(clusterName, cluster);
					logger.log(
						`Cluster "${clusterName}" has changed (${storedHash || 'new'} → ${currentHash})`
					);
				}
			}

			// Check for deleted clusters
			const currentClusterNames = new Set(this.settings.clusters.map(c => c.name));
			for (const [storedClusterName] of storedVersions) {
				if (!currentClusterNames.has(storedClusterName)) {
					// This cluster no longer exists in settings, remove its embeddings
					await this.removeClusterEmbeddings(storedClusterName);
					logger.log(`Removed embeddings for deleted cluster "${storedClusterName}"`);
				}
			}

			return changedClusters;
		} catch (error) {
			logger.error('Error detecting changed clusters:', error);
			// On error, refresh all clusters to be safe
			const allClusters = new Map<string, ValueCluster<VALUE, string>>();
			for (const cluster of this.settings.clusters) {
				allClusters.set(cluster.name, cluster);
			}
			return allClusters;
		}
	}

	/**
	 * Remove embeddings for a specific cluster
	 */
	private async removeClusterEmbeddings(clusterName: string): Promise<void> {
		try {
			const modelName = this.getModelStorageName();
			await this.db.clearEmbeddingsForCluster(modelName, clusterName);
			await this.db.removeClusterVersion(modelName, clusterName);
		} catch (error) {
			logger.error(`Error removing embeddings for cluster "${clusterName}":`, error);
		}
	}

	/**
	 * Load embeddings from IndexedDB, detecting which clusters need refresh
	 * @returns Object containing loaded embeddings and clusters that need refresh
	 */
	private async loadEmbeddingsFromDb(): Promise<{
		embeddings: Array<{
			embedding: Vector;
			clusterValue: VALUE;
			clusterName: string;
		}>;
		changedClusters: Map<string, ValueCluster<VALUE, string>>;
	}> {
		try {
			const modelName = this.getModelStorageName();
			const embeddings: Array<{
				embedding: Vector;
				clusterValue: VALUE;
				clusterName: string;
			}> = [];

			// Detect which clusters have changed
			const changedClusters = await this.detectChangedClusters();

			// If all clusters need refresh, short-circuit
			if (changedClusters.size === this.settings.clusters.length) {
				logger.log(`All clusters need refresh for model ${modelName}`);
				return { embeddings: [], changedClusters };
			}

			const embeddingsOfModel = await this.db.getEmbeddingsForModel(modelName);

			const clustersMap = this.settings.clusters.reduce(
				(acc, cluster) => {
					acc[cluster.name] = 1;
					return acc;
				},
				{} as Record<string, number>
			);

			const embeddingsForDynamicCluster = embeddingsOfModel
				.filter(item => clustersMap[item.clusterName] === undefined)
				.map(embedding => ({
					embedding: embedding.embedding,
					clusterValue: embedding.valueText as VALUE,
					clusterName: embedding.clusterName,
				}));

			embeddings.push(...embeddingsForDynamicCluster);

			// If some clusters changed, load embeddings for unchanged clusters
			for (const cluster of this.settings.clusters) {
				// Skip clusters that need refresh
				if (changedClusters.has(cluster.name)) {
					continue;
				}

				// Load embeddings for this unchanged cluster
				const clusterEmbeddings = embeddingsOfModel.filter(
					embedding => embedding.clusterName === cluster.name
				);

				// If for some reason we don't have embeddings for this cluster, mark it for refresh
				if (!clusterEmbeddings || clusterEmbeddings.length === 0) {
					changedClusters.set(cluster.name, cluster);
					logger.log(`No embeddings found for cluster "${cluster.name}", marking for refresh`);
					continue;
				}

				// Add the loaded embeddings to our collection
				embeddings.push(
					...clusterEmbeddings.map((entry: EmbeddingEntry) => ({
						embedding: entry.embedding,
						clusterValue: entry.valueText as VALUE,
						clusterName: entry.clusterName,
					}))
				);
			}

			return { embeddings, changedClusters };
		} catch (error) {
			logger.error('Error loading embeddings from database:', error);
			// On error, refresh all clusters
			const allClusters = new Map<string, ValueCluster<VALUE, string>>();
			for (const cluster of this.settings.clusters) {
				allClusters.set(cluster.name, cluster);
			}
			return { embeddings: [], changedClusters: allClusters };
		}
	}

	/**
	 * Save embeddings for specific clusters to IndexedDB
	 */
	private async saveEmbeddingsForClusters(
		clusterEmbeddings: Map<
			string,
			Array<{
				embedding: Vector;
				clusterValue: VALUE;
				clusterName: string;
			}>
		>
	): Promise<void> {
		try {
			const modelName = this.getModelStorageName();

			// Process each cluster
			for (const [clusterName, embeddings] of clusterEmbeddings.entries()) {
				// Clear existing embeddings for this cluster
				await this.db.clearEmbeddingsForCluster(modelName, clusterName);

				// Convert embeddings to database format
				const entries: Omit<EmbeddingEntry, 'id'>[] = embeddings.map(item => ({
					modelName,
					clusterName: item.clusterName,
					valueText: item.clusterValue,
					embedding: item.embedding,
					createdAt: Date.now(),
				}));

				// Store in database
				await this.db.storeEmbeddings(entries);

				// Find the cluster
				const cluster = this.settings.clusters.find(c => c.name === clusterName);
				if (cluster) {
					// Generate and store the version hash
					const versionHash = this.generateClusterHash(cluster);
					await this.db.storeClusterVersion(modelName, clusterName, versionHash);

					logger.log(
						`Saved ${entries.length} embeddings for cluster "${clusterName}" with version ${versionHash}`
					);
				}
			}
		} catch (error) {
			logger.error('Error saving embeddings to database:', error);
		}
	}

	/**
	 * Get embeddings for all clusters, either from memory, database, or by generating new ones
	 */
	async getEmbeddings(options: FunctionCallOptions) {
		// Return from memory if already loaded
		if (this.embeddings != null) {
			return this.embeddings;
		}

		// Load existing embeddings and detect changed clusters
		const { embeddings, changedClusters } = await this.loadEmbeddingsFromDb();

		// If no clusters need refresh, just return the loaded embeddings
		if (changedClusters.size === 0) {
			this.embeddings = embeddings;
			return embeddings;
		}

		// Generate new embeddings for changed clusters
		logger.log(`Generating embeddings for ${changedClusters.size} changed clusters`);
		const newEmbeddingsByCluster = new Map<
			string,
			Array<{
				embedding: Vector;
				clusterValue: VALUE;
				clusterName: string;
			}>
		>();

		for (const cluster of changedClusters.values()) {
			logger.log(
				`Generating embeddings for cluster "${cluster.name}" (${cluster.values.length} values)`
			);

			const clusterEmbeddings = await embedMany({
				model: this.settings.embeddingModel,
				values: cluster.values as VALUE[],
				...options,
			});

			const processedEmbeddings = [];
			for (let i = 0; i < clusterEmbeddings.length; i++) {
				processedEmbeddings.push({
					embedding: clusterEmbeddings[i],
					clusterValue: cluster.values[i] as VALUE,
					clusterName: cluster.name,
				});
			}

			newEmbeddingsByCluster.set(cluster.name, processedEmbeddings);
		}

		// Save the new embeddings to the database
		await this.saveEmbeddingsForClusters(newEmbeddingsByCluster);

		// Combine existing and new embeddings
		const allEmbeddings = [...embeddings];
		for (const newEmbeddings of newEmbeddingsByCluster.values()) {
			allEmbeddings.push(...newEmbeddings);
		}

		// Store in memory and return
		this.embeddings = allEmbeddings;
		return allEmbeddings;
	}

	/**
	 * Clear cached embeddings from the database
	 */
	async clearCachedEmbeddings(): Promise<void> {
		const modelName = this.getModelStorageName();
		await this.db.clearEmbeddingsForModel(modelName);
		this.embeddings = undefined;
		logger.log(`Cleared cached embeddings for model ${modelName}`);
	}

	/**
	 * Force regeneration of embeddings on next use
	 * @param clusterNames Optional array of cluster names to refresh; if not provided, all clusters will be refreshed
	 */
	async forceRegenerateEmbeddings(clusterNames?: string[]): Promise<void> {
		this.embeddings = undefined;

		if (clusterNames && clusterNames.length > 0) {
			this.settings.refreshClusters = clusterNames;
			logger.log(
				`Set to regenerate embeddings for clusters [${clusterNames.join(', ')}] on next use`
			);
		} else {
			this.settings.forceRefresh = true;
			logger.log(
				`Set to regenerate all embeddings on next use for model ${this.getModelStorageName()}`
			);
		}
	}

	/**
	 * Save the embedding of a value to the database under a specific cluster
	 * and update in-memory embeddings
	 * @param value The value to embed
	 * @param clusterName The cluster name to save the embedding under
	 */
	async saveEmbedding(value: string, clusterName: string): Promise<void> {
		try {
			const modelName = this.getModelStorageName();

			// Check if the value already exists in the database
			const existingEmbedding = await this.db.getEmbeddingByValue(modelName, clusterName, value);
			if (existingEmbedding) {
				logger.log(`Embedding for value "${value}" under cluster "${clusterName}" already exists`);
				return;
			}

			// Generate embedding for the value
			const embedding = await embed({
				model: this.settings.embeddingModel,
				value,
			});

			// Save the embedding to database
			await this.db.storeEmbeddings([
				{
					modelName,
					clusterName,
					valueText: value,
					embedding,
					createdAt: Date.now(),
				},
			]);

			// Update in-memory embeddings if they exist
			if (this.embeddings) {
				this.embeddings.push({
					embedding,
					clusterValue: value as VALUE,
					clusterName,
				});
			}

			// Find the cluster and update its version hash
			const cluster = this.settings.clusters.find(c => c.name === clusterName);
			if (cluster) {
				// Check if the value already exists in the cluster values
				if (!cluster.values.includes(value as VALUE)) {
					// Add the value to the cluster's values array to properly track it
					cluster.values.push(value as VALUE);

					// Generate and store the updated version hash
					const versionHash = this.generateClusterHash(cluster);
					await this.db.storeClusterVersion(modelName, clusterName, versionHash);

					logger.log(`Updated version hash for cluster "${clusterName}" after adding new value`);
				}
			} else {
				logger.warn(`Saved embedding for value under non-existent cluster "${clusterName}"`);
			}

			logger.log(`Saved embedding for value under cluster "${clusterName}"`);
		} catch (error) {
			logger.error('Failed to save embedding:', error);
			throw error;
		}
	}

	async doClassify(value: VALUE, options: FunctionCallOptions) {
		if (this.settings.staticClusterValues) {
			for (const cluster of this.settings.staticClusterValues) {
				if (cluster.values.includes(value.toLowerCase() as VALUE)) {
					return {
						class: cluster.name as unknown as ClusterNames<CLUSTERS>,
						rawResponse: undefined,
					};
				}
			}
		}

		if (this.settings.prefixedClusterValue) {
			for (const cluster of this.settings.prefixedClusterValue) {
				for (const clusterValue of cluster.values) {
					if (value.toLowerCase().startsWith(clusterValue.toLowerCase())) {
						return {
							class: cluster.name as unknown as ClusterNames<CLUSTERS>,
							rawResponse: undefined,
						};
					}
				}
			}
		}

		const valueEmbedding = await embed({
			model: this.settings.embeddingModel,
			value,
			...options,
		});

		// Race between getEmbeddings and timeout
		const clusterEmbeddings = await Promise.race([
			this.getEmbeddings(options),
			new Promise<null>(resolve => {
				setTimeout(() => resolve(null), 2000);
			}),
		]);

		if (!clusterEmbeddings) {
			return {
				class: null,
				rawResponse: undefined,
			};
		}

		const allMatches: Array<{
			similarity: number;
			clusterValue: VALUE;
			clusterName: string;
		}> = [];

		for (const embedding of clusterEmbeddings) {
			const similarity = cosineSimilarity(valueEmbedding, embedding.embedding);

			if (similarity >= this.settings.similarityThreshold) {
				allMatches.push({
					similarity,
					clusterValue: embedding.clusterValue,
					clusterName: embedding.clusterName,
				});
			}
		}

		// sort (highest similarity first)
		allMatches.sort((a, b) => b.similarity - a.similarity);

		logger.log('All matches', allMatches);
		const countClusterNames = new Set(allMatches.map(m => m.clusterName));

		// If there are multiple clusters, and the highest similarity is less than 0.99, return null
		if (countClusterNames.size > 1 && allMatches[0].similarity < 0.99) {
			return {
				class: null,
				rawResponse: undefined,
			};
		}

		return {
			class:
				allMatches.length > 0
					? (allMatches[0].clusterName as unknown as ClusterNames<CLUSTERS>)
					: null,
			rawResponse: undefined,
		};
	}

	get settingsForEvent(): Partial<
		PersistentEmbeddingSimilarityClassifierSettings<VALUE, CLUSTERS>
	> {
		const eventSettingProperties: Array<string> = [
			'clusters',
			'embeddingModel',
			'similarityThreshold',
			'modelName',
		];

		return Object.fromEntries(
			Object.entries(this.settings).filter(([key]) => eventSettingProperties.includes(key))
		);
	}

	withSettings(
		additionalSettings: Partial<PersistentEmbeddingSimilarityClassifierSettings<VALUE, CLUSTERS>>
	): this {
		return new PersistentEmbeddingSimilarityClassifier(
			Object.assign({}, this.settings, additionalSettings)
		) as this;
	}
}
