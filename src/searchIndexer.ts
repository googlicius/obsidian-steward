import { App, EventRef, TFile, MarkdownView } from 'obsidian';
import { removeStopwords } from './stopwords';
import { COMMAND_PREFIXES } from './main';
import {
	IndexedDocument,
	IndexedFolder,
	IndexedTerm,
	PluginDatabase,
	TermSource,
} from './database/PluginDatabase';
import { SearchOperationV2 } from './lib/modelfusion';
import { logger } from './utils/logger';

interface ScoredDocument extends IndexedDocument {
	score: number;
	// keywordsMatched?: string[];
}

export interface ScoredKeywordsMatchedDoc extends ScoredDocument {
	keywordsMatched: string[];
}

/**
 * Search result
 */
export interface SearchResult {
	file: TFile;
	fileName: string;
	path: string;
	score: number;
}

/**
 * Paginated search results
 */
export interface PaginatedSearchResults {
	documents: SearchResult[];
	totalCount: number;
	page: number;
	limit: number;
	totalPages: number;
}

export interface PaginatedSearchResultV2 {
	documents: (IndexedDocument | ScoredKeywordsMatchedDoc)[];
	totalCount: number;
	page: number;
	limit: number;
	totalPages: number;
}

interface Props {
	app: App;
	dbName: string;
	conversationFolder: string;
}

export class SearchIndexer {
	private db: PluginDatabase;
	private indexingQueue: string[] = [];
	private isIndexing = false;
	private app: App;
	private conversationFolder: string;
	private static readonly TERM_MATCH_THRESHOLD = 0.7;
	// Simple cache for current note
	private cachedNotePath: string | null = null;
	private cachedNoteTermsCount = 0;

	constructor({ app, dbName, conversationFolder }: Props) {
		this.app = app;
		this.db = new PluginDatabase(dbName);
		this.conversationFolder = conversationFolder;
	}

	/**
	 * Check if content contains command prefixes
	 */
	private containsCommandPrefix(content: string): boolean {
		const commandPrefixPattern = new RegExp(
			`^\\s*(${COMMAND_PREFIXES.join('|').replace(/\//g, '\\/')})\\b`,
			'm'
		);
		return commandPrefixPattern.test(content);
	}

	/**
	 * Set up event listeners for file changes
	 */
	public setupEventListeners(): EventRef[] {
		const eventRefs: EventRef[] = [];

		// Listen for active leaf changes to update the cache
		eventRefs.push(
			this.app.workspace.on('active-leaf-change', async leaf => {
				const view = leaf?.view;
				if (view instanceof MarkdownView && view.file) {
					const file = view.file;
					// Skip files in the conversation folder
					if (
						!file.path.startsWith(this.app.vault.configDir + '/' + this.conversationFolder) &&
						!file.path.startsWith(this.conversationFolder + '/')
					) {
						await this.updateCachedNote(file);
					} else {
						// Clear cache if in conversation folder
						this.clearCachedNote();
					}
				}
			})
		);

		eventRefs.push(
			// Listen for file modifications
			this.app.vault.on('modify', async file => {
				if (file instanceof TFile && file.extension === 'md') {
					// Skip files in the conversation folder
					if (
						!file.path.startsWith(this.app.vault.configDir + '/' + this.conversationFolder) &&
						!file.path.startsWith(this.conversationFolder + '/')
					) {
						// Check if file content contains command prefixes before indexing
						const content = await this.app.vault.read(file);

						if (!this.containsCommandPrefix(content)) {
							// Check if this is the cached note
							if (this.cachedNotePath === file.path) {
								// Get new terms count
								const newTerms = this.tokenizeContent(content);
								const newTermsCount = newTerms.length;

								// If terms count differs, reindex
								if (this.cachedNoteTermsCount !== newTermsCount) {
									logger.log(
										`Terms count changed for ${file.path}: ${this.cachedNoteTermsCount} -> ${newTermsCount}`
									);
									this.queueFileForIndexing(file.path);

									// Update cache with new terms count
									this.cachedNoteTermsCount = newTermsCount;
								} else {
									logger.log(`Terms count unchanged for ${file.path}, skipping indexing`);
								}
							} else {
								// Not the cached note, proceed with normal indexing
								this.queueFileForIndexing(file.path);
							}
						} else {
							// Remove from index if it contains commands
							// this.removeFromIndex(file.path);

							// Clear cache if this was the cached note
							if (this.cachedNotePath === file.path) {
								this.clearCachedNote();
							}
						}
					}
				}
			}),
			// Listen for file deletions
			this.app.vault.on('delete', file => {
				if (file instanceof TFile && file.extension === 'md') {
					this.removeFromIndex(file.path);

					// Clear cache if this was the cached note
					if (this.cachedNotePath === file.path) {
						this.clearCachedNote();
					}
				}
			}),
			// Listen for file renames
			this.app.vault.on('rename', async (file, oldPath: string) => {
				if (file instanceof TFile && file.extension === 'md') {
					this.removeFromIndex(oldPath);

					// Update cache if this was the cached note
					if (this.cachedNotePath === oldPath) {
						this.cachedNotePath = file.path;
					}

					// Skip files in the conversation folder
					if (
						!file.path.startsWith(this.app.vault.configDir + '/' + this.conversationFolder) &&
						!file.path.startsWith(this.conversationFolder + '/')
					) {
						// Check if file content contains command prefixes before indexing
						const content = await this.app.vault.read(file);

						if (!this.containsCommandPrefix(content)) {
							this.queueFileForIndexing(file.path);
						}
					}
				}
			})
		);

		return eventRefs;
	}

