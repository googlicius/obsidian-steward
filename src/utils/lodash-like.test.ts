import { get } from './lodash-like';

describe('lodash-like', () => {
  describe('get', () => {
    it('should return the value at the given path', () => {
      const obj = { a: { b: { c: 1 } } };
      expect(get(obj, 'a.b.c')).toBe(1);
    });

    it('should return undefined if the path is not found', () => {
      const obj = { a: { b: { c: 1 } } };
      expect(get(obj, 'a.b.d')).toBeUndefined();
    });
  });
});
