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
      maxProximityBonus: 0.5,
      proximityThreshold: 10,
      ...config,
    };
  }

  /**
   * Calculate TF (Term Frequency) score with sub-linear scaling
   */
  private calculateTF(termFreq: number, docLength: number): number {
    if (docLength <= 0 || termFreq <= 0) return 0;
    if (termFreq === 1) return 1 / Math.log10(docLength); // Avoid log(1) = 0

    // Standard TF formula with sub-linear scaling
    return (1 + Math.log10(termFreq)) / Math.log10(docLength);
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

    // Find minimum distances between different terms
    const minDistances: number[] = [];
    const matchedTerms = Array.from(termPositions.keys()).filter(term => queryTerms.includes(term));

    // Check if all terms can be connected within the proximity threshold
    // We'll use a graph approach to find if all terms are reachable from each other
    const termPositionsList = matchedTerms.map(term => ({
      term,
      positions: termPositions.get(term) || [],
    }));

    // Create adjacency matrix for terms within threshold
    const adjacencyMatrix = new Map<string, Set<string>>();

    // Initialize adjacency sets
    for (const term of matchedTerms) {
      adjacencyMatrix.set(term, new Set());
    }

    // Build adjacency matrix - connect terms that are within threshold
    for (let i = 0; i < termPositionsList.length; i++) {
      const term1 = termPositionsList[i];
      for (let j = i + 1; j < termPositionsList.length; j++) {
        const term2 = termPositionsList[j];

        // Find minimum distance between any position of term1 and any position of term2
        let minDistance = this.config.proximityThreshold + 1;
        for (const pos1 of term1.positions) {
          for (const pos2 of term2.positions) {
            const distance = Math.abs(pos1 - pos2);
            minDistance = Math.min(minDistance, distance);
          }
        }

        // If within threshold, connect the terms
        if (minDistance <= this.config.proximityThreshold) {
          adjacencyMatrix.get(term1.term)?.add(term2.term);
          adjacencyMatrix.get(term2.term)?.add(term1.term);
          minDistances.push(minDistance);
        }
      }
    }

    // Check if all terms are connected (reachable from each other)
    if (matchedTerms.length > 1) {
      const visited = new Set<string>();
      const queue = [matchedTerms[0]];
      visited.add(matchedTerms[0]);

      // BFS to check connectivity
      while (queue.length > 0) {
        const current = queue.shift();
        if (!current) {
          continue;
        }
        const neighbors = adjacencyMatrix.get(current) || new Set();

        for (const neighbor of neighbors) {
          if (!visited.has(neighbor)) {
            visited.add(neighbor);
            queue.push(neighbor);
          }
        }
      }

      // If not all terms are reachable, return 0
      if (visited.size !== matchedTerms.length) {
        return 0;
      }
    }

    if (minDistances.length === 0) {
      return 0;
    }

    // Average the minimum distances and invert so closer = higher bonus
    const avgMinDistance = minDistances.reduce((sum, dist) => sum + dist, 0) / minDistances.length;
    const proximityScore = Math.max(0, 1 - avgMinDistance / this.config.proximityThreshold);

    return proximityScore;
  }

  /**
   * Calculate scores for documents based on pre-tokenized terms
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

    // Group results by term and calculate IDF for each term
    const termResults = terms.map(term => {
      const results = allTermResults.filter(r => r.term === term);
      const docsWithTerm = new Set(results.map(r => r.documentId)).size;
      const idf = this.calculateIDF(docCount, docsWithTerm);
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
