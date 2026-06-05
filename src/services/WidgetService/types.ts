import { z } from 'zod/v3';

export const widgetActionsSchema = z.object({
  name: z.literal('actions'),
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
  maxAssetSize: z.union([z.number().positive(), z.string().min(1)]).optional(),
});

export type WidgetManifest = z.infer<typeof widgetManifestSchema>;

export interface WidgetAssetWarning {
  vaultPath: string;
  sizeBytes: number;
  maxBytes: number;
}

export const widgetActorsSchema = z.object({
  name: z.literal('actors'),
  mode: z.enum(['user_and_models', 'models_only']),
  turnOrder: z.array(z.string().min(1)).min(1),
  actors: z.record(
    z.object({
      kind: z.enum(['human', 'model']),
    })
  ),
});

export type WidgetActors = z.infer<typeof widgetActorsSchema>;

export const widgetAgentSchema = z.object({
  name: z.literal('agent'),
  id: z.string().min(1),
  instruction: z.string().min(1),
  actions: z.array(z.string().min(1)).min(1),
  model: z.string().optional(),
});

export type WidgetAgent = z.infer<typeof widgetAgentSchema>;

export interface WidgetDefinition {
  manifest: WidgetManifest | null;
  actions: WidgetActionsCatalog | null;
  actors: WidgetActors | null;
  agents: Record<string, WidgetAgent>;
}

export interface WidgetProjectFenceData {
  widgetId: string;
  projectPath: string;
}

/** Manifest asset registry: stem or vault path → allowed vault-relative path. */
export type WidgetAssetRegistryMap = Record<string, string>;

/** Bundled project HTML plus allowed asset registry for window.stw.assets. */
export interface WidgetProjectBundle {
  html: string;
  assets: WidgetAssetRegistryMap;
}

export type { WidgetState } from './WidgetStateService';
export { WIDGET_STATE_VERSION, widgetStateSchema } from './WidgetStateService';
