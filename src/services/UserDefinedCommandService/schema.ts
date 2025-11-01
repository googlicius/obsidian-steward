import { ToolName } from 'src/solutions/commands/ToolRegistry';
import z from 'zod';

/**
 * Zod schema for SystemPromptModification
 */
const systemPromptModificationSchema = z.object({
  mode: z.enum(['modify', 'remove', 'add']),
  pattern: z.string().optional(),
  replacement: z.string().optional(),
  content: z.string().optional(),
  matchType: z.enum(['exact', 'partial', 'regex']).optional(),
});

/**
 * Zod schema for SystemPromptItem
 */
const systemPromptItemSchema = z.union([z.string(), systemPromptModificationSchema]);

/**
 * Validation refinement for SystemPromptModification based on mode
 */
const validateSystemPromptModification = (
  item: z.infer<typeof systemPromptModificationSchema>
): boolean => {
  if (item.mode === 'modify') {
    return !!item.pattern && !!item.replacement;
  }
  if (item.mode === 'remove') {
    return !!item.pattern;
  }
  if (item.mode === 'add') {
    return !!item.content;
  }
  return false;
};

/**
 * Zod schema for UserDefinedCommandStep
 */
const userDefinedCommandStepSchema = z.object({
  name: z.string().min(1, 'Command name is required'),
  system_prompt: z
    .array(systemPromptItemSchema)
    .optional()
    .refine(
      val => {
        if (!val) return true;
        return val.every(item => {
          if (typeof item === 'string') return true;
          return validateSystemPromptModification(item);
        });
      },
      {
        message:
          'system_prompt modification objects must have valid mode-specific fields (modify: pattern & replacement, remove: pattern, add: content)',
      }
    ),
  query: z.string().min(1, 'Step query is required'),
  model: z.string().optional(),
  no_confirm: z.boolean().optional(),
  tools: z
    .object({
      exclude: z.array(z.enum(Object.values(ToolName) as [string, ...string[]])).optional(),
    })
    .optional(),
});

/**
 * Zod schema for TriggerCondition
 */
const triggerConditionSchema = z
  .object({
    events: z
      .array(z.enum(['create', 'modify', 'delete']))
      .min(1, 'At least one event is required'),
    folders: z.array(z.string()).optional(),
    patterns: z.record(z.union([z.string(), z.array(z.string())])).optional(),
  })
  .refine(
    data => {
      // Validate regex pattern for content
      if (data.patterns?.content) {
        const pattern = Array.isArray(data.patterns.content)
          ? data.patterns.content[0]
          : data.patterns.content;
        try {
          new RegExp(pattern);
          return true;
        } catch {
          return false;
        }
      }
      return true;
    },
    {
      message: 'trigger pattern "content" must be a valid regex',
    }
  );

/**
 * Zod schema for UserDefinedCommand
 */
export const userDefinedCommandSchema = z.object({
  command_name: z
    .string()
    .min(1, 'Command name is required')
    .regex(
      /^[a-zA-Z0-9_-]+$/,
      'Command name must only contain alphanumeric characters, hyphens, and underscores (no spaces or special characters)'
    ),
  query_required: z.boolean().optional(),
  commands: z.array(userDefinedCommandStepSchema).min(1, 'At least one command step is required'),
  file_path: z.string(),
  model: z.string().optional(),
  hidden: z.boolean().optional(),
  triggers: z.array(triggerConditionSchema).optional(),
});
