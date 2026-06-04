import {
  DEFAULT_MAX_ASSET_BYTES,
  formatWidgetAssetBytes,
  parseWidgetAssetSize,
  resolveMaxAssetBytes,
} from './WidgetAssetSize';
import type { WidgetManifest } from './types';

describe('parseWidgetAssetSize', () => {
  it('parses plain byte counts', () => {
    expect(parseWidgetAssetSize(50000)).toBe(50000);
    expect(parseWidgetAssetSize('50000')).toBe(50000);
  });

  it('parses suffixed sizes with optional spacing and casing', () => {
    expect(parseWidgetAssetSize('5MB')).toBe(5 * 1024 * 1024);
    expect(parseWidgetAssetSize('5mb')).toBe(5 * 1024 * 1024);
    expect(parseWidgetAssetSize('5 mb')).toBe(5 * 1024 * 1024);
    expect(parseWidgetAssetSize('5 MB')).toBe(5 * 1024 * 1024);
    expect(parseWidgetAssetSize('1 GB')).toBe(1024 * 1024 * 1024);
    expect(parseWidgetAssetSize('512KB')).toBe(512 * 1024);
  });

  it('returns null for invalid values', () => {
    expect(parseWidgetAssetSize('')).toBeNull();
    expect(parseWidgetAssetSize('five MB')).toBeNull();
    expect(parseWidgetAssetSize('5 TB')).toBeNull();
    expect(parseWidgetAssetSize(-1)).toBeNull();
  });
});

describe('resolveMaxAssetBytes', () => {
  it('uses default when manifest omits maxAssetSize', () => {
    expect(resolveMaxAssetBytes(null)).toBe(DEFAULT_MAX_ASSET_BYTES);
  });

  it('reads maxAssetSize from manifest', () => {
    const manifest = {
      name: 'manifest' as const,
      entry: 'index.html',
      type: 'html' as const,
      maxAssetSize: '6MB',
    };
    expect(resolveMaxAssetBytes(manifest)).toBe(6 * 1024 * 1024);
  });

  it('falls back to default for invalid manifest values', () => {
    const manifest = {
      name: 'manifest' as const,
      entry: 'index.html',
      type: 'html' as const,
      maxAssetSize: 'not-a-size',
    } as WidgetManifest;
    expect(resolveMaxAssetBytes(manifest)).toBe(DEFAULT_MAX_ASSET_BYTES);
  });
});

describe('formatWidgetAssetBytes', () => {
  it('formats human-readable sizes', () => {
    expect(formatWidgetAssetBytes(500)).toBe('500 B');
    expect(formatWidgetAssetBytes(2048)).toBe('2.0 KB');
    expect(formatWidgetAssetBytes(5 * 1024 * 1024)).toBe('5.0 MB');
  });
});
