import { removeStopwords } from './stopwords';
import { stemmer } from './stemmer';
import { STW_SELECTED_PATTERN, STW_SQUEEZED_PATTERN } from '../../../constants';

interface Token {
  term: string;
  count: number;
  positions: number[];
  isOriginal?: boolean; // Whether this term is an original form (not stemmed)
}

/**
 * Interface for text normalizers that transform content before tokenization.
 * Normalizers handle tasks like case folding, accent removal, or special character handling
 * to standardize text for more effective search and analysis.
 */
interface Normalizer {
  name: string;
  apply: (content: string) => string;
}

/**
 * Interface for text analyzers that process tokens after tokenization.
 * Analyzers perform tasks like word splitting, stemming, or phrase extraction
 * to enhance the quality of search results and analysis.
 */
interface Analyzer {
  name: string;
  process: (tokens: Token[]) => Token[];
}

interface TokenizerConfig {
  removeStopwords?: boolean;
  /**
   * Threshold for stopword removal (0.0 to 1.0).
   * If the percentage of stopwords exceeds this threshold, only remove stopwords until the percentage is below the threshold.
   * Default: 0.5 (50%)
   * Example: With threshold 0.5, "The lord of the Rings" (60% stopwords) will have some stopwords removed to bring it below 50%
   */
  stopwordThreshold?: number;
  normalizers?: (string | Normalizer)[];
  analyzers?: (string | Analyzer)[];
}

const ALL_ANALYZERS: Record<string, Analyzer['process']> = {
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

const ALL_NORMALIZERS: Record<string, Normalizer['apply']> = {
  removeHtmlComments: (content: string) => content.replace(/<!--[\s\S]*?-->/g, ' '),
  lowercase: (content: string) => content.toLowerCase(),
  removeSpecialChars: (content: string) =>
    content
      .replace(/[^\p{L}\p{N}'\u2019\s#_-]/gu, ' ') // Keep letters, numbers, apostrophes, hashtags, underscores, hyphens
      .replace(/[#_-]{2,}/g, ' '), // Filter out 2+ consecutive special characters
  removeDiacritics: (content: string) =>
    content
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '') // Remove combining diacritical marks
      .normalize('NFC'),
  removeStwSelectedPatterns: (content: string) =>
    content.replace(new RegExp(STW_SELECTED_PATTERN, 'g'), ' '),
  removeStwSqueezedPatterns: (content: string) =>
    content.replace(new RegExp(STW_SQUEEZED_PATTERN, 'g'), ' '),
  removeTagPrefix: (content: string) => content.replace(/#([^#\s]+)/g, '$1'),
};

export class Tokenizer {
  private config: TokenizerConfig;
  private normalizers: Normalizer[] = [];
  private analyzers: Analyzer[] = [];

  constructor(config: TokenizerConfig = {}) {
    this.config = {
      removeStopwords: true,
      stopwordThreshold: 0.5,
      ...config,
    };

    if (config.normalizers) {
      this.addNormalizers(...config.normalizers);
    }

    if (config.analyzers) {
      this.addAnalyzers(...config.analyzers);
    }
  }

  public withConfig(config: TokenizerConfig): Tokenizer {
    return new Tokenizer({
      ...this.config,
      ...config,
    });
  }

  /**
   * Add custom normalizers
   * @param normalizers Array of custom normalizers or names of predefined normalizers
   */
  public addNormalizers(...normalizers: (string | Normalizer)[]): void {
    const normalizersToAdd: Normalizer[] = normalizers.map(normalizer => {
      if (typeof normalizer === 'string') {
        if (normalizer in ALL_NORMALIZERS) {
          return {
            name: normalizer,
            apply: ALL_NORMALIZERS[normalizer],
          };
        }
        throw new Error(`Normalizer "${normalizer}" not found in ALL_NORMALIZERS`);
      }
      return normalizer;
    });

    this.normalizers.push(...normalizersToAdd);
  }

  /**
   * Remove a normalizer by name
   */
  public removeNormalizer(name: string): void {
    this.normalizers = this.normalizers.filter(n => n.name !== name);
  }

  /**
   * Get all current normalizers
   */
  public getNormalizers(): Normalizer[] {
    return [...this.normalizers];
  }

  /**
   * Add analyzers
   * @param analyzers Array of analyzer names or analyzer objects
   */
  public addAnalyzers(...analyzers: (string | Analyzer)[]): void {
    const analyzersToAdd: Analyzer[] = analyzers.map(analyzer => {
      if (typeof analyzer === 'string') {
        if (analyzer in ALL_ANALYZERS) {
          return {
            name: analyzer,
            process: ALL_ANALYZERS[analyzer],
          };
        }
        throw new Error(`Analyzer "${analyzer}" not found in ALL_ANALYZERS`);
      }
      return analyzer;
    });

    this.analyzers.push(...analyzersToAdd);
  }

  /**
   * Remove an analyzer by name
   */
  public removeAnalyzer(name: string): void {
    this.analyzers = this.analyzers.filter(a => a.name !== name);
  }

  /**
   * Get all current analyzers
   */
  public getAnalyzers(): Analyzer[] {
    return [...this.analyzers];
  }

  /**
   * Clear all normalizers and analyzers and reset to defaults
   */
  public resetToDefaults(): void {
    this.normalizers = Object.entries(ALL_NORMALIZERS).map(([name, apply]) => ({
      name,
      apply,
    }));

    // Reset analyzers as well
    this.analyzers = [];
  }

  /**
   * Apply all normalizers to content
   */
  private applyNormalizers(content: string): string {
    let normalizedContent = content;

    for (const normalizer of this.normalizers) {
      normalizedContent = normalizer.apply(normalizedContent);
    }

    return normalizedContent;
  }

  /**
   * Tokenize content into terms with positions
   */
  public tokenize(content: string): Token[] {
    // Apply all configured normalizers
    const normalizedContent = this.applyNormalizers(content);

    // Split into words and filter empty ones
    const words = normalizedContent.split(/\s+/).filter(Boolean);

    // Remove stopwords if configured
    const filteredWords = this.config.removeStopwords ? removeStopwords(words) : words;

    // Count term frequencies and positions
    const termMap = new Map<string, { count: number; positions: number[] }>();

    for (let i = 0; i < filteredWords.length; i++) {
      const word = filteredWords[i];

      if (!termMap.has(word)) {
        termMap.set(word, { count: 0, positions: [] });
      }

      const termData = termMap.get(word);
      if (!termData) continue;

      termData.count++;
      termData.positions.push(i);
    }

    // Convert map to array
    let tokens = Array.from(termMap.entries()).map(([term, data]) => ({
      term,
      count: data.count,
      positions: data.positions,
    }));

    // Apply analyzers if configured
    if (this.analyzers.length > 0) {
      for (const analyzer of this.analyzers) {
        tokens = analyzer.process(tokens);
      }
    }

    return tokens;
  }

  /**
   * Get unique terms from content
   */
  public getUniqueTerms(content: string): string[] {
    return this.tokenize(content).map(t => t.term);
  }
}
