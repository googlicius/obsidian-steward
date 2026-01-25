import { termsProximity } from 'src/utils/termsProximity';
import { IndexedDocument, TermSource } from '../../database/SearchDatabase';
import { DocumentStore } from './documentStore';

export interface ScoredDocument extends IndexedDocument {
  score: number;
}

export interface DetailedScoredDocument {
  document: IndexedDocument;
  score: number;
  proximityBonus: number;
  filenameBonus: number;
  coverageBonus: number;
}

export interface ScoringConfig {
  maxCoverageBonus?: number;
  filenameMatchBoost?: number;
  filenameBonus?: number;
  /**
   * A scoring multiplier that determines the maximum bonus score a document can receive when query terms appear close together in the document.
   */
  maxProximityBonus?: number;
  /**
   * The maximum distance between query terms for which they are considered to be close together.
   */
  proximityThreshold?: number;
  /**
   * BM25 k1 parameter: Controls term frequency saturation.
   * Higher values make term frequency more important. Typical range: 1.2-2.0
   * @default 1.5
   */
  bm25K1?: number;
  /**
   * BM25 b parameter: Controls document length normalization.
   * 0 = no length normalization, 1 = full length normalization. Typical value: 0.75
   * @default 0.75
   */
  bm25B?: number;
}

export class Scoring {
  private documentStore: DocumentStore;
  private config: Required<ScoringConfig>;

  constructor(documentStore: DocumentStore, config: ScoringConfig = {}) {
    this.documentStore = documentStore;
    this.config = {
      maxCoverageBonus: 0.5,
      filenameMatchBoost: 2.0,
      filenameBonus: 0.5,
      maxProximityBonus: 5,
      proximityThreshold: 20,
      bm25K1: 1.5,
      bm25B: 0.75,
      ...config,
    };
  }

  /**
   * Calculate BM25 IDF (Inverse Document Frequency) score.
   * Uses the formula: log((N - n + 0.5) / (n + 0.5) + 1)
   * The +1 ensures non-negative values for all cases.
   *
   * @param totalDocs - Total number of documents in the corpus (N)
   * @param docsWithTerm - Number of documents containing the term (n)
   */
  private calculateBM25IDF(totalDocs: number, docsWithTerm: number): number {
    if (docsWithTerm === 0) return 0;
    return Math.log((totalDocs - docsWithTerm + 0.5) / (docsWithTerm + 0.5) + 1);
  }

  /**
   * Calculate BM25 term score for a term in a document.
   * Uses the formula: IDF * (tf * (k1 + 1)) / (tf + k1 * (1 - b + b * docLength / avgDocLength))
   *
   * @param termFreq - Term frequency in the document
   * @param docLength - Length of the document (token count)
   * @param avgDocLength - Average document length across the corpus
   * @param idf - Pre-calculated IDF for the term
   */
  private calculateBM25TermScore(
    termFreq: number,
    docLength: number,
    avgDocLength: number,
    idf: number
  ): number {
    if (termFreq <= 0 || docLength <= 0 || avgDocLength <= 0) return 0;

    const k1 = this.config.bm25K1;
    const b = this.config.bm25B;

    // BM25 term frequency component with length normalization
    const numerator = termFreq * (k1 + 1);
    const denominator = termFreq + k1 * (1 - b + b * (docLength / avgDocLength));

    return idf * (numerator / denominator);
  }

  /**
   * Calculate a coverage bonus based on how many query terms are matched in a document
   */
  private calculateCoverageBonus(matchedTermCount: number, totalTermCount: number): number {
    if (totalTermCount === 0) return 0;

    // Calculate coverage ratio and apply a slightly progressive curve
    const coverageRatio = matchedTermCount / totalTermCount;
    // Exponential scaling gives slightly more weight to higher coverage
    return this.config.maxCoverageBonus * Math.pow(coverageRatio, 1.5);
  }

  /**
   * Calculate a proximity bonus based on how close query terms appear to each other
   */
  private calculateProximityBonus(
    termPositions: Map<string, number[]>,
    queryTerms: string[]
  ): number {
    const proximityScore = this.calculateProximityScore(termPositions, queryTerms);

    return this.config.maxProximityBonus * proximityScore;
  }

  public calculateProximityScore(
    termPositions: Map<string, number[]>,
    queryTerms: string[]
  ): number {
    if (queryTerms.length === 0 || termPositions.size === 0) {
      return 0;
    }

    // For single term queries, return a high score since there's no proximity to measure
    if (queryTerms.length === 1) {
      return 0.9;
    }

    const { isProximity, minDistances } = termsProximity(
      termPositions,
      queryTerms,
      this.config.proximityThreshold
    );

    if (!isProximity) {
      return 0;
    }

    // Average the minimum distances and invert so closer = higher bonus
    const avgMinDistance = minDistances.reduce((sum, dist) => sum + dist, 0) / minDistances.length;
    const proximityScore = Math.max(0, 1 - avgMinDistance / this.config.proximityThreshold);

    return proximityScore;
  }

