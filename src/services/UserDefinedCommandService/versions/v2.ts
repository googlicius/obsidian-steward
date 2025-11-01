import z from 'zod';
import { NormalizedUserDefinedCommand, IVersionedUserDefinedCommand } from './types';
import {
  command_name,
  commandStepSchema,
  triggerConditionSchema,
  query_required,
  file_path,
  model,
} from './v1';

/**
 * Version 2 Schema - Uses 'steps' field instead of 'commands', no 'hidden' field
 */
export const userDefinedCommandV2Schema = z.object({
  version: z.literal(2).optional(),
  command_name,
  query_required,
  steps: z.array(commandStepSchema).min(1, 'At least one step is required'),
  file_path,
  model,
  triggers: z.array(triggerConditionSchema).optional(),
});

export type UserDefinedCommandV2Data = z.infer<typeof userDefinedCommandV2Schema>;

/**
 * Version 2 Implementation
 */
export class UserDefinedCommandV2 implements IVersionedUserDefinedCommand {
  public get normalized(): NormalizedUserDefinedCommand {
    return {
      command_name: this.data.command_name,
      query_required: this.data.query_required,
      steps: this.data.steps as NormalizedUserDefinedCommand['steps'],
      file_path: this.data.file_path || '',
      model: this.data.model,
      triggers: this.data.triggers,
    };
  }

  constructor(private readonly data: UserDefinedCommandV2Data) {}

  getVersion(): number {
    return 2;
  }

  isHidden(): boolean {
    // Version 2: Command is hidden if it has triggers (triggers indicate automation, not user-visible commands)
    // Actually, wait - let me reconsider. Having triggers doesn't mean it should be hidden from autocomplete.
    // Let me check the requirement again...
    // The user said: "we replace it in the `getCommandNames` function with the `triggers` field"
    // This suggests that if a command has triggers, it should be hidden (not shown in autocomplete)
    // So: hidden = has triggers
    return (this.data.triggers?.length ?? 0) > 0;
  }

  getRaw(): UserDefinedCommandV2Data {
    return this.data;
  }

  /**
   * Validate and create a V2 command instance
   */
  static validate(data: unknown): UserDefinedCommandV2Data {
    return userDefinedCommandV2Schema.parse(data);
  }
}
