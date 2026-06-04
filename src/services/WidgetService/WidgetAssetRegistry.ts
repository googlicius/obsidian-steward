import { WidgetBundler } from './WidgetBundler';

/**
 * Stable id for manifest assets: filename without extension (e.g. Images/x.png → x).
 * Use unique filenames when multiple assets could collide on the same stem.
 */
export function widgetAssetStemId(vaultRelativePath: string): string {
  const normalized = WidgetBundler.normalizeAssetPath(vaultRelativePath);
  const fileName = normalized.split('/').pop() ?? normalized;
  const dot = fileName.lastIndexOf('.');
  if (dot > 0) {
    return fileName.slice(0, dot);
  }
  return fileName;
}

/**
 * Maps manifest assets to data URLs for window.stw.assets / getAsset.
 * Keys: filename stem (primary) and normalized vault path (disambiguation).
 */
export function buildWidgetAssetRegistry(params: {
  manifestAssets: string[];
  assetDataUrls: Record<string, string>;
}): Record<string, string> {
  const registry: Record<string, string> = {};

  for (let i = 0; i < params.manifestAssets.length; i++) {
    const vaultPath = WidgetBundler.normalizeAssetPath(params.manifestAssets[i]);
    const assetKey = WidgetBundler.assetPathKey(vaultPath);
    const dataUrl = params.assetDataUrls[assetKey];
    if (!dataUrl) {
      continue;
    }

    registry[widgetAssetStemId(vaultPath)] = dataUrl;
    registry[vaultPath] = dataUrl;
  }

  return registry;
}
