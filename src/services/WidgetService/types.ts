export interface WidgetManifest {
  entry: string;
  type: 'html';
  assets?: string[];
}

export interface WidgetProjectFenceData {
  widgetId: string;
  projectPath: string;
}

export type { WidgetState } from './WidgetStateSchema';
export { WIDGET_STATE_VERSION, widgetStateSchema } from './WidgetStateSchema';
