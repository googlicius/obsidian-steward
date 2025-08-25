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
});
