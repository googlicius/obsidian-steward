import { z } from 'zod/v3';
import { WIDGET_ACTIONS_SCHEMA_NAME } from './WidgetProtocol';

export const widgetActionsSchema = z.object({
  name: z.literal(WIDGET_ACTIONS_SCHEMA_NAME),
  actions: z.record(
    z.object({
      description: z.string().optional(),
      params: z
        .record(
          z.object({
            type: z.enum(['integer', 'number', 'string', 'boolean']).optional(),
            minimum: z.number().optional(),
            maximum: z.number().optional(),
          })
        )
        .optional(),
    })
  ),
});

export type WidgetActionsCatalog = z.infer<typeof widgetActionsSchema>;

export type WidgetActionParamSpec = NonNullable<
  WidgetActionsCatalog['actions'][string]['params']
>[string];

export interface WidgetActionResult {
  ok: boolean;
  error?: string;
  state?: unknown;
}

export const widgetManifestSchema = z.object({
  name: z.literal('manifest'),
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
