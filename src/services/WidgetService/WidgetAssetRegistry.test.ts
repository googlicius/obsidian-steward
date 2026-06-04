import { WidgetBundler } from './WidgetBundler';
import { buildWidgetAssetRegistry, widgetAssetStemId } from './WidgetAssetRegistry';

describe('widgetAssetStemId', () => {
  it('returns filename without extension', () => {
    expect(widgetAssetStemId('Images/x.png')).toBe('x');
    expect(widgetAssetStemId('asset:Sprites/player-x.png')).toBe('player-x');
  });
});

describe('buildWidgetAssetRegistry', () => {
  it('maps stem and vault path to data URLs from manifest assets', () => {
    const registry = buildWidgetAssetRegistry({
      manifestAssets: ['Images/x.png', 'Images/o.png'],
      assetDataUrls: {
        'asset:Images/x.png': 'data:image/png;base64,xx',
        'asset:Images/o.png': 'data:image/png;base64,oo',
      },
    });

    expect(registry.x).toBe('data:image/png;base64,xx');
    expect(registry.o).toBe('data:image/png;base64,oo');
    expect(registry['Images/x.png']).toBe('data:image/png;base64,xx');
    expect(registry['Images/o.png']).toBe('data:image/png;base64,oo');
  });

  it('skips manifest entries missing from assetDataUrls', () => {
    const registry = buildWidgetAssetRegistry({
      manifestAssets: ['Images/missing.png', 'Images/ok.png'],
      assetDataUrls: {
        [WidgetBundler.assetPathKey('Images/ok.png')]: 'data:image/png;base64,ok',
      },
    });

    expect(registry.ok).toBe('data:image/png;base64,ok');
    expect(registry.missing).toBeUndefined();
  });
});
