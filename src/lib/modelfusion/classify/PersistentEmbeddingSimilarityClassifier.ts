import { embed, embedMany, cosineSimilarity, EmbeddingModel } from 'ai';
import { EmbeddingModelV1 } from '@ai-sdk/provider';
import { EmbeddingsDatabase, EmbeddingEntry } from 'src/database/EmbeddingsDatabase';
import { logger } from 'src/utils/logger';
import { getQualifiedCandidates } from 'src/utils/getQualifiedCandidates';
import * as CryptoJS from 'crypto-js';
import { similarity } from 'src/utils/similarity';
import { getValidCommandTypes } from 'src/lib/modelfusion/prompts/commands';

export interface ValueCluster {
  name: string;
  values: string[];
}

export interface Settings {
  staticClusterValues?: ValueCluster[];
  prefixedClusterValue?: ValueCluster[];
  clusters: ValueCluster[];
  embeddingModel: EmbeddingModel<string> | EmbeddingModelV1<string>;
  similarityThreshold: number;
  modelName?: string;
  forceRefresh?: boolean;
  refreshClusters?: string[];
  ignoreEmbedding?: boolean; // Flag to indicate if embedding similarity check should be ignored
}

type EmbeddingCache<T> = {
  embedding: number[];
  clusterValue: T;
  clusterName: string;
  id?: number; // Add ID to the in-memory embeddings
};

/**
 * Classifies values based on their distance to the values from a set of clusters.
 * When the distance is below a certain threshold, the value is classified as belonging to the cluster,
 * and the cluster name is returned. Otherwise, the value is classified as null.
 *
 * This version persists embeddings to IndexedDB for faster startup times.
 */
export class PersistentEmbeddingSimilarityClassifier {
  readonly settings: Settings;
  private db: EmbeddingsDatabase;

  /**
   * Static cache to share embeddings across instances
   */
  private static embeddingsCache: unknown;

  private get embeddings() {
    return PersistentEmbeddingSimilarityClassifier.embeddingsCache as
      | Array<EmbeddingCache<string>>
      | undefined;
  }

  private set embeddings(value: Array<EmbeddingCache<string>> | undefined) {
    PersistentEmbeddingSimilarityClassifier.embeddingsCache = value;
  }

  constructor(settings: Settings) {
    this.settings = settings;
    this.db = new EmbeddingsDatabase();
  }

  /**
   * Get model name used for storage
   */
  getModelStorageName(): string {
    if (!this.settings.modelName) {
      throw new Error(
        'modelName is required in settings for PersistentEmbeddingSimilarityClassifier'
      );
    }
    return this.settings.modelName;
  }

  /**
   * Generate a version hash for a specific cluster
   * @param cluster The cluster to hash
   */
  private generateClusterHash(cluster: ValueCluster): string {
    // Sort values for consistent hash
    const sortedValues = [...cluster.values].sort();
    // Create a string representation
    const clusterString = JSON.stringify({
      name: cluster.name,
      values: sortedValues,
    });
    // Generate a hash using crypto-js MD5
    return CryptoJS.MD5(clusterString).toString();
  }

