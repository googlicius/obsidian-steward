import { getQuotedQuery } from 'src/utils/getQuotedQuery';
import { Condition, ConditionResult } from './Condition';
import { ExactPhraseMatch } from '../types';
import { IndexedDocument, IndexedTerm, TermSource } from 'src/database/SearchDatabase';

const TERM_MATCH_THRESHOLD = 0.7;

/**
 * Condition for keyword search.
 */
export class KeywordCondition extends Condition<IndexedDocument> {
  constructor(private keywords: string[]) {
    super();
  }

  /**
   * Check if a keyword is an exact phrase (wrapped in quotes)
   * @param keyword The keyword to check
   * @returns The exact phrase details or null if not an exact phrase
   */
  private checkForExactPhrase(keyword: string): ExactPhraseMatch | null {
    const quotedContent = getQuotedQuery(keyword);

    if (quotedContent) {
      const phrase = quotedContent;
      const tokens = this.context.contentTokenizer.getUniqueTerms(phrase);
      return {
        originalPhrase: phrase,
        tokens,
      };
    }

    return null;
  }

  /**
   * Get term entries that match the specified content terms
   */
  private async getTermEntriesForContent(terms: string[]): Promise<IndexedTerm[]> {
    // Pre-compute arrays for better performance
    // const documentIdArray = scopedDocuments.map(doc => doc.id as number);
    // const folderIdArray = folders.map(folder => folder.id as number);

    // Apply filtering
    return (
      this.context.documentStore.terms
        .where('term')
        .anyOf(terms)
        .and(item => item.source === TermSource.Content)
        // .and(item => this.isDocumentMatch(item.documentId, documentIdArray, scopedDocuments.length))
        // .and(item => this.isFolderMatch(item.folderId, folderIdArray, folders.length))
        .toArray()
    );
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

    // Convert position arrays to Sets for O(1) lookup instead of O(n)
    const positionSets = new Map<string, Set<number>>();
    for (const token of tokens) {
      const positions = termsMap.get(token);
      if (!positions || positions.length === 0) {
        return false; // If any token is missing, no consecutive sequence possible
      }
      positionSets.set(token, new Set(positions));
    }

    // Get all positions for the first token
    const firstTokenPositions = positionSets.get(tokens[0]);
    if (!firstTokenPositions) {
      return false;
    }

    // For each position of the first token, check if it starts a consecutive sequence
    for (const startPos of firstTokenPositions) {
      let isConsecutive = true;

      // Check if all other tokens appear in consecutive positions
      for (let i = 1; i < tokens.length; i++) {
        const expectedPos = startPos + i;
        const tokenPositions = positionSets.get(tokens[i]);
        if (!tokenPositions) {
          isConsecutive = false;
          break;
        }

        // If the expected position is not found, this is not a consecutive sequence
        if (!tokenPositions.has(expectedPos)) {
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
   * Handle exact phrase matching
   * @param exactPhrase The exact phrase to match
   * @param documentsMap Map to store matched documents
   */
  private async handleExactPhraseMatch(
    exactPhrase: ExactPhraseMatch,
    documentsMap: Map<number, ConditionResult<IndexedDocument>>
  ): Promise<void> {
    const { originalPhrase, tokens } = exactPhrase;

    if (tokens.length === 0) {
      return;
    }

    // Get term entries for all tokens in the phrase
    const termEntries = await this.getTermEntriesForContent(tokens);

    if (termEntries.length === 0) {
      return;
    }

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
    const exactMatchDocs = await this.context.documentStore.getDocumentsByIds(exactMatchDocIds);

    // Merge into overall result map
    for (const doc of exactMatchDocs) {
      const docId = doc.id as number;

      if (documentsMap.has(docId)) {
        // Document already exists, update score and keywords matched
        const existingResult = documentsMap.get(docId);
        if (existingResult) {
          existingResult.score += 10.0; // High score for exact matches
          existingResult.keywordsMatched = [
            ...(existingResult.keywordsMatched || []),
            originalPhrase,
          ];
        }
      } else {
        // New document, add to map
        documentsMap.set(docId, {
          document: doc,
          score: 10.0, // High score for exact matches
          keywordsMatched: [originalPhrase],
        });
      }
    }
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
      if (docTermsSet.size / terms.length >= TERM_MATCH_THRESHOLD) {
        qualifiedIds.push(documentId);
      }
    }

    return qualifiedIds;
  }

  async evaluate() {
    const documentsMap = new Map<number, ConditionResult<IndexedDocument>>();

    for (const keyword of this.keywords) {
      // Check if this is an exact phrase match
      const exactPhrase = this.checkForExactPhrase(keyword);

      if (exactPhrase) {
        // Handle exact phrase matching
        await this.handleExactPhraseMatch(exactPhrase, documentsMap);
        continue;
      }

      // Regular keyword matching (existing code)
      const terms = this.context.contentTokenizer.getUniqueTerms(keyword);
      if (terms.length === 0) {
        continue;
      }

      const termEntries = await this.getTermEntriesForContent(terms);
      const documentTermMap = this.groupTermEntriesByDocument(termEntries);

      // Get qualified document IDs for this keyword
      const keywordDocIds = this.getQualifiedDocumentIds(documentTermMap, terms);

      if (keywordDocIds.length === 0) {
        continue;
      }

      // Fetch documents for these IDs
      const keywordDocuments = await this.context.documentStore.getDocumentsByIds(keywordDocIds);

      // Calculate scores for this keyword using pre-tokenized terms
      const scoredDocumentsMap = await this.context.scoring.calculateDocumentScores(
        keywordDocuments,
        terms
      );

      // Filter out documents with 0 proximity bonus and merge into overall result map
      for (const [docId, scoredDoc] of scoredDocumentsMap.entries()) {
        // Skip documents with 0 proximity bonus
        if (scoredDoc.proximityBonus === 0) {
          continue;
        }

        if (documentsMap.has(docId)) {
          const existingResult = documentsMap.get(docId);
          if (existingResult) {
            existingResult.score += scoredDoc.score;
            existingResult.keywordsMatched = [...(existingResult.keywordsMatched || []), keyword];
          }
        } else {
          documentsMap.set(docId, {
            document: scoredDoc.document,
            score: scoredDoc.score,
            keywordsMatched: [keyword],
          });
        }
      }
    }

    return documentsMap;
  }
}
