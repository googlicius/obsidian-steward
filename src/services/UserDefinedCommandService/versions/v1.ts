import { z } from 'zod/v3';
import { NormalizedUserDefinedCommand, IVersionedUserDefinedCommand } from './types';

// Export to other versions - Shared Zod schemas
/**
 * Shared Zod schema for CommandStep
 * Used across all versions (v1 uses 'commands' field, v2 uses 'steps' field)
 */
export const commandStepSchema = z.object({
  name: z.string().min(1, 'Command name is required').optional(),
  system_prompt: z.array(z.string()).optional(),
  query: z.string().min(1, 'Step query is required'),
  model: z.string().optional(),
  no_confirm: z.boolean().optional(),
});

/**
 * Shared Zod schema for TriggerCondition
 * Used across all versions
 */
export const triggerConditionSchema = z
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

// Export to other versions - Common field schemas
export const command_name = z
  .string()
  .min(1, 'Command name is required')
  .regex(
    /^[a-zA-Z0-9_-]+$/,
    'Command name must only contain alphanumeric characters, hyphens, and underscores (no spaces or special characters)'
  );

export const query_required = z.boolean().optional();

export const file_path = z.string().optional(); // Added during loading

export const model = z.string().optional();

/**
 * Version 1 Schema - Uses 'commands' field and 'hidden' field
 */
export const userDefinedCommandV1Schema = z.object({
  version: z.literal(1).optional(),
  command_name,
  query_required,
  commands: z.array(commandStepSchema).min(1, 'At least one command step is required'),
  file_path,
  model,
  hidden: z.boolean().optional(),
  triggers: z.array(triggerConditionSchema).optional(),
});

export type UserDefinedCommandV1Data = z.infer<typeof userDefinedCommandV1Schema>;

/**
 * Version 1 Implementation
 */
export class UserDefinedCommandV1 implements IVersionedUserDefinedCommand {
  public get normalized(): NormalizedUserDefinedCommand {
    return {
      command_name: this.data.command_name,
      query_required: this.data.query_required,
      steps: this.data.commands as NormalizedUserDefinedCommand['steps'], // Map 'commands' to 'steps'
      file_path: this.data.file_path || '',
      model: this.data.model,
      triggers: this.data.triggers,
    };
  }

  constructor(private readonly data: UserDefinedCommandV1Data) {}

  getVersion(): number {
    return 1;
  }

  isHidden(): boolean {
    // Version 1: Use the 'hidden' field
    return this.data.hidden === true;
  }

  getRaw(): UserDefinedCommandV1Data {
    return this.data;
  }

  /**
   * Validate and create a V1 command instance
   */
  static validate(data: unknown): UserDefinedCommandV1Data {
    return userDefinedCommandV1Schema.parse(data);
  }
}