  /**
   * Check which clusters have changed by comparing version hashes
   * @returns Map of cluster names that need to be refreshed
   */
  private async detectChangedClusters(): Promise<Map<string, ValueCluster>> {
    try {
      const modelName = this.getModelStorageName();

      // Get stored versions of all clusters
      const storedVersions = await this.db.getAllClusterVersions(modelName);

      // Map to store clusters that need to be refreshed
      const changedClusters = new Map<string, ValueCluster>();

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
      const allClusters = new Map<string, ValueCluster>();
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
   * Validate if a cluster name contains valid command types
   * @param clusterName The cluster name to validate (may contain multiple command types separated by ':')
   * @returns true if all command types in the cluster are valid, false otherwise
   */
  private isValidClusterName(clusterName: string): boolean {
    const validCommandTypes = new Set(getValidCommandTypes());
    const commandTypes = clusterName.split(':');

    for (const commandType of commandTypes) {
      // Extract base type (before ? or :)
      const [baseType] = commandType.split(/[?:]/, 1);
      if (!validCommandTypes.has(baseType)) {
        return false;
      }
    }

    return true;
  }

  /**
   * Validate a cluster name and handle invalid clusters by deleting them
   * @param clusterName The cluster name to validate
   * @returns The cluster name if valid, null if invalid (and cluster will be deleted)
   */
  private validateAndHandleCluster(clusterName: string): string | null {
    if (this.isValidClusterName(clusterName)) {
      return clusterName;
    } else {
      logger.warn(`Cluster "${clusterName}" contains invalid command types. Deleting cluster.`);
      // Delete invalid cluster asynchronously (don't await to avoid blocking)
      this.deleteCluster(clusterName).catch(error => {
        logger.error(`Failed to delete invalid cluster "${clusterName}":`, error);
      });
      return null;
    }
  }

  /**
   * Public method to delete a cluster by name
   * Removes embeddings and cluster version from the database
   * Also removes from in-memory cache if present
   * @param clusterName The name of the cluster to delete
   */
  async deleteCluster(clusterName: string): Promise<void> {
    try {
      // Remove from database
      await this.removeClusterEmbeddings(clusterName);

      // Remove from in-memory cache if present
      if (this.embeddings) {
        this.embeddings = this.embeddings.filter(e => e.clusterName !== clusterName);
      }

      logger.log(`Deleted cluster "${clusterName}"`);
    } catch (error) {
      logger.error(`Error deleting cluster "${clusterName}":`, error);
      throw error;
    }
  }

  /**
   * Load embeddings of the current embedding model from IndexedDB, detecting which clusters need refresh
   * @returns Object containing loaded embeddings and clusters that need refresh
   */
  private async loadEmbeddingsFromDb(): Promise<{
    embeddings: Array<{
      embedding: number[];
      clusterValue: string;
      clusterName: string;
      id?: number;
    }>;
    changedClusters: Map<string, ValueCluster>;
  }> {
    try {
      const modelName = this.getModelStorageName();
      const embeddings: Array<{
        embedding: number[];
        clusterValue: string;
        clusterName: string;
        id?: number;
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
          clusterValue: embedding.valueText,
          clusterName: embedding.clusterName,
          id: embedding.id,
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
            clusterValue: entry.valueText,
            clusterName: entry.clusterName,
            id: entry.id,
          }))
        );
      }

