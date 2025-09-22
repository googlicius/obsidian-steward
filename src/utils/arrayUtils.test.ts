import { removeConsecutiveItems } from './arrayUtils';

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
