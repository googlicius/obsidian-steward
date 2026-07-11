import { shouldOpenArchiveInNewTab } from './CollapsibleBlockPostProcessor';

describe('shouldOpenArchiveInNewTab', () => {
  it('returns true when line count exceeds inline threshold', () => {
    expect(shouldOpenArchiveInNewTab('2000')).toBe(true);
  });

  it('returns false when line count is at or below threshold', () => {
    expect(shouldOpenArchiveInNewTab('1500')).toBe(false);
    expect(shouldOpenArchiveInNewTab('500')).toBe(false);
  });

  it('returns false when lines metadata is absent or invalid', () => {
    expect(shouldOpenArchiveInNewTab(undefined)).toBe(false);
    expect(shouldOpenArchiveInNewTab('abc')).toBe(false);
  });
});
