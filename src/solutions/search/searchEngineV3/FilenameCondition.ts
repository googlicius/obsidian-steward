import { Condition, ConditionResult } from './Condition';
import { ParsedRegexPattern } from '../types';
import { similarity } from 'src/utils/similarity';
import { IndexedDocument } from 'src/database/SearchDatabase';

const SIMILARITY_THRESHOLD = 0.7;
const BOOST = 5;

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

      // Filter documents by similarity score
      for (const doc of documents) {
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
            score: score * BOOST,
          });
        }
      }
    }

    return result;
  }
}