	/**
	 * Update the cached note terms count
	 */
	private async updateCachedNote(file: TFile): Promise<void> {
		try {
			const content = await this.app.vault.read(file);

			// Skip files with command prefixes
			if (this.containsCommandPrefix(content)) {
				this.clearCachedNote();
				return;
			}

			// Update cache
			this.cachedNotePath = file.path;
			this.cachedNoteTermsCount = this.tokenizeContent(content).length;

			logger.log(`Updated cached note: ${file.path} with ${this.cachedNoteTermsCount} terms`);
		} catch (error) {
			logger.error(`Error updating cached note ${file.path}:`, error);
			this.clearCachedNote();
		}
	}

	/**
	 * Clear the cached note data
	 */
	private clearCachedNote(): void {
		this.cachedNotePath = null;
		this.cachedNoteTermsCount = 0;
	}

	/**
	 * Queue a file for indexing
	 */
	private queueFileForIndexing(filePath: string) {
		if (!this.indexingQueue.includes(filePath)) {
			this.indexingQueue.push(filePath);
			this.processQueue();
		}
	}

	/**
	 * Process the indexing queue
	 */
	private async processQueue() {
		if (this.isIndexing || this.indexingQueue.length === 0) return;

		this.isIndexing = true;

		try {
			const filePath = this.indexingQueue.shift();
			if (!filePath) return;
			const file = this.app.vault.getAbstractFileByPath(filePath);

			if (file instanceof TFile && file.extension === 'md') {
				await this.indexFile(file);
			}
		} catch (error) {
			logger.error('Error processing indexing queue:', error);
		} finally {
			this.isIndexing = false;
			// Continue processing if there are more files
			if (this.indexingQueue.length > 0) {
				this.processQueue();
			}
		}
	}

	/**
	 * Remove a file from the index
	 */
	private async removeFromIndex(filePath: string) {
		await this.db.transaction(
			'rw',
			[this.db.documents, this.db.terms, this.db.folders],
			async () => {
				// Get the folder path from the file path
				const folderPath = filePath.substring(0, filePath.lastIndexOf('/'));

				// Find the document by file path
				const document = await this.db.documents.where('path').equals(filePath).first();

				if (document) {
					// Delete all terms associated with the document
					await this.db.terms
						.where('documentId')
						.equals(document.id as number)
						.delete();

					// Delete the document
					await this.db.documents.delete(document.id as number);
				}

				// Get folder ID for this path
				const folder = await this.db.folders.where('path').equals(folderPath).first();

				// If we found a folder, check if it should be removed
				if (folder && folder.id !== undefined) {
					// Check if this was the last file in this folder
					const hasDocumentsInFolder = await this.db.documents
						.where('path')
						.startsWith(folderPath + '/')
						.count();

					// If no more files in this folder, remove the folder from the folders table
					if (hasDocumentsInFolder === 0) {
						await this.db.folders.delete(folder.id);
					}
				}
			}
		);
	}