  /**
   * Calculate relevance scores for documents based on pre-tokenized search terms
   * using the BM25 (Best Matching 25) algorithm with additional bonuses.
   *
   * ## Scoring Algorithm
   *
   * ### 1. Base BM25 Score
   * For each term in each document:
   * - **IDF**: `log((N - n + 0.5) / (n + 0.5) + 1)` where N is total docs and n is docs with term.
   * - **Term Score**: `IDF * (tf * (k1 + 1)) / (tf + k1 * (1 - b + b * docLen / avgDocLen))`
   *   - `k1` (default 1.5): Controls term frequency saturation. Higher = TF matters more.
   *   - `b` (default 0.75): Controls length normalization. 0 = none, 1 = full normalization.
   * - Terms found in filenames receive a 2x boost (configurable via `filenameMatchBoost`).
   *
   * ### 2. Bonus Multipliers
   * The base BM25 score is multiplied by `(1 + totalBonus)` where totalBonus is the sum of:
   *
   * - **Coverage Bonus** (max 0.5): Rewards documents matching more query terms.
   *   Uses exponential scaling `maxCoverageBonus * (matchedTerms/totalTerms)^1.5`.
   *
   * - **Proximity Bonus** (max 5.0): Rewards documents where query terms appear close together.
   *   Based on average minimum distance between term pairs within `proximityThreshold` tokens.
   *
   * - **Filename Bonus** (0.5): Flat bonus for documents with any term matching in the filename.
   *
   * ### Processing Flow
   * 1. Fetch all term occurrences from the document store in a single batch request.
   * 2. Calculate average document length and BM25 IDF for each term.
   * 3. **First pass**: Collect term positions, track filename matches, and build matched terms set.
   * 4. **Second pass**: Calculate BM25 scores with filename boost.
   * 5. **Final pass**: Apply coverage, proximity, and filename bonuses to compute final scores.
   *
   * @param documents - Array of indexed documents to score
   * @param terms - Pre-tokenized search terms
   * @param totalDocuments - Optional total document count for IDF; fetched from store if not provided
   * @returns Map of document ID to DetailedScoredDocument with score breakdown
   */
  public async calculateDocumentScores(
    documents: IndexedDocument[],
    terms: string[],
    totalDocuments?: number
  ): Promise<Map<number, DetailedScoredDocument>> {
    if (documents.length === 0 || terms.length === 0) {
      const result = new Map<number, DetailedScoredDocument>();
      for (const doc of documents) {
        result.set(doc.id as number, {
          document: doc,
          score: 0,
          proximityBonus: 0,
          filenameBonus: 0,
          coverageBonus: 0,
        });
      }
      return result;
    }

    // Get total document count for IDF calculation if not provided
    const docCount = totalDocuments ?? (await this.documentStore.getTotalDocumentCount());

    // Get all term results with one request
    const allTermResults = await this.documentStore.getTermsByValue(terms);

    // Group results by term and calculate BM25 IDF for each term
    const termResults = terms.map(term => {
      const results = allTermResults.filter(r => r.term === term);
      const docsWithTerm = new Set(results.map(r => r.documentId)).size;
      const idf = this.calculateBM25IDF(docCount, docsWithTerm);
      return { term, results, idf };
    });

    // Prepare data structures for scoring
    const documentScores = new Map<number, number>();
    const termMatches = new Map<number, Map<string, number[]>>();
    const documentLengths = new Map<number, number>();
    const documentMatchedTerms = new Map<number, Set<string>>();
    const documentHasFilenameMatch = new Map<number, boolean>();

    // Extract document IDs for lookup
    const documentIds = documents.map(doc => doc.id as number);

    // Calculate document lengths and average document length for BM25
    let totalLength = 0;
    for (const doc of documents) {
      const docLength = doc.tokenCount || 0;
      documentLengths.set(doc.id as number, docLength);
      totalLength += docLength;
    }
    const avgDocLength = documents.length > 0 ? totalLength / documents.length : 1;

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

    // Second pass: calculate BM25 scores
    for (const { results, idf } of termResults) {
      for (const result of results) {
        const { documentId, frequency, source } = result;

        // Skip if document is not in our set
        if (!documentIds.includes(documentId)) {
          continue;
        }

        const docLength = documentLengths.get(documentId) || 1;

        // Calculate BM25 term score
        let bm25Score = this.calculateBM25TermScore(frequency, docLength, avgDocLength, idf);

        // Apply a boost for filename matches
        if (source === TermSource.Filename) {
          bm25Score *= this.config.filenameMatchBoost;
        }

        // Add to document scores
        const currentScore = documentScores.get(documentId) || 0;
        documentScores.set(documentId, currentScore + bm25Score);
      }
    }

    // Apply term coverage and proximity bonuses and build result map
    const result = new Map<number, DetailedScoredDocument>();

    for (const [documentId, matchedTerms] of documentMatchedTerms.entries()) {
      const currentScore = documentScores.get(documentId) || 0;

      // Calculate coverage bonus
      const coverageBonus = this.calculateCoverageBonus(matchedTerms.size, terms.length);

      // Calculate proximity bonus
      const docTermPositions = termMatches.get(documentId) || new Map();
      const proximityBonus = this.calculateProximityBonus(docTermPositions, terms);

      // Apply a bonus for documents with filename matches
      const filenameBonus = documentHasFilenameMatch.get(documentId)
        ? this.config.filenameBonus
        : 0;

      // Apply combined bonuses
      const totalBonus = coverageBonus + proximityBonus + filenameBonus;
      const finalScore = currentScore * (1 + totalBonus);

      // Find the document
      const document = documents.find(doc => (doc.id as number) === documentId);
      if (document) {
        result.set(documentId, {
          document,
          score: finalScore,
          proximityBonus,
          filenameBonus,
          coverageBonus,
        });
      }
    }

    return result;
  }
}
