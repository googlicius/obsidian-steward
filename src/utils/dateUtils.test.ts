import { formatRelativeTime, parseFrontmatterDate } from './dateUtils';

describe('dateUtils', () => {
  describe('parseFrontmatterDate', () => {
    it('should parse ISO date strings', () => {
      const date = parseFrontmatterDate('2026-06-06T23:01:01.475Z');

      expect(date).toBeInstanceOf(Date);
      expect(date?.toISOString()).toBe('2026-06-06T23:01:01.475Z');
    });

    it('should parse numeric timestamps', () => {
      const timestamp = Date.parse('2026-06-06T23:01:01.475Z');
      const date = parseFrontmatterDate(timestamp);

      expect(date?.getTime()).toBe(timestamp);
    });

    it('should return null for invalid values', () => {
      expect(parseFrontmatterDate(null)).toBeNull();
      expect(parseFrontmatterDate('')).toBeNull();
      expect(parseFrontmatterDate('not-a-date')).toBeNull();
    });
  });

  describe('formatRelativeTime', () => {
    beforeEach(() => {
      jest.useFakeTimers();
      jest.setSystemTime(new Date('2026-06-07T12:00:00.000Z'));
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('should format past dates as relative time', () => {
      const date = new Date('2026-06-06T23:01:01.475Z');
      const result = formatRelativeTime(date, 'en');

      expect(result).toMatch(/13 hours ago|12 hours ago/);
    });

    it('should format recent dates in minutes', () => {
      const date = new Date('2026-06-07T11:55:00.000Z');
      const result = formatRelativeTime(date, 'en');

      expect(result).toBe('5 minutes ago');
    });
  });
});
