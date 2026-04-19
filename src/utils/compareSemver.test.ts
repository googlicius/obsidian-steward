import { compareSemverVersions } from './compareSemver';

describe('compareSemverVersions', () => {
  it('compares numeric segments', () => {
    expect(compareSemverVersions('2.7.0', '2.6.0')).toBe(1);
    expect(compareSemverVersions('2.6.0', '2.7.0')).toBe(-1);
    expect(compareSemverVersions('2.6.0', '2.6.0')).toBe(0);
  });

  it('strips v prefix', () => {
    expect(compareSemverVersions('v2.7.0', '2.6.0')).toBe(1);
  });

  it('treats missing segments as zero', () => {
    expect(compareSemverVersions('3', '2.9.9')).toBe(1);
  });
});
