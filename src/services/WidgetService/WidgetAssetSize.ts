import { logger } from 'src/utils/logger';
import type { WidgetManifest } from './types';

/** Default per-asset cap when manifest omits `maxAssetSize`. */
export const DEFAULT_MAX_ASSET_BYTES = 5 * 1024 * 1024;

/** Default `maxAssetSize` written into Widget.md manifest on project create. */
export const DEFAULT_MAX_ASSET_SIZE_MANIFEST = '5MB';

const SIZE_UNIT_MULTIPLIERS: Record<string, number> = {
  b: 1,
  byte: 1,
  bytes: 1,
  kb: 1024,
  kib: 1024,
  mb: 1024 * 1024,
  mib: 1024 * 1024,
  gb: 1024 * 1024 * 1024,
  gib: 1024 * 1024 * 1024,
};

/**
 * Parses manifest `maxAssetSize` values: plain byte counts (50000) or suffixed sizes (5MB, 5 mb).
 */
export function parseWidgetAssetSize(input: string | number): number | null {
  if (typeof input === 'number') {
    if (!Number.isFinite(input) || input <= 0) {
      return null;
    }
    return Math.floor(input);
  }

  const trimmed = String(input).trim().toLowerCase();
  if (!trimmed) {
    return null;
  }

  const match = trimmed.match(/^(\d+(?:\.\d+)?)\s*([a-z]+)?$/);
  if (!match) {
    return null;
  }

  const amount = Number(match[1]);
  if (!Number.isFinite(amount) || amount <= 0) {
    return null;
  }

  const unitRaw = match[2];
  if (!unitRaw) {
    return Math.floor(amount);
  }

  const multiplier = SIZE_UNIT_MULTIPLIERS[unitRaw];
  if (multiplier === undefined) {
    return null;
  }

  const bytes = amount * multiplier;
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return null;
  }

  return Math.floor(bytes);
}

/** Resolves the per-asset byte cap from manifest, falling back to the default. */
export function resolveMaxAssetBytes(manifest: WidgetManifest | null | undefined): number {
  const raw = manifest?.maxAssetSize;
  if (raw === undefined) {
    return DEFAULT_MAX_ASSET_BYTES;
  }

  const parsed = parseWidgetAssetSize(raw);
  if (parsed === null) {
    logger.warn('Invalid maxAssetSize in widget manifest, using default', { maxAssetSize: raw });
    return DEFAULT_MAX_ASSET_BYTES;
  }

  return parsed;
}

/** Human-readable size for conversation messages (base 1024). */
export function formatWidgetAssetBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  if (bytes < 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}
