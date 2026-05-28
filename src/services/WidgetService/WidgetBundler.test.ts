import { TFile } from 'obsidian';
import { getInstance } from 'src/utils/getInstance';
import type StewardPlugin from 'src/main';
import { WidgetBundler } from './WidgetBundler';

function createMockPlugin(vaultRead: jest.Mock): jest.Mocked<StewardPlugin> {
  return {
    app: {
      vault: {
        getFileByPath: jest.fn((path: string) => {
          const files: Record<string, { content: string }> = {
            'Widgets/conv/w1/index.html': {
              content:
                '<link rel="stylesheet" href="style.css"><script src="main.js"></script><p>Hi</p>',
            },
            'Widgets/conv/w1/style.css': { content: 'body { color: red; }' },
            'Widgets/conv/w1/main.js': { content: 'console.log("ok");' },
          };
          const entry = files[path];
          if (!entry) {
            return null;
          }
          return getInstance(TFile, { path, name: path.split('/').pop() ?? path });
        }),
        read: vaultRead,
      },
    },
  } as unknown as jest.Mocked<StewardPlugin>;
}

describe('WidgetBundler', () => {
  let vaultRead: jest.Mock;
  let bundler: WidgetBundler;

  beforeEach(() => {
    vaultRead = jest.fn(async (file: TFile) => {
      const map: Record<string, string> = {
        'Widgets/conv/w1/index.html':
          '<link rel="stylesheet" href="style.css"><script src="main.js"></script><p>Hi</p>',
        'Widgets/conv/w1/style.css': 'body { color: red; }',
        'Widgets/conv/w1/main.js': 'console.log("ok");',
      };
      return map[file.path] ?? '';
    });
    bundler = new WidgetBundler(createMockPlugin(vaultRead));
  });

  describe('normalizeAssetPath', () => {
    it('normalizes vault-relative paths', () => {
      expect(WidgetBundler.normalizeAssetPath('Images/logo.png')).toBe('Images/logo.png');
      expect(WidgetBundler.normalizeAssetPath('Attachments/logo.png')).toBe(
        'Attachments/logo.png'
      );
    });

    it('strips asset: prefix when present in the assets array', () => {
      expect(WidgetBundler.normalizeAssetPath('asset:Images/logo.png')).toBe('Images/logo.png');
    });
  });

  describe('assetPathKey', () => {
    it('builds the HTML reference key', () => {
      expect(bundler.assetPathKey('Images/logo.png')).toBe('asset:Images/logo.png');
    });
  });

  describe('extractAssetPaths', () => {
    it('collects unique asset: paths from HTML attributes and CSS url()', () => {
      const content = [
        '<img src="asset:Images/logo.png" />',
        'background: url(asset:Attachments/bg.png);',
        '<link href="asset:Docs/theme.css" />',
      ].join('\n');

      expect(bundler.extractAssetPaths(content)).toEqual([
        'Attachments/bg.png',
        'Docs/theme.css',
        'Images/logo.png',
      ]);
    });
  });

  describe('findMissingAssets', () => {
    it('returns referenced paths that are not in the declared assets list', () => {
      const missing = bundler.findMissingAssets({
        content: '<img src="asset:Images/logo.png" /><img src="asset:Images/icon.png" />',
        declaredAssets: ['Images/logo.png'],
      });

      expect(missing).toEqual(['Images/icon.png']);
    });

    it('returns an empty array when all referenced paths are declared', () => {
      const missing = bundler.findMissingAssets({
        content: '<img src="asset:Images/logo.png" />',
        declaredAssets: ['asset:Images/logo.png'],
      });

      expect(missing).toEqual([]);
    });
  });

  describe('applyAssetPaths', () => {
    it('replaces asset: path references with bundled data URLs', () => {
      const html = bundler.applyAssetPaths('<img src="asset:Images/logo.png" />', {
        'asset:Images/logo.png': 'data:image/png;base64,abc',
      });

      expect(html).toMatchSnapshot();
    });
  });

  describe('bundle', () => {
    it('inlines local CSS and JS referenced from the entry HTML', async () => {
      const html = await bundler.bundle({
        projectPath: 'Widgets/conv/w1',
        entryRelativePath: 'index.html',
        assetDataUrls: {},
      });

      expect(html).toMatchSnapshot();
    });

    it('replaces asset: path references with bundled data URLs', async () => {
      vaultRead.mockImplementation(async (file: TFile) => {
        if (file.path.endsWith('index.html')) {
          return '<img src="asset:Images/logo.png" />';
        }
        return '';
      });

      const plugin = createMockPlugin(vaultRead);
      bundler = new WidgetBundler(plugin);

      const html = await bundler.bundle({
        projectPath: 'Widgets/conv/w1',
        entryRelativePath: 'index.html',
        assetDataUrls: {
          'asset:Images/logo.png': 'data:image/png;base64,abc',
        },
      });

      expect(html).toMatchSnapshot();
    });
  });
});
