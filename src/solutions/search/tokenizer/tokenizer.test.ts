import { Tokenizer } from './tokenizer';

describe('Tokenizer', () => {
  describe('wordDelimiter analyzer', () => {
    it('should split words by dashes and underscores while preserving original tokens', () => {
      const tokenizer = new Tokenizer({
        analyzers: ['wordDelimiter'],
      });

      const tokens = tokenizer.tokenize('user-defined_command definition');

      expect(tokens).toMatchSnapshot();
    });
  });

  describe('stemmer analyzer', () => {
    it('should reduce words to their root form using Porter stemming algorithm', () => {
      const tokenizer = new Tokenizer({
        removeStopwords: false,
        analyzers: ['stemmer'],
      });

      const tokens = tokenizer.tokenize('running quickly better fastest running');

      expect(tokens).toMatchSnapshot();
    });

    it('should merge tokens that stem to the same root form', () => {
      const tokenizer = new Tokenizer({
        removeStopwords: false,
        analyzers: ['stemmer'],
      });

      const tokens = tokenizer.tokenize('running runs run');

      expect(tokens).toMatchSnapshot();
    });
  });

  describe('tokenize', () => {
    it('should return terms with correct positions', () => {
      const tokenizer = new Tokenizer();

      expect(tokenizer.tokenize('My cat is on the table')).toMatchSnapshot();
    });
  });

  describe('stopword threshold', () => {
    it('should remove all stopwords when percentage is below threshold', () => {
      const tokenizer = new Tokenizer({
        normalizers: ['lowercase'],
        stopwordThreshold: 0.5,
      });

      const tokens = tokenizer.tokenize('My cat is on the table');
      const terms = tokens.map(t => t.term);

      // "My cat is on the table" -> "my", "cat", "is", "on", "the", "table"
      // Stopwords: "is", "on", "the" = 3/6 = 50% (at threshold, so all removed)
      // Expected: "my", "cat", "table"
      expect(terms).not.toContain('is');
      expect(terms).not.toContain('on');
      expect(terms).not.toContain('the');
      expect(terms).toContain('my');
      expect(terms).toContain('cat');
      expect(terms).toContain('table');
    });

    it('should partially remove stopwords when percentage exceeds threshold', () => {
      const tokenizer = new Tokenizer({
        normalizers: ['lowercase'],
        stopwordThreshold: 0.5,
      });

      // "The lord of the Rings" -> "the", "lord", "of", "the", "rings"
      // Stopwords: "the", "of", "the" = 3/5 = 60% (exceeds 50% threshold)
      // Should remove enough to get below 50%
      // After removing 1 stopword: 2 stopwords / 4 words = 50% (at threshold)
      const tokens = tokenizer.tokenize('The lord of the Rings');
      const terms = tokens.map(t => t.term);

      // Should contain "lord" and "rings" (non-stopwords)
      expect(terms).toContain('lord');
      expect(terms).toContain('rings');

      // Should have some stopwords remaining (at least one "the" or "of")
      const stopwordsInResult = terms.filter(term => term === 'the' || term === 'of');
      expect(stopwordsInResult.length).toBeGreaterThan(0);
      expect(stopwordsInResult.length).toBeLessThan(3); // Not all stopwords should remain
    });

    it('should handle queries with mostly stopwords', () => {
      const tokenizer = new Tokenizer({
        normalizers: ['lowercase'],
        stopwordThreshold: 0.5,
      });

      // "The the the the" -> 4 stopwords / 4 words = 100%
      // Should remove enough to get below 50%
      // After removing 2 stopwords: 2 stopwords / 2 words = 100% (still above)
      // After removing 3 stopwords: 1 stopword / 1 word = 100% (still above)
      // Actually, we need to remove at least 2 to get: 2 stopwords / 2 words = 100%
      // Wait, that's still 100%. Let me recalculate...
      // We want: remainingStopwords / remainingWords <= 0.5
      // If we remove 2: 2 stopwords / 2 words = 100% (not good)
      // If we remove 3: 1 stopword / 1 word = 100% (not good)
      // Actually, we can't get below 50% if all words are stopwords!
      // So the function should remove all but keep at least some to preserve query structure
      const tokens = tokenizer.tokenize('The the the the');
      const terms = tokens.map(t => t.term);

      // Should have some stopwords remaining (at least one)
      const stopwordsInResult = terms.filter(term => term === 'the');
      expect(stopwordsInResult.length).toBeGreaterThan(0);
    });

    it('should remove all stopwords when threshold is 0', () => {
      const tokenizer = new Tokenizer({
        normalizers: ['lowercase'],
        stopwordThreshold: 0,
      });

      const tokens = tokenizer.tokenize('The lord of the Rings');
      const terms = tokens.map(t => t.term);

      // With threshold 0, should remove all stopwords
      expect(terms).not.toContain('the');
      expect(terms).not.toContain('of');
      expect(terms).toContain('lord');
      expect(terms).toContain('rings');
    });

    it('should keep all words when removeStopwords is false', () => {
      const tokenizer = new Tokenizer({
        normalizers: ['lowercase'],
        removeStopwords: false,
        stopwordThreshold: 0.5,
      });

      const tokens = tokenizer.tokenize('The lord of the Rings');
      const terms = tokens.map(t => t.term);

      // Should contain all words including stopwords
      expect(terms).toContain('the');
      expect(terms).toContain('lord');
      expect(terms).toContain('of');
      expect(terms).toContain('rings');
    });
  });
});
