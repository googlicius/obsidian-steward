import { z } from 'zod/v3';
import { WIDGET_MANIFEST_SCHEMA_NAME } from './WidgetProtocol';

export const widgetManifestSchema = z.object({
  name: z.literal(WIDGET_MANIFEST_SCHEMA_NAME),
  entry: z.string().min(1),
  type: z.literal('html'),
  widgetId: z.string().optional(),
  widgetName: z.string().optional(),
  assets: z.array(z.string()).optional(),
});

export type WidgetManifest = z.infer<typeof widgetManifestSchema>;

export interface WidgetProjectFenceData {
  widgetId: string;
  projectPath: string;
}

export type { WidgetState } from './WidgetStateSchema';
export { WIDGET_STATE_VERSION, widgetStateSchema } from './WidgetStateSchema';
