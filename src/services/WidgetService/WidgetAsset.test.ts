import { TFile } from 'obsidian';
import { getInstance } from 'src/utils/getInstance';
import type StewardPlugin from 'src/main';
import { WidgetAsset } from './WidgetAsset';

function createMockPlugin(params?: {
  files?: Record<string, ArrayBuffer>;
  statSizes?: Record<string, number>;
}): jest.Mocked<StewardPlugin> {
  const files = params?.files ?? {};
  const statSizes = params?.statSizes ?? {};

  return {
    app: {
      vault: {
        adapter: {
          stat: jest.fn(async (path: string) => {
            const size = statSizes[path];
            if (size === undefined) {
              return null;
            }
            return { size };
          }),
        },
        readBinary: jest.fn(async (file: TFile) => files[file.path] ?? new ArrayBuffer(0)),
      },
    },
    mediaTools: {
      findFileByNameOrPath: jest.fn(async (path: string) => {
        if (!files[path]) {
          return null;
        }
        return getInstance(TFile, { path, name: path.split('/').pop() ?? path, extension: 'png' });
      }),
    },
  } as unknown as jest.Mocked<StewardPlugin>;
}

describe('WidgetAsset.parseMaxSize', () => {
  it('parses plain byte counts', () => {
    expect(WidgetAsset.parseMaxSize(50000)).toBe(50000);
    expect(WidgetAsset.parseMaxSize('50000')).toBe(50000);
  });

  it('parses suffixed sizes with optional spacing and casing', () => {
    expect(WidgetAsset.parseMaxSize('5MB')).toBe(5 * 1024 * 1024);
    expect(WidgetAsset.parseMaxSize('5mb')).toBe(5 * 1024 * 1024);
    expect(WidgetAsset.parseMaxSize('5 mb')).toBe(5 * 1024 * 1024);
    expect(WidgetAsset.parseMaxSize('5 MB')).toBe(5 * 1024 * 1024);
    expect(WidgetAsset.parseMaxSize('1 GB')).toBe(1024 * 1024 * 1024);
    expect(WidgetAsset.parseMaxSize('512KB')).toBe(512 * 1024);
  });

  it('returns null for invalid values', () => {
    expect(WidgetAsset.parseMaxSize('')).toBeNull();
    expect(WidgetAsset.parseMaxSize('five MB')).toBeNull();
    expect(WidgetAsset.parseMaxSize('5 TB')).toBeNull();
    expect(WidgetAsset.parseMaxSize(-1)).toBeNull();
  });
});

describe('WidgetAsset.resolveMaxBytes', () => {
  it('uses default when manifest omits maxAssetSize', () => {
    expect(WidgetAsset.resolveMaxBytes(null)).toBe(WidgetAsset.DEFAULT_MAX_BYTES);
  });

  it('reads maxAssetSize from manifest', () => {
    const manifest = {
      name: 'manifest' as const,
      entry: 'index.html',
      type: 'html' as const,
      maxAssetSize: '6MB',
    };
    expect(WidgetAsset.resolveMaxBytes(manifest)).toBe(6 * 1024 * 1024);
  });

  it('falls back to default for invalid maxAssetSize', () => {
    const manifest = {
      name: 'manifest' as const,
      entry: 'index.html',
      type: 'html' as const,
      maxAssetSize: 'not-a-size',
    };
    expect(WidgetAsset.resolveMaxBytes(manifest)).toBe(WidgetAsset.DEFAULT_MAX_BYTES);
  });
});

describe('WidgetAsset.formatBytes', () => {
  it('formats human-readable sizes', () => {
    expect(WidgetAsset.formatBytes(500)).toBe('500 B');
    expect(WidgetAsset.formatBytes(2048)).toBe('2.0 KB');
    expect(WidgetAsset.formatBytes(5 * 1024 * 1024)).toBe('5.0 MB');
  });
});

