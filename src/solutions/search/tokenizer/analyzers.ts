import { stemmer } from './stemmer';

export interface Token {
  term: string;
  count: number;
  positions: number[];
  isOriginal?: boolean; // Whether this term is an original form (not stemmed)
}

/**
 * Interface for text analyzers that process tokens after tokenization.
 * Analyzers perform tasks like word splitting, stemming, or phrase extraction
 * to enhance the quality of search results and analysis.
 */
export interface Analyzer {
  name: string;
  process: (tokens: Token[]) => Token[];
}

export const ALL_ANALYZERS: Record<string, Analyzer['process']> = {
  /**
   * Word delimiter analyzer that splits words by dashes and underscores, adding the parts as separate tokens
   * while preserving the original token. Also strips leading and trailing apostrophes and underscores from tokens.
   */
  wordDelimiter: (tokens: Token[]) => {
    const tokenMap = new Map<string, Token>();

    // Add all original tokens to the map
    for (const token of tokens) {
      const existingToken = tokenMap.get(token.term);
      if (existingToken) {
        existingToken.count += token.count;
        existingToken.positions.push(...token.positions);
      } else {
        tokenMap.set(token.term, { ...token });
      }
    }

    // Process each original token for splitting and stripping
    for (const token of tokens) {
      // Check if token contains dashes, underscores, or leading/trailing apostrophes
      // Split pattern includes apostrophes to handle 'Messi' → Messi while preserving don't
      const hasDelimiters = /[-_]/.test(token.term);
      const hasBoundaryApostrophes = /^[''\u2019]|[''\u2019]$/.test(token.term);

      if (hasDelimiters || hasBoundaryApostrophes) {
        // Split by dashes, underscores, and boundary apostrophes
        // Using split with a pattern that matches delimiters and boundary apostrophes
        const parts = token.term
          .replace(/^[''\u2019]+|[''\u2019]+$/g, '') // Strip boundary apostrophes first
          .split(/[-_]/)
          .filter(Boolean);

        // Add each part as a new token if it's not already in the result
        for (const part of parts) {
          // Check if this part already exists using O(1) Map lookup
          const existingToken = tokenMap.get(part);

          if (existingToken) {
            // If it exists, merge the positions
            existingToken.count += 1;
            existingToken.positions.push(...token.positions);
          } else {
            // Otherwise, add a new token
            tokenMap.set(part, {
              term: part,
              count: 1,
              positions: [...token.positions],
            });
          }
        }
      }
    }

    return Array.from(tokenMap.values());
  },

  /**
   * Stemmer analyzer that reduces words to their root form using the Porter stemming algorithm
   * This helps match different forms of the same word (e.g., "running" -> "run", "better" -> "better")
   * Now preserves both original and stemmed tokens for exact match support
   */
  stemmer: (tokens: Token[]) => {
    const tokenMap = new Map<string, Token>();

    for (const token of tokens) {
      // Always preserve the original token with isOriginal flag
      const existingOriginal = tokenMap.get(token.term);
      if (existingOriginal) {
        existingOriginal.count += token.count;
        existingOriginal.positions.push(...token.positions);
      } else {
        tokenMap.set(token.term, {
          ...token,
          isOriginal: true, // Mark as original
        });
      }

      // Add stemmed version if different from original
      const stemmedTerm = stemmer(token.term);
      if (stemmedTerm !== token.term) {
        const existingStemmed = tokenMap.get(stemmedTerm);
        if (existingStemmed) {
          // Merge with existing stemmed token
          existingStemmed.count += token.count;
          existingStemmed.positions.push(...token.positions);
        } else {
          // Add new stemmed token to map
          tokenMap.set(stemmedTerm, {
            term: stemmedTerm,
            count: token.count,
            positions: [...token.positions],
            isOriginal: false, // Mark as stemmed
          });
        }
      }
    }

    // Convert map values to array
    return Array.from(tokenMap.values());
  },
};
