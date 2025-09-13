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
});
