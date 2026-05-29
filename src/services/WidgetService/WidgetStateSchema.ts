import { z } from 'zod/v3';

export const WIDGET_STATE_VERSION = 1;

/** Persisted widget runtime state envelope stored in state.json */
export const widgetStateSchema = z
  .object({
    version: z.literal(WIDGET_STATE_VERSION),
    updatedAt: z.string().min(1),
    data: z.unknown(),
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

export type ParseWidgetStateResult =
  | { valid: true; data: WidgetState }
  | { valid: false; errors: string[] };

/** Validates parsed JSON from state.json; returns structured errors when invalid. */
export function parseWidgetState(data: unknown): ParseWidgetStateResult {
  const result = widgetStateSchema.safeParse(data);
  if (result.success) {
    return { valid: true, data: result.data };
  }

  const errors: string[] = [];
  for (let i = 0; i < result.error.issues.length; i++) {
    const issue = result.error.issues[i];
    const path = issue.path.length > 0 ? `${issue.path.join('.')}: ` : '';
    errors.push(`${path}${issue.message}`);
  }

  return { valid: false, errors };
}
