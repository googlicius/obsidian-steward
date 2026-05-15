import { z } from 'zod/v3';
import { ToolName } from 'src/solutions/commands/ToolRegistry';
import { NormalizedUserDefinedCommand, IVersionedUserDefinedCommand } from './types';
import {
  command_name,
  commandStepSchema,
  triggerConditionSchema,
  query_required,
  file_path,
  model,
} from './v1';
import { WIKI_LINK_PATTERN } from 'src/constants';

// Version 2 only fields
const system_prompt = z.array(z.string()).optional();
const tools = z.array(z.nativeEnum(ToolName)).optional();
const show_todo_list = z.boolean().optional();

const shellWhitelistEntrySchema = z
  .string()
  .min(1)
  .max(2000)
  .refine(v => v.trim() !== '*', {
    message: 'cli.whitelist entries cannot be only *',
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
 * Transform heading-only wikilinks ([[#Heading]]) to include the file path
 * @param content The content containing wikilinks
 * @param filePath The file path to use for heading-only wikilinks
 * @returns The content with transformed wikilinks
 */
function transformHeadingOnlyWikilinks(content: string, filePath: string): string {
  if (!filePath) {
    return content;
  }

  const notePath = filePath.replace(/\.md$/, '');

  // Using the full path ensures correct resolution even if multiple files have the same name
  const wikiLinkRegex = new RegExp(WIKI_LINK_PATTERN, 'g');
  return content.replace(wikiLinkRegex, (match, linkContent) => {
    // Check if this is a heading-only wikilink (starts with #)
    if (linkContent.startsWith('#')) {
      const heading = linkContent.substring(1); // Remove the leading #
      return `[[${notePath}#${heading}]]`;
    }
    return match; // Return unchanged if not a heading-only wikilink
  });
}

/**
 * Version 2 Schema - Uses 'steps' field instead of 'commands', no 'hidden' field
 */
export const userDefinedCommandV2Schema = z.object({
  version: z.literal(2).optional(),
  command_name,
  description: z.string().optional(),
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

    // Transform heading-only wikilinks in root-level system_prompt
    const transformedSystemPrompt = this.data.system_prompt?.map(prompt =>
      transformHeadingOnlyWikilinks(prompt, filePath)
    );

    // Transform heading-only wikilinks in step-level system_prompt
    const transformedSteps = this.data.steps.map(step => {
      if (step.system_prompt) {
        return {
          ...step,
          system_prompt: step.system_prompt.map(prompt =>
            transformHeadingOnlyWikilinks(prompt, filePath)
          ),
        };
      }
      return step;
    });

    return {
      command_name: this.data.command_name,
      description: this.data.description,
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

  constructor(private readonly data: UserDefinedCommandV2Data) {}

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
