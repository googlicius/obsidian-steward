import { isHiddenPath } from './pathUtils';

describe('pathUtils', () => {
  describe('isHiddenPath', () => {
    it('should return true if the name starts with dot', () => {
      expect(isHiddenPath('.config')).toBe(true);
      expect(isHiddenPath('.config.yaml')).toBe(true);
    });

    it('should return true if the folder starts with dot', () => {
      expect(isHiddenPath('.config/config.yaml')).toBe(true);
      expect(isHiddenPath('my-folder/.hidden/config.yaml')).toBe(true);
    });

    it('should return false if the name not start with dot', () => {
      expect(isHiddenPath('config.yaml')).toBe(false);
    });
  });
});
