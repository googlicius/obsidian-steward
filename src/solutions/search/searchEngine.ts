import { TFile } from 'obsidian';
import { DocumentStore } from './documentStore';
import { Tokenizer } from './tokenizer';
import { Scoring, ScoredKeywordsMatchedDoc } from './scoring';
import {
	IndexedDocument,
	IndexedFolder,
	IndexedTerm,
	TermSource,
} from '../../database/SearchDatabase';
import { SearchOperationV2 } from '../../lib/modelfusion';
import { logger } from '../../utils/logger';
import { similarity } from '../../utils/similarity';

// Interface for exact phrase match
interface ExactPhraseMatch {
	originalPhrase: string;
	tokens: string[];
}

export interface SearchResult {
	file: TFile;
	fileName: string;
	path: string;
	score: number;
}

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

export interface SearchEngineConfig {
	documentStore: DocumentStore;
	tokenizer: Tokenizer;
	scoring: Scoring;
	termMatchThreshold?: number;
	similarityThreshold?: number;
}

export class SearchEngine {
	private documentStore: DocumentStore;
	private tokenizer: Tokenizer;
	private scoring: Scoring;
	private readonly TERM_MATCH_THRESHOLD: number;
	private readonly SIMILARITY_THRESHOLD: number;

	constructor({
		documentStore,
		tokenizer,
		scoring,
		termMatchThreshold = 0.7,
		similarityThreshold = 0.7,
	}: SearchEngineConfig) {
		this.documentStore = documentStore;
		this.tokenizer = tokenizer;
		this.scoring = scoring;
		this.TERM_MATCH_THRESHOLD = termMatchThreshold;
		this.SIMILARITY_THRESHOLD = similarityThreshold;
	}

	/**
	 * Get folders by names
	 */
	private async getFoldersByNames(names: string[]): Promise<IndexedFolder[]> {
		if (names.length === 0) return [];
		const matchedFolders: IndexedFolder[] = [];

		const allFolders = await this.documentStore.getAllFolders();
		allFolders.push(this.documentStore.getRootFolder());

		for (const name of names) {
			const matches = allFolders.filter(folder => {
				const nameReg = new RegExp(name, 'i');
				return nameReg.test(folder.name) || nameReg.test(folder.path);
			});

			// Only accept if exactly one match
			if (matches.length > 0) {
				matchedFolders.push(...matches);
			}
		}

		return matchedFolders;
	}

	/**
	 * Get documents by names using similarity matching
	 */
	private async getDocumentsByNames(names: string[]): Promise<IndexedDocument[]> {
		if (names.length === 0) return [];
		const matchedDocuments: IndexedDocument[] = [];

		for (const name of names) {
			const terms = this.tokenizer.getUniqueTerms(name);
			if (terms.length === 0) continue;

			// Get document IDs from term entries
			const termEntries = await this.documentStore.getTermsByValue(terms);

			// Extract unique document IDs from term entries
			const documentIds = [...new Set(termEntries.map(entry => entry.documentId))];

			// If no matching documents found, continue to next name
			if (documentIds.length === 0) continue;

			// Fetch the documents for these IDs
			const documents = await this.documentStore.getDocumentsByIds(documentIds);

			// Filter documents by similarity score
			for (const doc of documents) {
				// Calculate similarity between search name and document name
				const similarityScore = similarity(name, doc.fileName);

				// If similarity is above threshold, add to matched documents
				if (similarityScore >= this.SIMILARITY_THRESHOLD) {
					matchedDocuments.push(doc);
				}
			}
		}

		return matchedDocuments;
	}

