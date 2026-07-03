import { TFile } from 'obsidian';
import type StewardPlugin from 'src/main';
import { logger } from 'src/utils/logger';
import { WidgetBundler } from './WidgetBundler';
import type { WidgetAssetRegistryMap, WidgetAssetWarning, WidgetManifest } from './types';

export interface WidgetAssetReadResult {
  ok: true;
  buffer: ArrayBuffer;
  mimeType: string;
  vaultPath: string;
}

export interface WidgetAssetReadError {
  ok: false;
  error: string;
}

export type WidgetAssetReadResponse = WidgetAssetReadResult | WidgetAssetReadError;

/** Size limits and host-side reads for manifest-listed widget vault assets. */
export class WidgetAsset {
  /** Default per-asset cap when manifest omits `maxAssetSize`. */
  static readonly DEFAULT_MAX_BYTES = 5 * 1024 * 1024;

  /** Default `maxAssetSize` written into Definition.md manifest on project create. */
  static readonly DEFAULT_MAX_SIZE_MANIFEST = '5 MB';

  private static readonly SIZE_UNIT_MULTIPLIERS: Record<string, number> = {
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

  private static readonly MIME_BY_EXTENSION: Record<string, string> = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
    svg: 'image/svg+xml',
    mp3: 'audio/mpeg',
    wav: 'audio/wav',
    ogg: 'audio/ogg',
    m4a: 'audio/mp4',
    aac: 'audio/aac',
    flac: 'audio/flac',
    weba: 'audio/webm',
    mp4: 'video/mp4',
    webm: 'video/webm',
    ogv: 'video/ogg',
    mov: 'video/quicktime',
    m4v: 'video/mp4',
  };

  constructor(private readonly plugin: StewardPlugin) {}