      return { embeddings, changedClusters };
    } catch (error) {
      logger.error('Error loading embeddings from database:', error);
      // On error, refresh all clusters
      const allClusters = new Map<string, ValueCluster>();
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
        embedding: number[];
        clusterValue: string;
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
   * Get embeddings of the current embedding model for all clusters, either from memory, database, or by generating new ones
   */
  async getEmbeddings(): Promise<EmbeddingCache<string>[]> {
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
    const allEmbeddings = [...embeddings];

    for (const cluster of changedClusters.values()) {
      logger.log(
        `Generating embeddings for cluster "${cluster.name}" (${cluster.values.length} values)`
      );

      const { embeddings: clusterEmbeddings } = await embedMany({
        model: this.settings.embeddingModel as EmbeddingModel<string>,
        values: cluster.values,
      });

      const processedEmbeddings = [];
      for (let i = 0; i < clusterEmbeddings.length; i++) {
        processedEmbeddings.push({
          embedding: clusterEmbeddings[i],
          clusterValue: cluster.values[i],
          clusterName: cluster.name,
        });
      }

      // Save this cluster's embeddings to the database immediately
      const clusterMap = new Map<string, typeof processedEmbeddings>();
      clusterMap.set(cluster.name, processedEmbeddings);
      await this.saveEmbeddingsForClusters(clusterMap);

      // Add to the combined embeddings array
      allEmbeddings.push(...processedEmbeddings);
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
   * Delete embeddings by value across all clusters
   * @param value The value text to delete embeddings for
   */
  async deleteEmbeddingsByValue(value: string): Promise<void> {
    const modelName = this.getModelStorageName();

    if (this.embeddings) {
      // If we have embeddings in memory, use them to find IDs to delete
      const embeddingsToDelete = this.embeddings.filter(e => {
        const score = similarity(e.clusterValue, value);
        return score > 0.7 && e.id !== undefined;
      });

      if (embeddingsToDelete.length > 0) {
        const ids = embeddingsToDelete.map(e => e.id as number);
        // Delete by IDs if we found any
        await this.db.embeddings.bulkDelete(ids);
        logger.log(
          `Deleted ${embeddingsToDelete.length} existing embeddings for value "${value}" using in-memory IDs, deleted embeddings:`,
          embeddingsToDelete
        );
      }

      // Update in-memory embeddings by removing all with this value
      this.embeddings = this.embeddings.filter(e => e.clusterValue !== value);
    } else {
      // If we don't have embeddings in memory, use the database method
      await this.db.deleteEmbeddingsByValue(modelName, value);
      logger.log(`Deleted existing embeddings close to value "${value}" using database query`);
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

      // Check if the value already exists in the database for this specific cluster
      const existingEmbedding = await this.db.getEmbeddingByValue(modelName, clusterName, value);

      // If embedding exists in this cluster and ignoreEmbedding is false, return early
      if (existingEmbedding && !this.settings.ignoreEmbedding) {
        logger.log(
          `Embedding for value "${value}" under cluster "${clusterName}" of the ${modelName} already exists`,
          existingEmbedding
        );
        return;
      }

      // If embedding exists and ignoreEmbedding is true, log that we'll update it
      if (existingEmbedding && this.settings.ignoreEmbedding) {
        logger.log(
          `Re-embedding value "${value}" under cluster "${clusterName}" due to ignoreEmbedding flag`
        );
      }

      // Generate embedding for the value
      const { embedding } = await embed({
        model: this.settings.embeddingModel as EmbeddingModel<string>,
        value,
      });

      // Delete all embeddings with this value across all clusters
      await this.deleteEmbeddingsByValue(value);

      // Save the new embedding to database
      const newId = await this.db.storeEmbeddings([
        {
          modelName,
          clusterName,
          valueText: value,
          embedding,
          createdAt: Date.now(),
        },
      ]);

      // Add the new embedding to in-memory cache if it exists
      if (this.embeddings) {
        this.embeddings.push({
          embedding,
          clusterValue: value,
          clusterName,
          id: newId,
        });
      }

      logger.log(`Saved embedding for value "${value}" under cluster "${clusterName}"`);
    } catch (error) {
      logger.error('Failed to save embedding:', error);
      throw error;
    }
  }

  async doClassify(value: string): Promise<string | null> {
    if (this.settings.staticClusterValues) {
      for (const cluster of this.settings.staticClusterValues) {
        if (cluster.values.includes(value.toLowerCase())) {
          return cluster.name;
        }
      }
    }

    if (this.settings.prefixedClusterValue) {
      for (const cluster of this.settings.prefixedClusterValue) {
        for (const clusterValue of cluster.values) {
          if (value.toLowerCase().startsWith(clusterValue.toLowerCase())) {
            return this.validateAndHandleCluster(cluster.name);
          }
        }
      }
    }

    // If ignoreEmbedding is set, skip the embedding similarity check
    if (this.settings.ignoreEmbedding) {
      logger.log('Ignoring embedding similarity check');
      return null;
    }

    // Race between getEmbeddings and timeout
    const [embeddingResult, clusterEmbeddings] = await Promise.all([
      Promise.race([
        embed({
          model: this.settings.embeddingModel as EmbeddingModel<string>,
          value,
        }),
        new Promise<null>(resolve => {
          setTimeout(() => {
            resolve(null);
          }, 2000);
        }),
      ]),
      Promise.race([
        this.getEmbeddings(),
        new Promise<null>(resolve => {
          setTimeout(() => {
            resolve(null);
          }, 2000);
        }),
      ]),
    ]);

    if (!clusterEmbeddings) {
      logger.warn('Cluster embeddings not found or timed out.');
      return null;
    }

    if (!embeddingResult) {
      logger.warn('Embedding not found or timed out.');
      return null;
    }

    const candidates = clusterEmbeddings.map(item => {
      return {
        candidate: {
          clusterName: item.clusterName,
          clusterValue: item.clusterValue,
          id: item.id,
        },
        score: cosineSimilarity(embeddingResult.embedding, item.embedding),
      };
    });

    const qualifiedCandidates = getQualifiedCandidates(candidates, {
      minCount: 1,
      minThreshold: this.settings.similarityThreshold,
      bucketSize: 0.01,
    });

    logger.log(`Found ${qualifiedCandidates.length} qualified candidates`, qualifiedCandidates);

    if (qualifiedCandidates.length > 0) {
      const clusterName = qualifiedCandidates[0].candidate.clusterName;
      return this.validateAndHandleCluster(clusterName);
    }

    return null;
  }

  get settingsForEvent(): Partial<Settings> {
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

  withSettings(additionalSettings: Partial<Settings>): this {
    return new PersistentEmbeddingSimilarityClassifier(
      Object.assign({}, this.settings, additionalSettings)
    ) as this;
  }
}
