/**
 * Compares two semantic version strings (e.g. plugin or release tags).
 * @returns 1 if v1 > v2, -1 if v1 < v2, 0 if equal
 */
export function compareSemverVersions(v1: string, v2: string): number {
  const cleanV1 = v1.replace(/^v/i, '');
  const cleanV2 = v2.replace(/^v/i, '');

  const parts1 = cleanV1.split('.').map(Number);
  const parts2 = cleanV2.split('.').map(Number);

  for (let i = 0; i < Math.max(parts1.length, parts2.length); i++) {
    const part1 = parts1[i] || 0;
    const part2 = parts2[i] || 0;

    if (part1 > part2) return 1;
    if (part1 < part2) return -1;
  }

  return 0;
}