	/**
	 * Index a single file
	 */
	private async indexFile(file: TFile) {
		try {
			// Skip files in the conversation folder
			if (
				file.path.startsWith(this.app.vault.configDir + '/' + this.conversationFolder) ||
				file.path.startsWith(this.conversationFolder + '/')
			) {
				return;
			}

			const content = await this.app.vault.read(file);

			// Skip files with command prefixes
			if (this.containsCommandPrefix(content)) {
				return;
			}

			const cache = this.app.metadataCache.getFileCache(file);

			// Extract tags from content and frontmatter
			const tags: string[] = [];
			if (cache?.tags) {
				tags.push(...cache.tags.map(t => t.tag));
			}

			if (cache?.frontmatter?.tags) {
				if (Array.isArray(cache.frontmatter.tags)) {
					tags.push(...cache.frontmatter.tags.map((t: string) => `#${t}`));
				} else if (typeof cache.frontmatter.tags === 'string') {
					tags.push(`#${cache.frontmatter.tags}`);
				}
			}

			// Extract the folder path from the file path
			const folderPath = file.path.substring(0, file.path.lastIndexOf('/'));
			const folderName = folderPath.split('/').pop() || '';

			// Create or update document in the index
			await this.db.transaction(
				'rw',
				[this.db.documents, this.db.terms, this.db.folders],
				async () => {
					// Get folder ID first (needed for terms)
					const folderId = await this.indexFolder(folderPath, folderName);

					// Process document and get document ID
					const documentId = await this.indexDocument(file, content, tags);

					// Process terms using document and folder IDs
					await this.indexTerms(content, documentId, folderId, file.basename);
				}
			);
		} catch (error) {
			logger.error(`Error indexing file ${file.path}:`, error);
		}
	}

	/**
	 * Index a folder and return its ID
	 * @param folderPath The full path to the folder
	 * @param folderName The name of the folder (last segment of path)
	 * @returns The folder ID (auto-generated or existing)
	 */
	private async indexFolder(folderPath: string, folderName: string): Promise<number> {
		// Default to 0 if no folder path exists
		if (!folderPath) {
			return 0;
		}

		// Check if folder exists already
		const folder = await this.db.folders.where('path').equals(folderPath).first();

		if (!folder) {
			// Add new folder
			const id = await this.db.folders.add({
				path: folderPath,
				name: folderName,
			});
			return id;
		} else {
			return folder.id as number;
		}
	}

	/**
	 * Index a document and return its ID
	 * @param file The TFile to index
	 * @param content The content of the file
	 * @param tags Array of tags extracted from the file
	 * @returns The document ID (auto-generated or existing)
	 */
	private async indexDocument(file: TFile, content: string, tags: string[]): Promise<number> {
		// Find existing document by path
		const existingDoc = await this.db.documents.where('path').equals(file.path).first();

		const fileName = file.basename;

		// Calculate token count
		const tokenCount = content.split(/\s+/).length;

		const documentData = {
			path: file.path,
			fileName,
			lastModified: file.stat.mtime,
			tags: [...new Set(tags)],
			tokenCount,
		};

		if (existingDoc) {
			// Update existing document
			const documentId = existingDoc.id as number;
			await this.db.documents.update(documentId, documentData);

			// Remove existing terms for this document
			await this.db.terms.where('documentId').equals(documentId).delete();

			return documentId;
		} else {
			// Create new document
			return await this.db.documents.add(documentData);
		}
	}

	/**
	 * Index terms for a document
	 * @param content The content to tokenize and index
	 * @param documentId The ID of the document containing the terms
	 * @param folderId The ID of the folder containing the document
	 */
	private async indexTerms(
		content: string,
		documentId: number,
		folderId: number,
		fileName: string
	): Promise<void> {
		// Tokenize content
		const contentTerms = this.tokenizeContent(content);

		// Tokenize filename
		const filenameTerms = this.tokenizeContent(fileName);

		// Batch add content terms
		const contentTermBatch = contentTerms.map(term => {
			return {
				term: term.term,
				documentId: documentId,
				folderId: folderId || 0, // Use 0 as fallback if no folder ID
				source: TermSource.Content,
				frequency: term.count,
				positions: term.positions,
			};
		});

		// Batch add filename terms
		const filenameTermBatch = filenameTerms.map(term => {
			return {
				term: term.term,
				documentId: documentId,
				folderId: folderId || 0, // Use 0 as fallback if no folder ID
				source: TermSource.Filename,
				frequency: term.count,
				positions: term.positions,
			};
		});

		// Combine both batches and add to database
		const allTerms = [...contentTermBatch, ...filenameTermBatch];
		await this.db.terms.bulkAdd(allTerms);
	}

