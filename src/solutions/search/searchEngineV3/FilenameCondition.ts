import { Condition, ConditionResult } from './Condition';
import { ParsedRegexPattern } from '../types';
import { similarity } from 'src/utils/similarity';
import { IndexedDocument, IndexedTerm, TermSource } from 'src/database/SearchDatabase';

const SIMILARITY_THRESHOLD = 0.7;
const BOOST = 8;

export class FilenameCondition extends Condition<IndexedDocument> {
  constructor(private names: string[]) {
    super();
    // Ensure names are without extensions. Include both versions ensuring we don't accidentally remove the part that is not an extension.
    for (let i = names.length - 1; i >= 0; i--) {
      const name = names[i];
      const lastDotIndex = name.lastIndexOf('.');

      if (lastDotIndex > 0 && lastDotIndex < name.length - 1) {
        names.push(name.substring(0, lastDotIndex));
      }
    }
  }

  /**
   * Parse a regex pattern string and determine the search type and original name
   * Handles patterns like ^name$ (exact), ^name (startsWith), or name (contains)
   */
  private parseRegexPattern(pattern: string): ParsedRegexPattern {
    // Check if pattern is for exact match: ^name$
    if (pattern.startsWith('^') && pattern.endsWith('$')) {
      return {
        originalName: pattern.slice(1, -1),
        searchType: 'exact',
      };
    }

    // Check if pattern is for starts with: ^name
    if (pattern.startsWith('^')) {
      return {
        originalName: pattern.slice(1),
        searchType: 'startsWith',
      };
    }

    // Default case is contains: name
    return {
      originalName: pattern,
      searchType: 'contains',
    };
  }

  /**
   * Build term position maps and matched term sets per document from filename-source entries.
   */
  private buildDocumentTermMaps(termEntries: IndexedTerm[]) {
    const termPositions = new Map<number, Map<string, number[]>>();
    const matchedTerms = new Map<number, Set<string>>();

    for (const entry of termEntries) {
      if (entry.source !== TermSource.Filename) continue;

      const { documentId, term, positions } = entry;

      if (!termPositions.has(documentId)) {
        termPositions.set(documentId, new Map());
        matchedTerms.set(documentId, new Set());
      }

      const termMap = termPositions.get(documentId);
      if (termMap) {
        const existing = termMap.get(term) || [];
        termMap.set(term, [...existing, ...positions]);
      }
      matchedTerms.get(documentId)?.add(term);
    }

    return { termPositions, matchedTerms };
  }

  async evaluate() {
    const result = new Map<number, ConditionResult<IndexedDocument>>();

    for (const name of this.names) {
      const terms = this.context.nameTokenizer.getUniqueTerms(name);
      if (terms.length === 0) continue;

      const termEntries = await this.context.documentStore.getTermsByValue(terms);

      const documentIds = [...new Set(termEntries.map(entry => entry.documentId))];

      if (documentIds.length === 0) continue;

      const documents = await this.context.documentStore.getDocumentsByIds(documentIds);
      const parsedName = this.parseRegexPattern(name);

      // Build term position maps for coverage and proximity bonus calculation
      const { termPositions: docTermPositions, matchedTerms: docMatchedTerms } =
        this.buildDocumentTermMaps(termEntries);

      // Filter documents by similarity score and apply bonuses
      for (const doc of documents) {
        let score = 0;

        switch (parsedName.searchType) {
          case 'contains':
            if (doc.fileName.toLowerCase().includes(parsedName.originalName.toLowerCase())) {
              score = 1 + similarity(parsedName.originalName, doc.fileName);
            }
            break;

          case 'exact':
            score = similarity(parsedName.originalName, doc.fileName);
            break;

          case 'startsWith':
            if (doc.fileName.toLowerCase().startsWith(parsedName.originalName.toLowerCase())) {
              score = 1.0;
            }
            break;

          default:
            break;
        }

        if (score < SIMILARITY_THRESHOLD) continue;

        const docId = doc.id as number;
        const baseScore = score * BOOST;

        // Apply coverage and proximity bonuses from filename terms
        const totalBonus = this.context.scoring.calculateTotalBonus({
          termPositions: docTermPositions.get(docId) || new Map(),
          queryTerms: terms,
          matchedTermCount: docMatchedTerms.get(docId)?.size ?? 0,
          totalTermCount: terms.length,
        });

        result.set(docId, {
          document: doc,
          score: baseScore * (1 + totalBonus),
        });
      }
    }

    return result;
  }
}
