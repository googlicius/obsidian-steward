import { z } from 'zod/v3';

const guardrailsActionSchema = z.enum([
  'read',
  'list',
  'create',
  'edit',
  'delete',
  'grep',
  'move',
  'rename',
  'copy',
  'update_frontmatter',
]);

export const guardrailsRuleFrontmatterSchema = z.object({
  name: z
    .string({ required_error: 'Rule name is required' })
    .min(1, 'Rule name is required'),
  targets: z
    .array(z.string().min(1, 'Target must be a non-empty string'))
    .min(1, 'At least one target is required'),
  actions: z
    .array(guardrailsActionSchema)
    .min(1, 'At least one action is required'),
  instruction: z.string().optional(),
  enabled: z
    .union([z.boolean(), z.literal('true'), z.literal('false')])
    .optional(),
});

export type GuardrailsRuleFrontmatterData = z.infer<
  typeof guardrailsRuleFrontmatterSchema
>;

export type ValidateRuleResult =
  | { valid: true; data: GuardrailsRuleFrontmatterData }
  | { valid: false; errors: string[] };
