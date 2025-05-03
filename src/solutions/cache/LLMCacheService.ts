import { LLMCacheDatabase, LLMCacheEntry } from '../../database/LLMCacheDatabase';
import { similarity } from '../../utils/similarity';
import { logger } from '../../utils/logger';

export class LLMCacheService {
	private db: LLMCacheDatabase;
	private static readonly SIMILARITY_THRESHOLD = 0.7;
	private static readonly CACHE_EXPIRY_DAYS = 30;

	constructor() {
		this.db = new LLMCacheDatabase();
	}

	/**
	 * Get a cached response for a query
	 * @param query The user query
	 * @returns The cached response if found, null otherwise
	 */
	async getCachedResponse(query: string): Promise<string | null> {
		try {
			// First try exact match across all command types
			const exactMatch = await this.db.exactMatches.where('query').equals(query).first();

			if (exactMatch) {
				await this.updateLastAccessed(exactMatch);
				return exactMatch.response;
			}

			// If no exact match, try similarity match across all command types
			const similarityMatches = await this.db.similarityMatches.toArray();

			for (const match of similarityMatches) {
				const score = similarity(query, match.query);
				if (score >= LLMCacheService.SIMILARITY_THRESHOLD) {
					await this.updateLastAccessed(match);
					return match.response;
				}
			}

			return null;
		} catch (error) {
			logger.error('Error getting cached response:', error);
			return null;
		}
	}

	/**
	 * Cache a response for a query
	 * @param query The user query
	 * @param response The LLM response
	 * @param commandType The type of command from the validated result
	 */
	async cacheResponse(query: string, response: string, commandType: string): Promise<void> {
		try {
			const now = Date.now();
			const entry: LLMCacheEntry = {
				query,
				response,
				commandType,
				createdAt: now,
				lastAccessed: now,
				matchType: this.determineMatchType(commandType),
			};

			if (entry.matchType === 'exact') {
				await this.db.exactMatches.add(entry);
			} else {
				entry.similarityScore = 0; // Will be calculated on retrieval
				await this.db.similarityMatches.add(entry);
			}

			// Clean up expired entries
			await this.cleanupExpiredEntries();
		} catch (error) {
			logger.error('Error caching response:', error);
		}
	}

	/**
	 * Update the last accessed timestamp for a cache entry
	 * @param entry The cache entry to update
	 */
	private async updateLastAccessed(entry: LLMCacheEntry): Promise<void> {
		try {
			const table = entry.matchType === 'exact' ? this.db.exactMatches : this.db.similarityMatches;
			await table.update(entry.id!, { lastAccessed: Date.now() });
		} catch (error) {
			logger.error('Error updating last accessed:', error);
		}
	}

	/**
	 * Determine if a command type should use exact or similarity matching
	 * @param commandType The type of command
	 * @returns 'exact' or 'similarity'
	 */
	private determineMatchType(commandType: string): 'exact' | 'similarity' {
		const exactMatchTypes = [
			'search',
			'move',
			'move_from_search_result',
			'copy',
			'delete',
			'calc',
			'image',
			'audio',
		];
		return exactMatchTypes.includes(commandType) ? 'exact' : 'similarity';
	}

	/**
	 * Remove expired cache entries
	 */
	private async cleanupExpiredEntries(): Promise<void> {
		try {
			const expiryTime = Date.now() - LLMCacheService.CACHE_EXPIRY_DAYS * 24 * 60 * 60 * 1000;

			await this.db.exactMatches.where('lastAccessed').below(expiryTime).delete();

			await this.db.similarityMatches.where('lastAccessed').below(expiryTime).delete();
		} catch (error) {
			logger.error('Error cleaning up expired entries:', error);
		}
	}
}
