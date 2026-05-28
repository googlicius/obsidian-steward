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
  });

  describe('manifestAssetsFromBindings', () => {
    it('adds vault: prefix when source is a bare path', () => {
      const assets = WidgetBundler.manifestAssetsFromBindings([
        { key: 'logo', source: 'Attachments/logo.png', inject: 'dataUrl' },
      ]);

      expect(assets.logo.source).toBe('vault:Attachments/logo.png');
      expect(assets.logo.inject).toBe('dataUrl');
    });
  });

  describe('bundle', () => {
    it('inlines local CSS and JS referenced from the entry HTML', async () => {
      const plugin = createMockPlugin(vaultRead);
      const bundler = new WidgetBundler(plugin);

      const html = await bundler.bundle({
        projectPath: 'Widgets/conv/w1',
        entryRelativePath: 'index.html',
        assetData: { dataUrls: {}, globals: {} },
      });

      expect(html).toMatchSnapshot();
    });

    it('replaces {{widget-asset:key}} placeholders with bundled data URLs', async () => {
      vaultRead.mockImplementation(async (file: TFile) => {
        if (file.path.endsWith('index.html')) {
          return '<img src="{{widget-asset:logo}}" />';
        }
        return '';
      });

      const plugin = createMockPlugin(vaultRead);
      const bundler = new WidgetBundler(plugin);

      const html = await bundler.bundle({
        projectPath: 'Widgets/conv/w1',
        entryRelativePath: 'index.html',
        assetData: {
          dataUrls: { logo: 'data:image/png;base64,abc' },
          globals: {},
        },
      });

      expect(html).toMatchSnapshot();
    });
  });
});
