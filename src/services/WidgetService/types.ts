export interface WidgetManifest {
  entry: string;
  type: 'html';
  assets?: string[];
}

export interface WidgetProjectFenceData {
  widgetId: string;
  projectPath: string;
}