describe('WidgetAsset.stemId', () => {
  it('returns filename without extension', () => {
    expect(WidgetAsset.stemId('Images/x.png')).toBe('x');
    expect(WidgetAsset.stemId('asset:Sprites/player-x.png')).toBe('player-x');
  });
});

describe('WidgetAsset.buildRegistry', () => {
  it('maps stem and vault path to allowed vault paths from manifest assets', () => {
    const registry = WidgetAsset.buildRegistry(['Images/x.png', 'Images/o.png']);

    expect(registry.x).toBe('Images/x.png');
    expect(registry.o).toBe('Images/o.png');
    expect(registry['Images/x.png']).toBe('Images/x.png');
    expect(registry['Images/o.png']).toBe('Images/o.png');
  });
});

describe('WidgetAsset.resolveManifestPath', () => {
  const manifestAssets = ['Images/logo.png', 'Audio/track.mp3'];

  it('resolves vault-relative paths listed in the manifest', () => {
    expect(WidgetAsset.resolveManifestPath('Images/logo.png', manifestAssets)).toBe(
      'Images/logo.png'
    );
    expect(WidgetAsset.resolveManifestPath('asset:Audio/track.mp3', manifestAssets)).toBe(
      'Audio/track.mp3'
    );
  });

  it('resolves unique filename stems listed in the manifest', () => {
    expect(WidgetAsset.resolveManifestPath('logo', manifestAssets)).toBe('Images/logo.png');
    expect(WidgetAsset.resolveManifestPath('track', manifestAssets)).toBe('Audio/track.mp3');
  });

  it('returns null for assets not listed in the manifest', () => {
    expect(WidgetAsset.resolveManifestPath('Images/other.png', manifestAssets)).toBeNull();
    expect(WidgetAsset.resolveManifestPath('secret', manifestAssets)).toBeNull();
  });

  it('returns null when stem is ambiguous across manifest assets', () => {
    const registry = WidgetAsset.buildRegistry(['Sprites/a.png', 'Icons/a.svg']);
    expect(registry.a).toBeUndefined();
    expect(registry['Sprites/a.png']).toBe('Sprites/a.png');
    expect(WidgetAsset.resolveManifestPath('a', ['Sprites/a.png', 'Icons/a.svg'])).toBeNull();
  });
});

describe('WidgetAsset.readManifestAsset', () => {
  it('returns asset bytes only for manifest-listed assets', async () => {
    const buffer = new Uint8Array([1, 2, 3]).buffer;
    const plugin = createMockPlugin({
      files: { 'Images/logo.png': buffer },
      statSizes: { 'Images/logo.png': 3 },
    });
    const asset = new WidgetAsset(plugin);

    const allowed = await asset.readManifestAsset({
      assetId: 'logo',
      manifestAssets: ['Images/logo.png'],
      maxAssetBytes: 1024,
    });
    const denied = await asset.readManifestAsset({
      assetId: 'Images/other.png',
      manifestAssets: ['Images/logo.png'],
      maxAssetBytes: 1024,
    });

    expect(allowed.ok).toBe(true);
    if (allowed.ok) {
      expect(allowed.vaultPath).toBe('Images/logo.png');
      expect(allowed.mimeType).toBe('image/png');
      expect(new Uint8Array(allowed.buffer)).toEqual(new Uint8Array([1, 2, 3]));
    }
    expect(denied).toEqual({ ok: false, error: 'asset_not_allowed' });
  });

  it('rejects assets over the max size cap', async () => {
    const plugin = createMockPlugin({
      files: { 'Audio/track.mp3': new ArrayBuffer(10) },
      statSizes: { 'Audio/track.mp3': 10 },
    });
    const asset = new WidgetAsset(plugin);

    const result = await asset.readManifestAsset({
      assetId: 'Audio/track.mp3',
      manifestAssets: ['Audio/track.mp3'],
      maxAssetBytes: 5,
    });

    expect(result).toEqual({ ok: false, error: 'asset_too_large' });
  });
});