	/**
	 * Get documents based on keywords, scoped documents, and folders
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
				logger.warn('All parameters are empty');
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
	 * Check if a keyword is an exact phrase (wrapped in quotes)
	 * @param keyword The keyword to check
	 * @returns The exact phrase details or null if not an exact phrase
	 */
	private checkForExactPhrase(keyword: string): ExactPhraseMatch | null {
		const exactPhraseRegex = /^["'](.+)["']$/;
		const match = keyword.match(exactPhraseRegex);

		if (match) {
			const phrase = match[1];
			const tokens = this.tokenizer.getUniqueTerms(phrase);
			return {
				originalPhrase: phrase,
				tokens,
			};
		}

		return null;
	}

	/**
	 * Get documents that match the given keywords
	 */
	private async getDocumentsFromKeywords(
		keywords: string[],
		scopedDocuments: IndexedDocument[],
		folders: IndexedFolder[]
	): Promise<ScoredKeywordsMatchedDoc[]> {
		// Document ID -> ScoredDocument map to collect results
		const documentsMap = new Map<number, ScoredKeywordsMatchedDoc>();

		for (const keyword of keywords) {
			// Check if this is an exact phrase match
			const exactPhrase = this.checkForExactPhrase(keyword);

			if (exactPhrase) {
				// Handle exact phrase matching
				await this.handleExactPhraseMatch(exactPhrase, documentsMap, scopedDocuments, folders);
				continue;
			}

			// Regular keyword matching (existing code)
			const terms = this.tokenizer.getUniqueTerms(keyword);
			if (terms.length === 0) {
				continue;
			}

			const termEntries = await this.getTermEntriesForContent(terms, scopedDocuments, folders);
			const documentTermMap = this.groupTermEntriesByDocument(termEntries);

			// Get qualified document IDs for this keyword
			const keywordDocIds = this.getQualifiedDocumentIds(documentTermMap, terms);

			if (keywordDocIds.length === 0) {
				continue;
			}

			// Fetch documents for these IDs
			const keywordDocuments = await this.documentStore.getDocumentsByIds(keywordDocIds);

			// Calculate scores for this keyword
			const scoredDocuments = await this.scoring.calculateDocumentScores(keywordDocuments, [
				keyword,
			]);

			// Merge into overall result map
			for (const doc of scoredDocuments) {
				const docId = doc.id as number;

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

		// Convert map values to array and return
		return Array.from(documentsMap.values());
	}

	/**
	 * Handle exact phrase matching
	 * @param exactPhrase The exact phrase to match
	 * @param documentsMap Map to store matched documents
	 * @param scopedDocuments Optional documents to scope the search
	 * @param folders Optional folders to scope the search
	 */
	private async handleExactPhraseMatch(
		exactPhrase: ExactPhraseMatch,
		documentsMap: Map<number, ScoredKeywordsMatchedDoc>,
		scopedDocuments: IndexedDocument[],
		folders: IndexedFolder[]
	): Promise<void> {
		const { originalPhrase, tokens } = exactPhrase;

		if (tokens.length === 0) {
			return;
		}

		// Get term entries for all tokens in the phrase
		const termEntries = await this.getTermEntriesForContent(tokens, scopedDocuments, folders);

		// Group by document ID
		const documentTermsMap = new Map<number, Map<string, number[]>>();

		// For each term entry, store the positions by document and term
		for (const entry of termEntries) {
			const { documentId, term, positions } = entry;

			if (!documentTermsMap.has(documentId)) {
				documentTermsMap.set(documentId, new Map());
			}

			const termsMap = documentTermsMap.get(documentId);
			if (!termsMap?.has(term)) {
				termsMap?.set(term, []);
			}

			termsMap?.get(term)?.push(...positions);
		}

		// Get documents that have all the tokens
		const potentialDocIds = Array.from(documentTermsMap.keys()).filter(docId => {
			const termsMap = documentTermsMap.get(docId);
			// Check if document has all tokens from the phrase
			return tokens.every(token => termsMap?.has(token));
		});

		if (potentialDocIds.length === 0) {
			return;
		}

		// For each potential document, check if it contains the exact phrase
		const exactMatchDocIds: number[] = [];

		for (const docId of potentialDocIds) {
			const termsMap = documentTermsMap.get(docId);
			if (!termsMap) continue;

			// Check for consecutive positions
			if (this.hasConsecutiveTerms(termsMap, tokens)) {
				exactMatchDocIds.push(docId);
			}
		}

		if (exactMatchDocIds.length === 0) {
			return;
		}

		// Fetch documents for the exact match IDs
		const exactMatchDocs = await this.documentStore.getDocumentsByIds(exactMatchDocIds);

		// Apply very high scoring for exact matches
		const scoredDocuments = exactMatchDocs.map(doc => ({
			...doc,
			score: 10.0, // High score for exact matches
		}));

		// Merge into overall result map
		for (const doc of scoredDocuments) {
			const docId = doc.id as number;

			if (documentsMap.has(docId)) {
				// Document already exists, update score and keywords matched
				const existingDoc = documentsMap.get(docId) as ScoredKeywordsMatchedDoc;
				existingDoc.score += doc.score;
				existingDoc.keywordsMatched = [...(existingDoc.keywordsMatched || []), originalPhrase];
			} else {
				// New document, add to map
				documentsMap.set(docId, {
					...doc,
					score: doc.score,
					keywordsMatched: [originalPhrase],
				});
			}
		}
	}

	/**
	 * Check if a document has terms appearing consecutively
	 * @param termsMap Map of terms to their positions in the document
	 * @param tokens The tokens to check for consecutive positions
	 * @returns True if the terms appear consecutively, false otherwise
	 */
	private hasConsecutiveTerms(termsMap: Map<string, number[]>, tokens: string[]): boolean {
		if (tokens.length <= 1) {
			return true; // Single token is always "consecutive"
		}

		// Get all positions for the first token
		const firstTokenPositions = termsMap.get(tokens[0]) || [];

		// For each position of the first token, check if it starts a consecutive sequence
		for (const startPos of firstTokenPositions) {
			let isConsecutive = true;

			// Check if all other tokens appear in consecutive positions
			for (let i = 1; i < tokens.length; i++) {
				const expectedPos = startPos + i;
				const tokenPositions = termsMap.get(tokens[i]) || [];

				// If the expected position is not found, this is not a consecutive sequence
				if (!tokenPositions.includes(expectedPos)) {
					isConsecutive = false;
					break;
				}
			}

			// If we found a consecutive sequence, return true
			if (isConsecutive) {
				return true;
			}
		}

		// No consecutive sequence found
		return false;
	}

	/**
	 * Get documents from scoped documents filtered by folders
	 */
	private async getDocumentsFromScopedDocuments(
		scopedDocuments: IndexedDocument[],
		folders: IndexedFolder[]
	): Promise<IndexedDocument[]> {
		const documentIdArray = scopedDocuments.map(doc => doc.id as number);
		const folderIdArray = folders.map(folder => folder.id as number);

		const termEntries = await this.documentStore.terms
			.where('documentId')
			.anyOf(documentIdArray)
			.and(item => this.isFolderMatch(item.folderId, folderIdArray, folders.length))
			.toArray();
		const filteredEntries = termEntries.filter(
			item =>
				documentIdArray.includes(item.documentId) &&
				this.isFolderMatch(item.folderId, folderIdArray, folders.length)
		);

		// Convert to Set to remove duplicates
		const documentIds = new Set(filteredEntries.map(entry => entry.documentId));

		// Return empty array if no matching documents
		if (documentIds.size === 0) {
			return [];
		}

		// Fetch and return the actual documents
		return await this.documentStore.getDocumentsByIds([...documentIds]);
	}

	/**
	 * Get documents from folders
	 */
	private async getDocumentsFromFolders(folders: IndexedFolder[]): Promise<IndexedDocument[]> {
		const folderIdArray = folders.map(folder => folder.id as number);

		const termEntries = await this.documentStore.terms
			.where('folderId')
			.anyOf(folderIdArray)
			.toArray();
		const filteredEntries = termEntries.filter(item => folderIdArray.includes(item.folderId));

		// Convert to Set to remove duplicates
		const documentIds = new Set(filteredEntries.map(entry => entry.documentId));

		// Return empty array if no matching documents
		if (documentIds.size === 0) {
			logger.log(`No documents found in these folders`, folders);
			return [];
		}

		// Fetch and return the actual documents
		return await this.documentStore.getDocumentsByIds([...documentIds]);
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

		// Apply filtering
		return this.documentStore.terms
			.where('term')
			.anyOf(terms)
			.and(item => item.source === TermSource.Content)
			.and(item => this.isDocumentMatch(item.documentId, documentIdArray, scopedDocuments.length))
			.and(item => this.isFolderMatch(item.folderId, folderIdArray, folders.length))
			.toArray();
	}

	/**
	 * Check if a document ID matches the provided scope
	 */
	private isDocumentMatch(
		documentId: number,
		documentIdArray: number[],
		scopeLength: number
	): boolean {
		return scopeLength === 0 || documentIdArray.includes(documentId);
	}

	/**
	 * Check if a folder ID matches the provided scope
	 */
	private isFolderMatch(folderId: number, folderIdArray: number[], scopeLength: number): boolean {
		return scopeLength === 0 || folderIdArray.includes(folderId);
	}

	/**
	 * Group term entries by document
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
	 */
	private getQualifiedDocumentIds(
		documentTermMap: Map<number, Set<string>>,
		terms: string[]
	): number[] {
		const qualifiedIds: number[] = [];

		for (const [documentId, docTermsSet] of documentTermMap.entries()) {
			if (docTermsSet.size / terms.length >= this.TERM_MATCH_THRESHOLD) {
				qualifiedIds.push(documentId);
			}
		}

		return qualifiedIds;
	}

	/**
	 * Paginate search results
	 */
	public paginateResults(
		results: (IndexedDocument | ScoredKeywordsMatchedDoc)[],
		page = 1,
		limit = 20
	): PaginatedSearchResultV2 {
		const startIndex = (page - 1) * limit;
		const endIndex = startIndex + limit;
		return {
			documents: results.slice(startIndex, endIndex),
			totalCount: results.length,
			page,
			limit,
			totalPages: Math.ceil(results.length / limit),
		};
	}

	/**
	 * Search for documents using the provided operations
	 */
	public async searchV2(
		operations: SearchOperationV2[],
		options: { calculateScores?: boolean } = {}
	): Promise<(IndexedDocument | ScoredKeywordsMatchedDoc)[]> {
		if (operations.length === 0) {
			return [];
		}

		const documentsAcrossOperations: (IndexedDocument | ScoredKeywordsMatchedDoc)[] = [];

		for (const operation of operations) {
			const { filenames, folders = [], tags = [] } = operation;
			let matchedFilenameDocuments: IndexedDocument[] = [];
			let matchedFolders: IndexedFolder[] = [];

			if (folders.length > 0) {
				matchedFolders = await this.getFoldersByNames(folders);
				if (matchedFolders.length === 0) {
					logger.warn('No folders found with these names, skipped', folders);
					continue;
				}
			}

			if (filenames.length > 0) {
				matchedFilenameDocuments = await this.getDocumentsByNames(filenames);
				logger.log('matchedFilenameDocuments', matchedFilenameDocuments, filenames);
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

			logger.log('documents', documents);

			documentsAcrossOperations.push(...documents);
		}

		// Sort results by score if they have scores
		documentsAcrossOperations.sort((a, b) => {
			const scoreA = 'score' in a ? a.score : 0;
			const scoreB = 'score' in b ? b.score : 0;
			return scoreB - scoreA;
		});

		return documentsAcrossOperations;
	}

	/**
	 * Get a single document by name using similarity matching
	 * @param name The name of the document to find
	 * @returns The found document or null if not found
	 */
	public async getDocumentByName(name: string): Promise<IndexedDocument | null> {
		const documents = await this.getDocumentsByNames([name]);
		return documents.length > 0 ? documents[0] : null;
	}
}
