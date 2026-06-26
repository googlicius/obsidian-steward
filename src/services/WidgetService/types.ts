import { z } from 'zod/v3';
import { ToolName } from 'src/solutions/commands/ToolRegistry';
import { WIDGET_STATE_SAVE_SOURCE_MODEL_DISPATCH } from './WidgetProtocol';

export const widgetActionsSchema = z.object({
  name: z.literal('actions'),
  actions: z.record(
    z.object({
      description: z.string().optional(),
      /** When false, the actor may take another action before the roster advances. Defaults to true. */
      endTurn: z.boolean().optional(),
      params: z
        .record(
          z.object({
            type: z.enum(['integer', 'number', 'string', 'boolean']).optional(),
            minimum: z.number().optional(),
            maximum: z.number().optional(),
            /** When false, the param may be omitted on dispatch. Defaults to required. */
            required: z.boolean().optional(),
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

export const widgetQueriesSchema = z.object({
  name: z.literal('queries'),
  queries: z.record(
    z.object({
      description: z.string().optional(),
      params: z
        .record(
          z.object({
            type: z.enum(['integer', 'number', 'string', 'boolean']).optional(),
            minimum: z.number().optional(),
            maximum: z.number().optional(),
            /** When false, the param may be omitted on dispatch. Defaults to required. */
            required: z.boolean().optional(),
          })
        )
        .optional(),
    })
  ),
});

export type WidgetQueriesCatalog = z.infer<typeof widgetQueriesSchema>;

export type WidgetQueryParamSpec = NonNullable<
  WidgetQueriesCatalog['queries'][string]['params']
>[string];

export interface WidgetActionResult {
  ok: boolean;
  error?: string;
  state?: unknown;
  /** Overrides catalog endTurn when present. */
  endTurn?: boolean;
}

export interface WidgetQueryResult {
  ok: boolean;
  error?: string;
  data?: unknown;
}

/** Human/model move metadata on setState; host-only — never stored in `data`. */
export const widgetStateSaveMoveSchema = z.object({
  action: z.string().min(1),
  params: z.record(z.unknown()).optional(),
  comment: z.string().optional(),
  /** When false, human/model iframe save does not advance the roster. Defaults from catalog. */
  endTurn: z.boolean().optional(),
});

export type WidgetStateSaveMove = z.infer<typeof widgetStateSaveMoveSchema>;

/** Who initiated a gameplay setState; host-only — never stored in `data`. */
export const widgetStateSaveSourceSchema = z
  .literal(WIDGET_STATE_SAVE_SOURCE_MODEL_DISPATCH)
  .or(z.literal('human'));

export type WidgetStateSaveSource = z.infer<typeof widgetStateSaveSourceSchema>;

/** Optional second argument to `window.stw.setState(data, options)`. Host-only; never stored in `data`. */
export const widgetStateSaveOptionsSchema = z.object({
  /**
   * `reset` — clears host session after save; no model turn.
   * `start` — user-initiated play; when turnOrder[0] is model, runs that actor's turn.
   * `reset_and_start` — clears session then starts (model-first when turnOrder[0] is model).
   * Model turns never start on widget mount — use click/hotkey with one of the intents above.
   */
  intent: z
    .union([z.literal('reset'), z.literal('start'), z.literal('reset_and_start')])
    .optional(),
  /** Records the human move in session moveLog when the current actor is human. */
  move: widgetStateSaveMoveSchema.optional(),
  /**
   * Set automatically by the host iframe bridge when setState runs inside dispatchAction.
   * Human UI saves omit this or may pass `human`.
   */
  source: widgetStateSaveSourceSchema.optional(),
});

export type WidgetStateSaveOptions = z.infer<typeof widgetStateSaveOptionsSchema>;

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

/** Read-only actors roster injected into interactive widget iframes (from Widget.md). */
export type WidgetIframeActorsConfig = {
  mode: WidgetActors['mode'];
  turnOrder: string[];
  actors: WidgetActors['actors'];
};

export const widgetAgentSchema = z.object({
  name: z.literal('agent'),
  id: z.string().min(1),
  instructions: z.array(z.string().min(1)).min(1),
  actions: z.array(z.string().min(1)).min(1),
  queries: z.array(z.string().min(1)).optional(),
  model: z.string().optional(),
  /** Steward tools for this actor; widget_action is always included. */
  tools: z.array(z.nativeEnum(ToolName)).optional(),
});

export type WidgetAgent = z.infer<typeof widgetAgentSchema>;

/** Built-in read-only query; host returns public `data` without iframe dispatch. */
export const DEFAULT_WIDGET_QUERY_NAME = 'get_state';

export function resolveAgentAllowedQueries(agent: WidgetAgent): string[] {
  const allowed = [DEFAULT_WIDGET_QUERY_NAME];
  const extra = agent.queries ?? [];
  for (let i = 0; i < extra.length; i++) {
    const name = extra[i];
    if (name !== DEFAULT_WIDGET_QUERY_NAME && !allowed.includes(name)) {
      allowed.push(name);
    }
  }
  return allowed;
}

export const widgetSessionPhaseSchema = z.enum(['awaiting_input', 'thinking', 'ended']);

export const widgetSessionMoveSchema = z.object({
  actor: z.string().min(1),
  action: z.string().min(1),
  comment: z.string().optional(),
  at: z.string().min(1),
});

export const widgetSessionSchema = z.object({
  conversationTitle: z.string().min(1),
  actor: z.string().min(1),
  turnIndex: z.number().int().nonnegative(),
  phase: widgetSessionPhaseSchema,
  moveLog: z.array(widgetSessionMoveSchema).optional(),
  /** Host snapshot of `data` after last processed turn (dedupe debounced iframe saves). */
  lastDataSnapshot: z.unknown().optional(),
  /** When true, the next human-actor `setState` only syncs `lastDataSnapshot` (e.g. after startNewSession board reset). */
  suppressHumanAdvanceOnce: z.boolean().optional(),
});

export type WidgetSessionPhase = z.infer<typeof widgetSessionPhaseSchema>;
export type WidgetSessionMove = z.infer<typeof widgetSessionMoveSchema>;
export type WidgetSessionData = z.infer<typeof widgetSessionSchema>;

export const WIDGET_STATE_VERSION = 1;

/** Persisted widget runtime state envelope stored in state.json */
export const widgetStateSchema = z
  .object({
    version: z.literal(WIDGET_STATE_VERSION),
    updatedAt: z.string().min(1),
    data: z.unknown(),
    session: widgetSessionSchema.optional(),
  })
  .superRefine((value, ctx) => {
    if (!Object.prototype.hasOwnProperty.call(value, 'data') || value.data === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'data is required',
        path: ['data'],
      });
    }
  });

export type WidgetState = z.infer<typeof widgetStateSchema>;

export interface WidgetDefinition {
  manifest: WidgetManifest | null;
  actions: WidgetActionsCatalog | null;
  queries: WidgetQueriesCatalog | null;
  actors: WidgetActors | null;
  agents: Record<string, WidgetAgent>;
}

export interface WidgetProjectFenceData {
  widgetId: string;
  projectPath: string;
  lang: string | null;
  /** Vault-relative path to bundled HTML for iframe `src` loading, when set in the fence. */
  generatedFile: string | null;
}

/** Manifest asset registry: stem or vault path → allowed vault-relative path. */
export type WidgetAssetRegistryMap = Record<string, string>;

/** Bundled project HTML plus allowed asset registry for window.stw.assets. */
export interface WidgetProjectBundle {
  html: string;
  assets: WidgetAssetRegistryMap;
}
