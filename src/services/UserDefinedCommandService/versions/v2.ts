import { z } from 'zod/v3';
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
const use_tool = z.boolean().optional();

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

  // Extract note name from file path (remove extension and get basename)
  // Handle both "Folder/NoteName.md" and "NoteName.md" formats
  const pathParts = filePath.split('/');
  const fileName = pathParts[pathParts.length - 1];
  const noteName = fileName.replace(/\.md$/, '');

  // Replace [[#Heading]] with [[noteName#Heading]]
  // Using just the note name (without folder) is standard for Obsidian wikilinks
  const wikiLinkRegex = new RegExp(WIKI_LINK_PATTERN, 'g');
  return content.replace(wikiLinkRegex, (match, linkContent) => {
    // Check if this is a heading-only wikilink (starts with #)
    if (linkContent.startsWith('#')) {
      const heading = linkContent.substring(1); // Remove the leading #
      return `[[${noteName}#${heading}]]`;
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
  query_required,
  steps: z.array(commandStepSchema).min(1, 'At least one step is required'),
  file_path,
  model,
  system_prompt,
  use_tool,
  triggers: z.array(triggerConditionSchema).optional(),
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
      query_required: this.data.query_required,
      steps: transformedSteps,
      file_path: filePath,
      model: this.data.model,
      system_prompt: transformedSystemPrompt,
      use_tool: this.data.use_tool,
      triggers: this.data.triggers,
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
