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

    it('should remove leading and trailing underscores and apostrophes from phrases', () => {
      const tokenizer = new Tokenizer({
        analyzers: ['wordDelimiter'],
      });

      const tokens = tokenizer.tokenize('His name is _Lionel Messi_');

      expect(tokens).toMatchObject([
        {
          term: 'His',
        },
        {
          term: 'name',
        },
        {
          term: '_Lionel',
        },
        {
          term: 'Messi_',
        },
        {
          term: 'Lionel',
        },
        {
          term: 'Messi',
        },
      ]);
    });

    it('should remove leading and trailing apostrophes from single-quoted strings', () => {
      const tokenizer = new Tokenizer({
        analyzers: ['wordDelimiter'],
      });

      const tokens = tokenizer.tokenize("const name = 'Lionel Messi'");

      expect(tokens).toMatchObject([
        {
          term: 'const',
        },
        {
          term: 'name',
        },
        {
          term: '=',
        },
        {
          term: "'Lionel",
        },
        {
          term: "Messi'",
        },
        {
          term: 'Lionel',
        },
        {
          term: 'Messi',
        },
      ]);
    });

    it('should preserve apostrophes in the middle of words (contractions)', () => {
      const tokenizer = new Tokenizer({
        analyzers: ['wordDelimiter'],
      });

      const tokens = tokenizer.tokenize("don't won't it's");

      expect(tokens).toMatchObject([
        {
          term: "don't",
        },
        {
          term: "won't",
        },
        {
          term: "it's",
        },
      ]);
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

    it('should keep stopwords if removeStopwords is false', () => {
      const tokenizer = new Tokenizer({
        removeStopwords: false,
      });

      const tokens = tokenizer.tokenize('My cat is on the table');

      expect(tokens).toMatchObject([
        {
          term: 'My',
        },
        {
          term: 'cat',
        },
        {
          term: 'is',
        },
        {
          term: 'on',
        },
        {
          term: 'the',
        },
        {
          term: 'table',
        },
      ]);
    });

    it('should keep stopwords if the stopwords percentage exceeds the stopwordThreshold', () => {
      const tokenizer = new Tokenizer({
        removeStopwords: true,
        stopwordThreshold: 0.3,
      });

      const tokens = tokenizer.tokenize('For a while');

      expect(tokens).toMatchObject([
        {
          term: 'For',
        },
        {
          term: 'a',
        },
        {
          term: 'while',
        },
      ]);
    });
  });
});