	/**
	 * Calculate TF (Term Frequency) score with sub-linear scaling
	 * This uses 1 + log(tf) scaling to prevent bias against longer documents
	 */
	private calculateTF(termFreq: number, docLength: number): number {
		if (docLength === 0 || termFreq === 0) return 0;

		// Use sub-linear scaling: 1 + log(tf)
		// This reduces the impact of high frequency terms in long documents
		return (1 + Math.log10(termFreq)) / Math.log10(1 + docLength);
	}

	/**
	 * Calculate IDF (Inverse Document Frequency) score
	 * IDF = log(Total number of documents / Number of documents containing term t)
	 */
	private calculateIDF(totalDocs: number, docsWithTerm: number): number {
		if (docsWithTerm === 0) return 0;
		return Math.log(totalDocs / docsWithTerm);
	}

	/**
	 * Tokenize content into terms with positions
	 */
	private tokenizeContent(content: string): { term: string; count: number; positions: number[] }[] {
		// Remove HTML comments
		const withoutHtmlComments = content.replace(/<!--[\s\S]*?-->/g, ' ');

		// Normalize content - lowercase but preserve apostrophes and Unicode characters
		const normalizedContent = withoutHtmlComments.toLowerCase();

		// Use a regex that keeps apostrophes within words and Unicode characters
		// This preserves contractions like "I'm" and non-English characters
		// Filter out consecutive special characters (2 or more)
		const words = normalizedContent
			.replace(/[^\p{L}\p{N}'\u2019\s#_-]/gu, ' ') // Keep letters, numbers, apostrophes, hashtags, underscores, hyphens
			.replace(/[#_-]{2,}/g, ' ') // Filter out 2+ consecutive special characters
			.split(/\s+/)
			.filter(Boolean);

		// Remove stopwords
		const filteredWords = removeStopwords(words);

		// Count term frequencies and positions
		const termMap = new Map<string, { count: number; positions: number[] }>();

		filteredWords.forEach((word: string, position: number) => {
			if (!termMap.has(word)) {
				termMap.set(word, { count: 0, positions: [] });
			}

			const termData = termMap.get(word);
			if (!termData) return;
			termData.count++;
			termData.positions.push(position);
		});

		// Convert map to array
		return Array.from(termMap.entries()).map(([term, data]) => ({
			term,
			count: data.count,
			positions: data.positions,
		}));
	}

	getRootFolder() {
		return {
			id: 0,
			path: '',
			name: '/',
		};
	}
	/**
	 * Index all files in the vault
	 */
	public async indexAllFiles() {
		const files = this.app.vault.getMarkdownFiles();

		// Clear the current queue
		this.indexingQueue = [];

		// Add all files to the queue, excluding conversation folder files and files with commands
		for (const file of files) {
			if (!file.path.startsWith(this.conversationFolder + '/')) {
				try {
					// Check if file content contains command prefixes
					const content = await this.app.vault.read(file);

					if (!this.containsCommandPrefix(content)) {
						this.queueFileForIndexing(file.path);
					} else {
						// Remove from index if it contains commands
						this.removeFromIndex(file.path);
					}
				} catch (error) {
					logger.error(`Error checking file ${file.path}:`, error);
				}
			}
		}
	}

	/**
	 * Calculate a coverage bonus based on how many query terms are matched in a document
	 * @param matchedTermCount Number of query terms matched in the document
	 * @param totalTermCount Total number of query terms
	 * @returns Bonus multiplier between 0 and maxCoverageBonus
	 */
	private calculateCoverageBonus(matchedTermCount: number, totalTermCount: number): number {
		const maxCoverageBonus = 0.5; // Maximum bonus for full coverage
		if (totalTermCount === 0) return 0;

		// Calculate coverage ratio and apply a slightly progressive curve
		const coverageRatio = matchedTermCount / totalTermCount;
		// Exponential scaling gives slightly more weight to higher coverage
		return maxCoverageBonus * Math.pow(coverageRatio, 1.5);
	}

	/**
	 * Calculate a proximity bonus based on how close query terms appear to each other
	 * @param termPositions Map of term positions for each term
	 * @param queryTerms Array of query terms
	 * @returns Bonus multiplier between 0 and maxProximityBonus
	 */
	private calculateProximityBonus(
		termPositions: Map<string, number[]>,
		queryTerms: string[]
	): number {
		const maxProximityBonus = 0.5; // Maximum bonus for terms right next to each other
		const proximityThreshold = 10; // Window size to consider terms "close" to each other

		if (queryTerms.length <= 1 || termPositions.size <= 1) {
			return 0; // No proximity bonus for single term queries
		}

		// Find minimum distances between different terms
		const minDistances: number[] = [];
		const matchedTerms = Array.from(termPositions.keys());

		// For each pair of different terms, find minimum distance
		for (let i = 0; i < matchedTerms.length; i++) {
			const term1 = matchedTerms[i];
			const positions1 = termPositions.get(term1) || [];

			for (let j = i + 1; j < matchedTerms.length; j++) {
				const term2 = matchedTerms[j];
				const positions2 = termPositions.get(term2) || [];

				// Find minimum distance between any position of term1 and any position of term2
				let minDistance = proximityThreshold + 1; // Start with value greater than threshold

				for (const pos1 of positions1) {
					for (const pos2 of positions2) {
						const distance = Math.abs(pos1 - pos2);
						minDistance = Math.min(minDistance, distance);
					}
				}

				if (minDistance <= proximityThreshold) {
					minDistances.push(minDistance);
				}
			}
		}

		if (minDistances.length === 0) {
			return 0; // No terms within proximity threshold
		}

		// Average the minimum distances and invert so closer = higher bonus
		const avgMinDistance = minDistances.reduce((sum, dist) => sum + dist, 0) / minDistances.length;
		const proximityScore = Math.max(0, 1 - avgMinDistance / proximityThreshold);

		return maxProximityBonus * proximityScore;
	}

	public async searchV2(
		operations: SearchOperationV2[],
		options: { page?: number; limit?: number } = {}
	): Promise<PaginatedSearchResultV2> {
		const page = options.page || 1;
		const limit = options.limit || 10;

		if (operations.length === 0) {
			return {
				documents: [],
				totalCount: 0,
				page,
				limit,
				totalPages: 0,
			};
		}

		const documentsAcrossOperations: (IndexedDocument | ScoredKeywordsMatchedDoc)[] = [];

		for (const operation of operations) {
			const { filenames, folders = [], tags = [] } = operation;
			let matchedFilenameDocuments: IndexedDocument[] = [];
			let matchedFolders: IndexedFolder[] = [];

			if (folders.length > 0) {
				matchedFolders = await this.getFoldersByNames(folders);
			}

			if (filenames.length > 0) {
				matchedFilenameDocuments = await this.getDocumentsByNames(filenames);
			}

			const keywords = [];

			if (tags.length > 0) {
				keywords.push(...tags.map(tag => `#${tag}`));
			}

			if (operation.keywords.length > 0) {
				keywords.push(...operation.keywords);
			}

			const documents = await this.getDocuments(keywords, {
				scopedDocuments: matchedFilenameDocuments,
				folders: matchedFolders,
			});

			documentsAcrossOperations.push(...documents);
		}

		// Sort results by score if they have scores
		documentsAcrossOperations.sort((a, b) => {
			const scoreA = 'score' in a ? a.score : 0;
			const scoreB = 'score' in b ? b.score : 0;
			return scoreB - scoreA;
		});

		const startIndex = (page - 1) * limit;
		const endIndex = startIndex + limit;
		const paginatedDocuments = documentsAcrossOperations.slice(startIndex, endIndex);

		return {
			documents: paginatedDocuments,
			totalCount: documentsAcrossOperations.length,
			page,
			limit,
			totalPages: Math.ceil(documentsAcrossOperations.length / limit),
		};
	}

	/**
	 * Get documents based on keywords, scoped documents, and folders
	 * @param keywords Array of keywords to search for
	 * @param options Optional search options (scoped documents, folders)
	 * @returns Array of documents that match the search criteria
	 */
	private async getDocuments(
		keywords: string[],
		options: {
			scopedDocuments?: IndexedDocument[];
			folders?: IndexedFolder[];
		} = {}
	): Promise<(ScoredKeywordsMatchedDoc | IndexedDocument)[]> {
		try {
			const { scopedDocuments = [], folders = [] } = options;

			// If all parameters are empty, return empty array early
			if (keywords.length === 0 && scopedDocuments.length === 0 && folders.length === 0) {
				return [];
			}

			// Handle keyword-based search
			if (keywords.length > 0) {
				return this.getDocumentsFromKeywords(keywords, scopedDocuments, folders);
			}
			// Handle document-scoped search
			if (scopedDocuments.length > 0) {
				return this.getDocumentsFromScopedDocuments(scopedDocuments, folders);
			}
			// Handle folder-scoped search
			if (folders.length > 0) {
				return this.getDocumentsFromFolders(folders);
			}

			return [];
		} catch (error) {
			logger.error('Error retrieving documents:', error);
			return [];
		}
	}

	/**
	 * Get documents that match the given keywords
	 * @returns Array of documents with scores
	 */
	private async getDocumentsFromKeywords(
		keywords: string[],
		scopedDocuments: IndexedDocument[],
		folders: IndexedFolder[]
	): Promise<ScoredKeywordsMatchedDoc[]> {
		// Document ID -> ScoredDocument map to collect results
		const documentsMap = new Map<number, ScoredKeywordsMatchedDoc>();

		for (const keyword of keywords) {
			const terms = this.tokenizeContent(keyword).map(t => t.term);
			if (terms.length === 0) {
				continue;
			}

			const termEntries = await this.getTermEntriesForContent(terms, scopedDocuments, folders);
			const documentTermMap = this.groupTermEntriesByDocument(termEntries);

			// Get qualified document IDs for this keyword
			const keywordDocIds = this.getQualifiedDocumentIds(documentTermMap, terms);

			console.log('TERMS', terms);
			console.log('KEYWORD DOC IDS', keywordDocIds);
			if (keywordDocIds.length === 0) {
				continue;
			}

			// Fetch documents for these IDs
			const keywordDocuments = await this.db.documents.where('id').anyOf(keywordDocIds).toArray();

			// Calculate scores for this keyword
			const scoredDocuments = await this.calculateDocumentScores(keywordDocuments, [keyword]);

			// Merge into overall result map
			for (const doc of scoredDocuments) {
				const docId = doc.id as number;
				// doc.keywordsMatched = [keyword];

				if (documentsMap.has(docId)) {
					// Document already exists, update score and keywords matched
					const existingDoc = documentsMap.get(docId) as ScoredKeywordsMatchedDoc;
					existingDoc.score += doc.score;
					existingDoc.keywordsMatched = [...(existingDoc.keywordsMatched || []), ...[keyword]];
				} else {
					// New document, add to map
					documentsMap.set(docId, { ...doc, keywordsMatched: [keyword] });
				}
			}
		}

		console.log('DOCUMENTS', documentsMap.values());

		// Convert map values to array and return
		return Array.from(documentsMap.values());
	}

	/**
	 * Get documents from scoped documents filtered by folders
	 * @returns Array of documents
	 */
	private async getDocumentsFromScopedDocuments(
		scopedDocuments: IndexedDocument[],
		folders: IndexedFolder[]
	): Promise<IndexedDocument[]> {
		const documentIdArray = scopedDocuments.map(doc => doc.id as number);
		const folderIdArray = folders.map(folder => folder.id as number);

		const termEntries = await this.db.terms
			.where('documentId')
			.anyOf(documentIdArray)
			.and(item => this.isFolderMatch(item.folderId, folderIdArray, folders.length))
			.toArray();

		// Convert to Set to remove duplicates
		const documentIds = new Set(termEntries.map(entry => entry.documentId));

		// Return empty array if no matching documents
		if (documentIds.size === 0) {
			return [];
		}

		// Fetch and return the actual documents
		return await this.db.documents
			.where('id')
			.anyOf([...documentIds])
			.toArray();
	}

	/**
	 * Get documents from folders
	 * @returns Array of documents
	 */
	private async getDocumentsFromFolders(folders: IndexedFolder[]): Promise<IndexedDocument[]> {
		const folderIdArray = folders.map(folder => folder.id as number);

		const termEntries = await this.db.terms.where('folderId').anyOf(folderIdArray).toArray();

		// Convert to Set to remove duplicates
		const documentIds = new Set(termEntries.map(entry => entry.documentId));

		// Return empty array if no matching documents
		if (documentIds.size === 0) {
			return [];
		}

		// Fetch and return the actual documents
		return await this.db.documents
			.where('id')
			.anyOf([...documentIds])
			.toArray();
	}

	/**
	 * Get term entries that match the specified content terms, with optional document and folder filtering
	 */
	private async getTermEntriesForContent(
		terms: string[],
		scopedDocuments: IndexedDocument[],
		folders: IndexedFolder[]
	): Promise<IndexedTerm[]> {
		// Pre-compute arrays for better performance
		const documentIdArray = scopedDocuments.map(doc => doc.id as number);
		const folderIdArray = folders.map(folder => folder.id as number);

		return await this.db.terms
			.where('term')
			.anyOf(terms)
			.and(item => item.source === TermSource.Content)
			.and(item => this.isDocumentMatch(item.documentId, documentIdArray, scopedDocuments.length))
			.and(item => this.isFolderMatch(item.folderId, folderIdArray, folders.length))
			.toArray();
	}

	/**
	 * Check if a document ID matches the scope criteria
	 */
	private isDocumentMatch(
		documentId: number,
		documentIds: number[],
		documentCount: number
	): boolean {
		return documentCount === 0 || documentIds.includes(documentId);
	}

	/**
	 * Check if a folder ID matches the scope criteria
	 */
	private isFolderMatch(folderId: number, folderIds: number[], folderCount: number): boolean {
		return folderCount === 0 || folderIds.includes(folderId);
	}

	/**
	 * Group term entries by document ID
	 * @returns Map of document IDs to sets of terms
	 */
	private groupTermEntriesByDocument(termEntries: IndexedTerm[]): Map<number, Set<string>> {
		const documentTermMap = new Map<number, Set<string>>();

		for (const entry of termEntries) {
			const { documentId, term } = entry;
			if (!documentTermMap.has(documentId)) {
				documentTermMap.set(documentId, new Set());
			}
			documentTermMap.get(documentId)?.add(term);
		}

		return documentTermMap;
	}

	/**
	 * Get document IDs that meet the term match threshold
	 * @returns Array of qualified document IDs
	 */
	private getQualifiedDocumentIds(
		documentTermMap: Map<number, Set<string>>,
		terms: string[]
	): number[] {
		const qualifiedIds: number[] = [];

		for (const [documentId, docTermsSet] of documentTermMap.entries()) {
			if (docTermsSet.size / terms.length >= SearchIndexer.TERM_MATCH_THRESHOLD) {
				qualifiedIds.push(documentId);
			}
		}

		return qualifiedIds;
	}

	/**
	 * Get folders by names
	 * @param names Array of name patterns to match
	 * @returns Array of matched folders
	 */
	private async getFoldersByNames(names: string[]) {
		if (names.length === 0) return [];
		const matchedFolders: IndexedFolder[] = [];

		const allFolders = await this.db.folders.toArray();
		allFolders.push(this.getRootFolder());

		for (const name of names) {
			const matches = allFolders.filter(folder => new RegExp(name, 'i').test(folder.name));

			// Only accept if exactly one match
			if (matches.length > 0) {
				matchedFolders.push(...matches);
			}
		}

		return matchedFolders;
	}

	/**
	 * Get documents by (partial) names
	 * @param names Array of name patterns to match
	 * @returns Array of matched documents
	 */
	private async getDocumentsByNames(names: string[]) {
		if (names.length === 0) return [];
		const matchedDocuments: IndexedDocument[] = [];

		for (const name of names) {
			const terms = this.tokenizeContent(name).map(t => t.term);
			if (terms.length === 0) continue;

			const documentIdSets: Set<number>[] = [];
			const termEntries = await this.db.terms
				.where('term')
				.anyOf(terms)
				.and(item => item.source === TermSource.Filename)
				.toArray();
			const ids = new Set(termEntries.map(entry => entry.documentId));
			documentIdSets.push(ids);

			// Find intersection of all sets (documents that have all terms in filename)
			let commonIds = documentIdSets[0];
			for (let i = 1; i < documentIdSets.length; i++) {
				commonIds = new Set([...commonIds].filter(id => documentIdSets[i].has(id)));
			}

			// Only accept if exactly one document matches all terms
			if (commonIds.size === 1) {
				const docId = [...commonIds][0];
				const doc = await this.db.documents.get(docId);
				if (doc) {
					matchedDocuments.push(doc);
				}
			}
		}

		return matchedDocuments;
	}

	/**
	 * Calculate TF-IDF scores for documents with coverage and proximity bonuses
	 * @param documents Documents to score
	 * @param queries Queries used for scoring
	 * @returns Documents with added score property and keywords matched
	 */
	private async calculateDocumentScores(
		documents: IndexedDocument[],
		queries: string[]
	): Promise<ScoredDocument[]> {
		if (documents.length === 0 || queries.length === 0) {
			return documents.map(doc => ({ ...doc, score: 0 }));
		}

		return await this.db.transaction('r', [this.db.documents, this.db.terms], async () => {
			// Get total document count for IDF calculation
			const totalDocuments = await this.db.documents.count();

			// Collect all terms from queries
			const allQueryTerms: string[] = [];
			for (const query of queries) {
				const terms = this.tokenizeContent(query).map(t => t.term);
				allQueryTerms.push(...terms);
			}

			// Deduplicate terms
			const uniqueQueryTerms = [...new Set(allQueryTerms)];

			// Get term results with document frequency information
			const termResultPromises = uniqueQueryTerms.map(async term => {
				// Build query for terms
				const termQuery = this.db.terms.where('term').equals(term);
				const results = await termQuery.toArray();

				// Count unique documents containing this term
				const docsWithTerm = new Set(results.map(r => r.documentId)).size;
				// Calculate IDF for this term
				const idf = this.calculateIDF(totalDocuments, docsWithTerm);

				return { term, results, idf };
			});

			const termResults = await Promise.all(termResultPromises);

			// Prepare data structures for scoring
			const documentScores = new Map<number, number>();
			const termMatches = new Map<number, Map<string, number[]>>();
			const documentLengths = new Map<number, number>();
			const documentMatchedTerms = new Map<number, Set<string>>();
			const documentHasFilenameMatch = new Map<number, boolean>();

			// Extract document IDs for lookup
			const documentIds = documents.map(doc => doc.id as number);

			// Calculate document lengths and store for TF calculation
			for (const doc of documents) {
				documentLengths.set(doc.id as number, doc.tokenCount || 0);
			}

			// First pass: collect document information and term positions
			for (const { term, results } of termResults) {
				for (const result of results) {
					const { documentId, positions, source } = result;

					// Skip if document is not in our set
					if (!documentIds.includes(documentId)) {
						continue;
					}

					// Track filename matches
					if (source === TermSource.Filename) {
						documentHasFilenameMatch.set(documentId, true);
					}

					// Track which terms match in each document
					if (!documentMatchedTerms.has(documentId)) {
						documentMatchedTerms.set(documentId, new Set());
					}
					documentMatchedTerms.get(documentId)?.add(term);

					// Track term positions for highlighting and proximity calculation
					if (!termMatches.has(documentId)) {
						termMatches.set(documentId, new Map());
					}

					// Combine positions if the term already exists
					const existingPositions = termMatches.get(documentId)?.get(term) || [];
					termMatches.get(documentId)?.set(term, [...existingPositions, ...positions]);
				}
			}

			// Second pass: calculate TF-IDF scores
			for (const { results, idf } of termResults) {
				for (const result of results) {
					const { documentId, frequency, source } = result;

					// Skip if document is not in our set
					if (!documentIds.includes(documentId)) {
						continue;
					}

					const docLength = documentLengths.get(documentId) || 1;

					// Calculate TF for this term in this document
					const tf = this.calculateTF(frequency, docLength);

					// Calculate TF-IDF score with a bonus for filename matches
					let tfIdfScore = tf * idf;

					// Apply a boost for filename matches
					if (source === TermSource.Filename) {
						tfIdfScore *= 2.0; // Higher weight for filename matches
					}

					// Add to document scores
					const currentScore = documentScores.get(documentId) || 0;
					documentScores.set(documentId, currentScore + tfIdfScore);
				}
			}

			// Apply term coverage and proximity bonuses
			for (const [documentId, matchedTerms] of documentMatchedTerms.entries()) {
				const currentScore = documentScores.get(documentId) || 0;

				// Calculate coverage bonus
				const coverageBonus = this.calculateCoverageBonus(
					matchedTerms.size,
					uniqueQueryTerms.length
				);

				// Calculate proximity bonus
				const docTermPositions = termMatches.get(documentId) || new Map();
				const proximityBonus = this.calculateProximityBonus(docTermPositions, uniqueQueryTerms);

				// Apply a bonus for documents with filename matches
				const filenameBonus = documentHasFilenameMatch.get(documentId) ? 0.5 : 0;

				// Apply combined bonuses
				const totalBonus = coverageBonus + proximityBonus + filenameBonus;
				documentScores.set(documentId, currentScore * (1 + totalBonus));
			}

			// Add scores to documents and return
			return documents.map(doc => {
				const docId = doc.id as number;
				const score = documentScores.get(docId) || 0;
				// Track the matched keywords for this document
				return {
					...doc,
					score,
				};
			});
		});
	}

	/**
	 * Check if the index has been built already
	 * @returns Promise<boolean> True if the index has at least one entry, false if empty
	 */
	public async isIndexBuilt(): Promise<boolean> {
		try {
			// Just check if at least one document exists, rather than counting all documents
			const firstDoc = await this.db.documents.limit(1).first();
			return firstDoc !== undefined;
		} catch (error) {
			logger.error('Error checking if index is built:', error);
			return false;
		}
	}
}
