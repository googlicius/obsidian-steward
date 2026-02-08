import { tool } from 'ai';
import { z } from 'zod/v3';
import { AgentHandlerParams, AgentResult, IntentResultStatus } from '../../types';
import { ToolCallPart } from '../../tools/types';
import { joinWithConjunction } from 'src/utils/arrayUtils';
import { getTranslation } from 'src/i18n';
import { userLanguagePrompt } from 'src/lib/modelfusion/prompts/languagePrompt';
import type { ConversationRenderer } from 'src/services/ConversationRenderer';
import type { SkillService } from 'src/services/SkillService';
import { removeUndefined } from 'src/utils/removeUndefined';

const useSkillsSchema = z.object({
  skills: z
    .array(z.string())
    .describe('List of skill names to activate for the current conversation.'),
  lang: z
    .string()
    .nullable()
    .optional()
    .describe(userLanguagePrompt.content as string),
});

export type UseSkillsArgs = z.infer<typeof useSkillsSchema>;

/**
 * Result type for use_skills execution
 */
export interface UseSkillsResult {
  message: string;
  activatedSkills?: string[];
  invalidSkills?: string[];
}

/**
 * Handles the USE_SKILLS tool logic.
 * Activates skills by persisting them in conversation frontmatter.
 * Skill content is injected into the system prompt on subsequent LLM turns.
 */
export class UseSkills {
  private static readonly useSkillsTool = tool({
    inputSchema: useSkillsSchema,
  });

  constructor(
    private readonly renderer: ConversationRenderer,
    private readonly skillService: SkillService
  ) {}

  public static getUseSkillsTool() {
    return UseSkills.useSkillsTool;
  }

  /**
   * Process a USE_SKILLS tool call
   */
  public async handle(
    params: AgentHandlerParams,
    options: {
      toolCall: ToolCallPart<UseSkillsArgs>;
      activeSkills: string[];
    }
  ): Promise<AgentResult> {
    const { title, lang, handlerId } = params;
    const { toolCall, activeSkills } = options;
    const t = getTranslation(lang);

    if (!handlerId) {
      throw new Error('UseSkills.handle invoked without handlerId');
    }

    const requestedSkills = toolCall.input.skills || [];

    // Validate requested skills against available skills
    const availableSkillNames = new Set(this.skillService.getSkillNames());
    const alreadyActiveSet = new Set(activeSkills);

    const activatedSkills: string[] = [];
    const invalidSkills: string[] = [];

    for (const skillName of requestedSkills) {
      if (!availableSkillNames.has(skillName)) {
        invalidSkills.push(skillName);
      } else if (!alreadyActiveSet.has(skillName)) {
        activatedSkills.push(skillName);
        activeSkills.push(skillName);
      }
      // If already active, silently skip (not an error)
    }

    // Save active skills to frontmatter for persistence
    if (activatedSkills.length > 0) {
      await this.renderer.updateConversationFrontmatter(title, [
        {
          name: 'skills',
          value: activeSkills,
        },
      ]);
    }

    // Build status message
    const statusParts: string[] = [];
    if (activatedSkills.length > 0) {
      const skillNames = activatedSkills.map(s => `\`${s}\``);
      statusParts.push(
        t('useSkills.activating', { skills: joinWithConjunction(skillNames, 'and') })
      );
    }
    const statusMessage = statusParts.length > 0 ? statusParts.join('. ') + '.' : '';

    if (statusMessage) {
      await this.renderer.updateConversationNote({
        path: title,
        newContent: `*${statusMessage}*`,
        command: 'use-skills',
        includeHistory: false,
        lang,
        handlerId,
        step: params.invocationCount,
      });
    }

    // Build error text for invalid skills
    const errorParts: string[] = [];
    if (invalidSkills.length > 0) {
      errorParts.push(
        t('useSkills.invalidSkills', {
          skills: joinWithConjunction(
            invalidSkills.map(s => `\`${s}\``),
            'and'
          ),
        })
      );
    }

    // Build result
    const messages: string[] = [];
    if (activatedSkills.length > 0) {
      messages.push(`Activated: ${joinWithConjunction(activatedSkills, 'and')}.`);
    }
    if (invalidSkills.length > 0) {
      messages.push(
        `Cannot activate ${joinWithConjunction(invalidSkills, 'and')} (not available).`
      );
    }
    if (messages.length === 0) {
      messages.push('No skills to activate.');
    }

    const result = removeUndefined({
      message: messages.join(' '),
      activatedSkills: activatedSkills.length > 0 ? activatedSkills : undefined,
      invalidSkills: invalidSkills.length > 0 ? invalidSkills : undefined,
    });

    // Serialize the tool invocation with result message
    await this.renderer.serializeToolInvocation({
      path: title,
      command: 'use-skills',
      handlerId,
      step: params.invocationCount,
      ...(errorParts.length > 0 && {
        text: `*${errorParts.join(' ')}*`,
      }),
      toolInvocations: [
        {
          ...toolCall,
          type: 'tool-result',
          output: {
            type: 'json',
            value: result,
          },
        },
      ],
    });

    return {
      status: IntentResultStatus.SUCCESS,
    };
  }
}
