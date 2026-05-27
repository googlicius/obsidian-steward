export type WidgetAssetInject = 'dataUrl' | 'global';

export interface WidgetManifestAsset {
  source: string;
  inject: WidgetAssetInject;
  globalName?: string;
}

export interface WidgetManifest {
  entry: string;
  type: 'html';
  assets?: Record<string, WidgetManifestAsset>;
}

export interface WidgetAssetBinding {
  key: string;
  source: string;
  inject: WidgetAssetInject;
  globalName?: string;
}

export interface WidgetProjectFenceData {
  widgetId: string;
  projectPath: string;
}

export interface WidgetBundlerAssetData {
  dataUrls: Record<string, string>;
  globals: Record<string, unknown>;
}
