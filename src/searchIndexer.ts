import { App, TFile } from 'obsidian';
import { removeStopwords } from './stopwords';
import { COMMAND_PREFIXES } from './main';
import { PluginDatabase } from './database/PluginDatabase';

/**
 * Search result
 */
export interface SearchResult {
	file: TFile;
	fileName: string;
	path: string;
	score: number;
	matches: {
		text: string;
		position: number;
	}[];
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

	constructor({ app, dbName, conversationFolder }: Props) {
		this.app = app;
		this.db = new PluginDatabase(dbName);
		this.conversationFolder = conversationFolder;
		this.setupEventListeners();
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
	private setupEventListeners() {
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
						this.queueFileForIndexing(file.path);
					} else {
						// Remove from index if it contains commands
						this.removeFromIndex(file.path);
					}
				}
			}
		});

		// Listen for file deletions
		this.app.vault.on('delete', file => {
			if (file instanceof TFile && file.extension === 'md') {
				this.removeFromIndex(file.path);
			}
		});

		// Listen for file renames
		this.app.vault.on('rename', async (file, oldPath: string) => {
			if (file instanceof TFile && file.extension === 'md') {
				this.removeFromIndex(oldPath);

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
		});
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
			console.error('Error processing indexing queue:', error);
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
		await this.db.transaction('rw', [this.db.documents, this.db.terms], async () => {
			// Delete document from documents table
			await this.db.documents.delete(filePath);

			// Delete all terms associated with the document
			await this.db.terms.where('documentId').equals(filePath).delete();
		});
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

			// Create or update document in the index
			await this.db.transaction('rw', [this.db.documents, this.db.terms], async () => {
				// First remove old terms for this document
				await this.db.terms.where('documentId').equals(file.path).delete();

				// Tokenize content and calculate document length
				const terms = this.tokenizeContent(content);
				const tokenCount = content.split(/\s+/).length;

				// Create or update document
				await this.db.documents.put({
					id: file.path,
					fileName: file.basename,
					path: file.path,
					content,
					lastModified: file.stat.mtime,
					tags: [...new Set(tags)], // Deduplicate tags
					tokenCount: tokenCount, // Store token count for TF calculation
				});

				// Batch add terms
				const termBatch = terms.map(term => {
					return {
						term: term.term,
						documentId: file.path,
						frequency: term.count,
						positions: term.positions,
					};
				});

				await this.db.terms.bulkAdd(termBatch);
			});
		} catch (error) {
			console.error(`Error indexing file ${file.path}:`, error);
		}
	}

	/**
	 * Calculate TF (Term Frequency) score
	 * TF = (Number of times term t appears in a document) / (Total number of terms in the document)
	 */
	private calculateTF(termFreq: number, docLength: number): number {
		if (docLength === 0) return 0;
		return termFreq / docLength;
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
	 * Get approximate document length
	 * This is a quick estimation based on content length divided by average word length
	 */
	private getDocumentLength(content: string): number {
		// A more accurate approach would be to count tokens from tokenizeContent
		// But this is faster for a quick approximation
		if (!content || content.trim() === '') {
			return 0;
		}
		return content.split(/\s+/).filter(Boolean).length;
	}

	/**
	 * Tokenize content into terms with positions
	 */
	private tokenizeContent(content: string): { term: string; count: number; positions: number[] }[] {
		// Normalize content - lowercase but preserve apostrophes and Unicode characters
		const normalizedContent = content.toLowerCase();

		// Use a regex that keeps apostrophes within words and Unicode characters
		// This preserves contractions like "I'm" and non-English characters
		const words = normalizedContent
			.replace(/[^\p{L}\p{N}'\u2019\s#_-]/gu, ' ') // Keep letters, numbers, apostrophes, hashtags, underscores, hyphens
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
					console.error(`Error checking file ${file.path}:`, error);
				}
			}
		}
	}

	/**
	 * Search the index for a query using TF-IDF scoring
	 */
	public async search(query: string, limit = 10): Promise<SearchResult[]> {
		// Normalize and tokenize the query
		const queryTerms = this.tokenizeContent(query).map(t => t.term);

		console.log('queryTerms', queryTerms);

		if (queryTerms.length === 0) return [];

		// Get matching documents with term frequencies
		const results = await this.db.transaction('r', [this.db.documents, this.db.terms], async () => {
			// Get total document count for IDF calculation
			const totalDocuments = await this.db.documents.count();

			// Get term results with document frequency information
			const termResultPromises = queryTerms.map(async term => {
				const results = await this.db.terms.where('term').equals(term).toArray();
				// Count unique documents containing this term
				const docsWithTerm = new Set(results.map(r => r.documentId)).size;
				// Calculate IDF for this term
				const idf = this.calculateIDF(totalDocuments, docsWithTerm);
				return { term, results, idf };
			});

			const termResults = await Promise.all(termResultPromises);

			// Flatten results and calculate TF-IDF scores for each document
			const documentScores = new Map<string, number>();
			const termMatches = new Map<string, Map<string, number[]>>();
			const documentLengths = new Map<string, number>();

			// First pass: collect document information and term positions
			for (const { term, results } of termResults) {
				for (const result of results) {
					const { documentId, positions } = result;

					// Track term positions for highlighting
					if (!termMatches.has(documentId)) {
						termMatches.set(documentId, new Map());
					}
					termMatches.get(documentId)?.set(term, positions);
				}
			}

			// Get document details for TF calculation
			const documentIds = Array.from(termMatches.keys());
			const documents = await this.db.documents.where('id').anyOf(documentIds).toArray();

			// Calculate document lengths and store for TF calculation
			for (const doc of documents) {
				documentLengths.set(doc.id, doc.tokenCount || this.getDocumentLength(doc.content));
			}

			// Second pass: calculate TF-IDF scores
			for (const { results, idf } of termResults) {
				for (const result of results) {
					const { documentId, frequency } = result;
					const docLength = documentLengths.get(documentId) || 1;

					// Calculate TF for this term in this document
					const tf = this.calculateTF(frequency, docLength);

					// Calculate TF-IDF score
					const tfIdfScore = tf * idf;

					// Add to document scores
					const currentScore = documentScores.get(documentId) || 0;
					documentScores.set(documentId, currentScore + tfIdfScore);
				}
			}

			console.log('TF-IDF documentScores', documentScores);

			// Sort documents by score
			return documents
				.map(doc => {
					const score = documentScores.get(doc.id) || 0;
					const termPositions = termMatches.get(doc.id) || new Map();

					// Extract context for matches
					const matches = this.extractMatches(doc.content, termPositions);

					return {
						file: this.app.vault.getAbstractFileByPath(doc.id) as TFile,
						fileName: doc.fileName,
						path: doc.path,
						score,
						matches,
					};
				})
				.sort((a, b) => b.score - a.score)
				.slice(0, limit);
		});

		return results;
	}

	/**
	 * Extract text context around matches
	 */
	private extractMatches(content: string, termPositions: Map<string, number[]>) {
		const lines = content.split('\n');
		const matches: { text: string; position: number }[] = [];
		const seenLines = new Set<number>();

		// Find line numbers for each position
		let positionIndex = 0;
		const lineMap = new Map<number, number>(); // Maps position to line number

		for (let i = 0; i < lines.length; i++) {
			const lineLength = lines[i].length + 1; // +1 for newline

			for (let j = 0; j < lineLength; j++) {
				lineMap.set(positionIndex, i);
				positionIndex++;
			}
		}

		// Process each term's positions
		for (const positions of termPositions.values()) {
			for (const position of positions) {
				const lineNumber = lineMap.get(position) || 0;

				// Skip if we've already included this line
				if (seenLines.has(lineNumber)) continue;

				seenLines.add(lineNumber);

				// Get the text for this match (the entire line)
				const text = lines[lineNumber];

				if (text && text.trim()) {
					matches.push({
						text,
						position: lineNumber,
					});

					// Also include the next line for context if available
					if (lineNumber + 1 < lines.length && !seenLines.has(lineNumber + 1)) {
						seenLines.add(lineNumber + 1);
						matches.push({
							text: lines[lineNumber + 1],
							position: lineNumber + 1,
						});
					}
				}
			}
		}

		// Sort matches by position
		return matches.sort((a, b) => a.position - b.position);
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
			console.error('Error checking if index is built:', error);
			return false;
		}
	}
}
