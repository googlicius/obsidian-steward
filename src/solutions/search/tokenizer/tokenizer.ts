import { removeStopwords, STOPWORDS } from './stopwords';
import { ALL_ANALYZERS, Analyzer, Token } from './analyzers';
import { ALL_NORMALIZERS, Normalizer } from './normalizers';

interface TokenizerConfig {
  removeStopwords?: boolean;
  /**
   * Threshold for stopword removal (0.0 to 1.0). Stopwords are kept only if their percentage exceeds this value.
   * Higher threshold = stricter removal (harder to keep stopwords, need higher percentage). Default: 0.5
   * Example: threshold 0.7 means "For a while.md" (66% stopwords) removes stopwords; threshold 0.5 keeps them.
   */
  stopwordThreshold?: number;
  normalizers?: (string | Normalizer)[];
  analyzers?: (string | Analyzer)[];
}

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

    // Remove stopwords if configured, but check threshold first
    let filteredWords = words;
    if (this.config.removeStopwords && words.length > 0) {
      // Calculate stopword percentage
      const stopwordCount = words.filter(word => STOPWORDS.has(word)).length;
      const stopwordPercentage = stopwordCount / words.length;

      // If stopword percentage exceeds threshold, skip stopword removal
      const threshold = this.config.stopwordThreshold ?? 0.5;
      if (stopwordPercentage > threshold) {
        filteredWords = words;
      } else {
        filteredWords = removeStopwords(words);
      }
    }

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