  /**
   * Parses manifest `maxAssetSize` values: plain byte counts (50000) or suffixed sizes (5MB, 5 mb).
   */
  static parseMaxSize(input: string | number): number | null {
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

    const multiplier = WidgetAsset.SIZE_UNIT_MULTIPLIERS[unitRaw];
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
  static resolveMaxBytes(manifest: WidgetManifest | null | undefined): number {
    const raw = manifest?.maxAssetSize;
    if (raw === undefined) {
      return WidgetAsset.DEFAULT_MAX_BYTES;
    }

    const parsed = WidgetAsset.parseMaxSize(raw);
    if (parsed === null) {
      logger.warn('Invalid maxAssetSize in widget manifest, using default', { maxAssetSize: raw });
      return WidgetAsset.DEFAULT_MAX_BYTES;
    }

    return parsed;
  }

  /** Human-readable size for conversation messages (base 1024). */
  static formatBytes(bytes: number): string {
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

  /**
   * Stable id for manifest assets: filename without extension (e.g. Images/x.png → x).
   * Use unique filenames when multiple assets could collide on the same stem.
   */
  static stemId(vaultRelativePath: string): string {
    const normalized = WidgetBundler.normalizeAssetPath(vaultRelativePath);
    const fileName = normalized.split('/').pop() ?? normalized;
    const dot = fileName.lastIndexOf('.');
    if (dot > 0) {
      return fileName.slice(0, dot);
    }
    return fileName;
  }

  /**
   * Maps manifest assets to allowed vault paths for window.stw.assets / getAsset.
   * Keys: filename stem (when unique) and normalized vault path.
   */
  static buildRegistry(manifestAssets: string[]): WidgetAssetRegistryMap {
    const registry: WidgetAssetRegistryMap = {};
    const stemCounts: Record<string, number> = {};

    for (let i = 0; i < manifestAssets.length; i++) {
      const vaultPath = WidgetBundler.normalizeAssetPath(manifestAssets[i]);
      const stem = WidgetAsset.stemId(vaultPath);
      registry[vaultPath] = vaultPath;
      stemCounts[stem] = (stemCounts[stem] ?? 0) + 1;
    }

    for (let i = 0; i < manifestAssets.length; i++) {
      const vaultPath = WidgetBundler.normalizeAssetPath(manifestAssets[i]);
      const stem = WidgetAsset.stemId(vaultPath);
      if (stemCounts[stem] === 1) {
        registry[stem] = vaultPath;
      }
    }

    return registry;
  }

  /**
   * Resolves an asset id (stem, vault path, or asset:path) to a manifest-listed vault path.
   * Returns null when the id is not allowed by the manifest.
   */
  static resolveManifestPath(assetId: string, manifestAssets: string[]): string | null {
    if (!assetId || manifestAssets.length === 0) {
      return null;
    }

    const normalizedId = WidgetBundler.normalizeAssetPath(assetId);
    const stemMatches: string[] = [];

    for (let i = 0; i < manifestAssets.length; i++) {
      const vaultPath = WidgetBundler.normalizeAssetPath(manifestAssets[i]);

      if (normalizedId === vaultPath) {
        return vaultPath;
      }

      if (normalizedId === WidgetAsset.stemId(vaultPath)) {
        stemMatches.push(vaultPath);
      }
    }

    if (stemMatches.length === 1) {
      return stemMatches[0];
    }

    return null;
  }

  /**
   * Reads a manifest-listed asset from the vault for iframe delivery via postMessage.
   * Only assets declared in the manifest are allowed.
   */
  async readManifestAsset(params: {
    assetId: string;
    manifestAssets: string[];
    maxAssetBytes: number;
  }): Promise<WidgetAssetReadResponse> {
    const vaultRelativePath = WidgetAsset.resolveManifestPath(
      params.assetId,
      params.manifestAssets
    );
    if (!vaultRelativePath) {
      return { ok: false, error: 'asset_not_allowed' };
    }

    const file = await this.plugin.mediaTools.findFileByNameOrPath(vaultRelativePath);
    if (!file) {
      logger.warn(`Widget asset not found: ${vaultRelativePath}`);
      return { ok: false, error: 'asset_not_found' };
    }

    const readResult = await this.readFileBinary(file, params.maxAssetBytes);
    if (!readResult.buffer) {
      if (readResult.warning) {
        return { ok: false, error: 'asset_too_large' };
      }
      return { ok: false, error: 'asset_read_failed' };
    }

    return {
      ok: true,
      buffer: readResult.buffer,
      mimeType: readResult.mimeType,
      vaultPath: vaultRelativePath,
    };
  }

  private async readFileBinary(
    file: TFile,
    maxAssetBytes: number
  ): Promise<{ buffer: ArrayBuffer | null; mimeType: string; warning?: WidgetAssetWarning }> {
    const stat = await this.plugin.app.vault.adapter.stat(file.path);
    if (stat && stat.size > maxAssetBytes) {
      const warning: WidgetAssetWarning = {
        vaultPath: file.path,
        sizeBytes: stat.size,
        maxBytes: maxAssetBytes,
      };
      logger.warn(
        `Widget asset too large, skipping: ${file.path} (${stat.size} bytes, max ${maxAssetBytes})`
      );
      return { buffer: null, mimeType: this.getMimeType(file.extension), warning };
    }

    const binary = await this.plugin.app.vault.readBinary(file);
    if (binary.byteLength > maxAssetBytes) {
      const warning: WidgetAssetWarning = {
        vaultPath: file.path,
        sizeBytes: binary.byteLength,
        maxBytes: maxAssetBytes,
      };
      logger.warn(
        `Widget asset too large, skipping: ${file.path} (${binary.byteLength} bytes, max ${maxAssetBytes})`
      );
      return { buffer: null, mimeType: this.getMimeType(file.extension), warning };
    }

    return { buffer: binary, mimeType: this.getMimeType(file.extension) };
  }

  private getMimeType(extension: string): string {
    return WidgetAsset.MIME_BY_EXTENSION[extension.toLowerCase()] ?? 'application/octet-stream';
  }
}
