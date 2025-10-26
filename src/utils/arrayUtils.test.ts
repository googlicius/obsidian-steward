import { removeConsecutiveItems, hashTerms } from './arrayUtils';

describe('arrayUtils', () => {
  describe('removeConsecutiveItems', () => {
    it('should remove consecutive items', () => {
      const array = ['a', 'a', 'b', 'b', 'c', 'c', 'd'];
      const result = removeConsecutiveItems(array);
      expect(result).toEqual(['a', 'b', 'c', 'd']);
    });

    it('should remove multiple same items in a row', () => {
      const array = ['a', 'a', 'b', 'b', 'b', 'c', 'c', 'c', 'c', 'c', 'c', 'd'];
      const result = removeConsecutiveItems(array);
      expect(result).toEqual(['a', 'b', 'c', 'd']);
    });

    it('should keep the original array if there are no consecutive items', () => {
      const array = ['a', 'b', 'c', 'd'];
      const result = removeConsecutiveItems(array);
      expect(result).toEqual(['a', 'b', 'c', 'd']);
    });
  });
});

describe('hashTerms', () => {
  it('should return consistent hash for empty array', () => {
    const hash1 = hashTerms([]);
    const hash2 = hashTerms([]);
    expect(hash1).toBe(hash2);
    expect(hash1).toBe('45h');
  });

  it('should return consistent hash for single term', () => {
    const hash1 = hashTerms(['apple']);
    expect(hash1).toBe('1r7wcc5');
  });

  it('should return a hash for 3 terms', () => {
    const terms = ['apple', 'banana', 'orange'];
    const hash1 = hashTerms(terms);
    expect(hash1).toBe('1egcafc');
  });

  it('should return a hash for a long list of terms', () => {
    const terms: string[] = [];
    for (let i = 0; i < 1000; i++) {
      terms.push(`term${i}`);
    }
    const hash1 = hashTerms(terms);

    expect(hash1).toEqual('rl0513');
  });
});
