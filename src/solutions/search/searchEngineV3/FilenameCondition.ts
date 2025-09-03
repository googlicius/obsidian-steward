import { Condition, ConditionResult } from './Condition';
import { ParsedRegexPattern } from '../types';
import { similarity } from 'src/utils/similarity';

const SIMILARITY_THRESHOLD = 0.7;

/**
 * Condition for filtering by filename.
 */
export class FilenameCondition extends Condition {
  constructor(private names: string[]) {
    super();
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

  async evaluate() {
    const result = new Map<number, ConditionResult>();

    for (const name of this.names) {
      const terms = this.context.nameTokenizer.getUniqueTerms(name);
      if (terms.length === 0) continue;

      // Get document IDs from term entries
      const termEntries = await this.context.documentStore.getTermsByValue(terms);

      // Extract unique document IDs from term entries
      const documentIds = [...new Set(termEntries.map(entry => entry.documentId))];

      // If no matching documents found, continue to next name
      if (documentIds.length === 0) continue;

      // Fetch the documents for these IDs
      const documents = await this.context.documentStore.getDocumentsByIds(documentIds);

      // Filter documents by similarity score
      for (const doc of documents) {
        const parsedName = this.parseRegexPattern(name);
        let score = 0;

        switch (parsedName.searchType) {
          case 'contains':
            if (doc.fileName.toLowerCase().includes(parsedName.originalName.toLowerCase())) {
              score = 1.0;
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

        // If similarity is above threshold, add to matched documents with score
        if (score >= SIMILARITY_THRESHOLD) {
          result.set(doc.id as number, {
            document: doc,
            score: score,
          });
        }
      }
    }

    return result;
  }
}
