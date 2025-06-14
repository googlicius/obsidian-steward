import { IndexedDocument, TermSource } from '../../database/SearchDatabase';
import { DocumentStore } from './documentStore';

export interface ScoredDocument extends IndexedDocument {
  score: number;
}

export interface ScoredKeywordsMatchedDoc extends ScoredDocument {
  keywordsMatched: string[];
}

export interface ScoringConfig {
  maxCoverageBonus?: number;
  maxProximityBonus?: number;
  filenameMatchBoost?: number;
  proximityThreshold?: number;
}

export class Scoring {
  private documentStore: DocumentStore;
  private config: Required<ScoringConfig>;

  constructor(documentStore: DocumentStore, config: ScoringConfig = {}) {
    this.documentStore = documentStore;
    this.config = {
      maxCoverageBonus: 0.5,
      maxProximityBonus: 0.5,
      filenameMatchBoost: 2.0,
      proximityThreshold: 10,
      ...config,
    };
  }

  /**
   * Calculate TF (Term Frequency) score with sub-linear scaling
   */
  private calculateTF(termFreq: number, docLength: number): number {
    if (docLength === 0 || termFreq === 0) return 0;

    // Use sub-linear scaling: 1 + log(tf)
    // This reduces the impact of high frequency terms in long documents
    return (1 + Math.log10(termFreq)) / Math.log10(1 + docLength);
  }

  /**
   * Calculate IDF (Inverse Document Frequency) score
   */
  private calculateIDF(totalDocs: number, docsWithTerm: number): number {
    if (docsWithTerm === 0) return 0;
    return Math.log(totalDocs / docsWithTerm);
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
        let minDistance = this.config.proximityThreshold + 1; // Start with value greater than threshold

        for (const pos1 of positions1) {
          for (const pos2 of positions2) {
            const distance = Math.abs(pos1 - pos2);
            minDistance = Math.min(minDistance, distance);
          }
        }

        if (minDistance <= this.config.proximityThreshold) {
          minDistances.push(minDistance);
        }
      }
    }

    if (minDistances.length === 0) {
      return 0; // No terms within proximity threshold
    }

    // Average the minimum distances and invert so closer = higher bonus
    const avgMinDistance = minDistances.reduce((sum, dist) => sum + dist, 0) / minDistances.length;
    const proximityScore = Math.max(0, 1 - avgMinDistance / this.config.proximityThreshold);

    return this.config.maxProximityBonus * proximityScore;
  }

  /**
   * Calculate scores for documents based on query terms
   */
  public async calculateDocumentScores(
    documents: IndexedDocument[],
    queries: string[]
  ): Promise<ScoredDocument[]> {
    if (documents.length === 0 || queries.length === 0) {
      return documents.map(doc => ({ ...doc, score: 0 }));
    }

    // Get total document count for IDF calculation
    const totalDocuments = await this.documentStore.getTotalDocumentCount();

    // Collect all terms from queries
    const allQueryTerms = queries.flatMap(query => query.split(/\s+/));
    const uniqueQueryTerms = [...new Set(allQueryTerms)];

    // Get term results with document frequency information
    const termResults = await Promise.all(
      uniqueQueryTerms.map(async term => {
        const results = await this.documentStore.getTermsByValue([term]);
        const docsWithTerm = new Set(results.map(r => r.documentId)).size;
        const idf = this.calculateIDF(totalDocuments, docsWithTerm);
        return { term, results, idf };
      })
    );

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
          tfIdfScore *= this.config.filenameMatchBoost;
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
      const coverageBonus = this.calculateCoverageBonus(matchedTerms.size, uniqueQueryTerms.length);

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
      return {
        ...doc,
        score,
      };
    });
  }
}
