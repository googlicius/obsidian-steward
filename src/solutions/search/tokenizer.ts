import { removeStopwords } from '../../stopwords';

export interface Token {
  term: string;
  count: number;
  positions: number[];
}

export interface Normalizer {
  name: string;
  apply: (content: string) => string;
}

export interface TokenizerConfig {
  removeStopwords?: boolean;
  normalizers?: Normalizer[];
}

export class Tokenizer {
  private config: TokenizerConfig;
  private normalizers: Normalizer[];

  constructor(config: TokenizerConfig = {}) {
    this.config = config;
    this.normalizers = config.normalizers || this.getDefaultNormalizers();
  }

  /**
   * Get predefined normalizers
   */
  private getDefaultNormalizers(): Normalizer[] {
    return [
      {
        name: 'removeHtmlComments',
        apply: (content: string) => content.replace(/<!--[\s\S]*?-->/g, ' '),
      },
      {
        name: 'lowercase',
        apply: (content: string) => content.toLowerCase(),
      },
      {
        name: 'removeSpecialChars',
        apply: (content: string) =>
          content
            .replace(/[^\p{L}\p{N}'\u2019\s#_-]/gu, ' ') // Keep letters, numbers, apostrophes, hashtags, underscores, hyphens
            .replace(/[#_-]{2,}/g, ' '), // Filter out 2+ consecutive special characters
      },
    ];
  }

  /**
   * Add custom normalizers
   */
  public addNormalizers(...normalizers: Normalizer[]): void {
    this.normalizers.push(...normalizers);
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
   * Clear all normalizers and reset to defaults
   */
  public resetToDefaults(): void {
    this.normalizers = this.getDefaultNormalizers();
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
    return Array.from(termMap.entries()).map(([term, data]) => ({
      term,
      count: data.count,
      positions: data.positions,
    }));
  }

  /**
   * Get unique terms from content
   */
  public getUniqueTerms(content: string): string[] {
    return this.tokenize(content).map(t => t.term);
  }
}
