import { z } from 'zod/v3';
import { ToolName } from 'src/solutions/commands/ToolRegistry';
import type StewardPlugin from 'src/main';
import { NormalizedUserDefinedCommand, IVersionedUserDefinedCommand } from './types';
import {
  command_name,
  commandStepSchema,
  triggerConditionSchema,
  query_required,
  file_path,
  model,
} from './v1';

// Version 2 only fields
const system_prompt = z.array(z.string()).optional();
const tools = z.array(z.nativeEnum(ToolName)).optional();
const show_todo_list = z.boolean().optional();

const shellWhitelistEntrySchema = z
  .string()
  .min(1)
  .max(2000)
  .refine(v => /[^*]/.test(v.trim()), {
    message: 'cli.whitelist entries must include at least one non-* character',
  });

const shellWhitelistListSchema = z.array(shellWhitelistEntrySchema).max(50).optional();

/**
 * V2 root `cli` input: optional shell override and/or whitelist.
 * Parse output is normalized (trimmed shell, copied whitelist, omitted when nothing effective).
 */
export const udcV2RootCliSchema = z
  .object({
    shell: z.string().optional(),
    whitelist: shellWhitelistListSchema,
  })
  .transform((data): NormalizedUserDefinedCommand['cli'] | undefined => {
    const shellTrimmed = data.shell?.trim();
    const hasShell = Boolean(shellTrimmed && shellTrimmed.length > 0);
    const whitelist = data.whitelist;
    const hasWhitelist = Boolean(whitelist && whitelist.length > 0);

    if (!hasShell && !hasWhitelist) {
      return undefined;
    }

    const out: NormalizedUserDefinedCommand['cli'] = {};
    if (hasShell && shellTrimmed) {
      out.shell = shellTrimmed;
    }
    if (hasWhitelist && whitelist) {
      out.whitelist = [...whitelist];
    }
    return out;
  });

/** V2 steps use the same shape as v1 (no step-level `cli`). */
export const commandStepV2Schema = commandStepSchema;

/**
 * Version 2 Schema - Uses 'steps' field instead of 'commands', no 'hidden' field
 */
export const userDefinedCommandV2Schema = z.object({
  version: z.literal(2).optional(),
  command_name,
  description: z.string().optional(),
  /** When set, overrides the note's frontmatter `enabled` for this command only. */
  enabled: z.boolean().optional(),
  query_required,
  steps: z.array(commandStepV2Schema).min(1, 'At least one step is required'),
  file_path,
  model,
  system_prompt,
  tools,
  show_todo_list,
  triggers: z.array(triggerConditionSchema).optional(),
  cli: udcV2RootCliSchema.optional(),
});

export type UserDefinedCommandV2Data = z.infer<typeof userDefinedCommandV2Schema>;

/**
 * Version 2 Implementation
 */
export class UserDefinedCommandV2 implements IVersionedUserDefinedCommand {
  public get normalized(): NormalizedUserDefinedCommand {
    const filePath = this.data.file_path || '';
    const enabled = this.data.enabled !== undefined ? this.data.enabled : this.noteEnabled;
    const transformPrompt = (prompt: string) =>
      this.transformHeadingOnlyWikilinks(prompt, filePath);

    // Transform heading-only wikilinks in root-level system_prompt
    const transformedSystemPrompt = this.data.system_prompt?.map(transformPrompt);

    // Transform heading-only wikilinks in step-level system_prompt
    const transformedSteps = this.data.steps.map(step => {
      if (step.system_prompt) {
        return {
          ...step,
          system_prompt: step.system_prompt.map(transformPrompt),
        };
      }
      return step;
    });

    return {
      command_name: this.data.command_name,
      description: this.data.description,
      enabled,
      query_required: this.data.query_required,
      steps: transformedSteps,
      file_path: filePath,
      model: this.data.model,
      system_prompt: transformedSystemPrompt,
      tools: this.data.tools,
      show_todo_list: this.data.show_todo_list,
      triggers: this.data.triggers,
      cli: this.data.cli,
    };
  }

  constructor(
    private readonly data: UserDefinedCommandV2Data,
    /** Note frontmatter `enabled` for the defining file (`enabled !== false` → true). */
    private readonly noteEnabled = true,
    private readonly plugin?: StewardPlugin
  ) {}

  private transformHeadingOnlyWikilinks(prompt: string, filePath: string): string {
    if (!this.plugin?.noteContentService || !filePath) {
      return prompt;
    }
    return this.plugin.noteContentService.transformHeadingOnlyWikilinks(prompt, filePath);
  }

  getVersion(): number {
    return 2;
  }

  isHidden(): boolean {
    // Version 2: Command is hidden if it has triggers (triggers indicate automation, not user-visible commands)
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
