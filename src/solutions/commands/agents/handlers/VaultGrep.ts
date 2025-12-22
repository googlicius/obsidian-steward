import { type SuperAgent } from '../SuperAgent';
import { ToolCallPart } from '../../tools/types';
import { AgentHandlerParams, AgentResult, IntentResultStatus } from '../../types';
import { execute, grepTool, GrepArgs } from '../../tools/grep';

export type GrepToolArgs = GrepArgs;

export class VaultGrep {
  constructor(private readonly agent: SuperAgent) {}

  public static getGrepTool() {
    return grepTool;
  }

  public async handle(
    params: AgentHandlerParams,
    options: { toolCall: ToolCallPart<GrepToolArgs> }
  ): Promise<AgentResult> {
    const { title, lang, handlerId } = params;
    const { toolCall } = options;

    if (!handlerId) {
      throw new Error('VaultGrep.handle invoked without handlerId');
    }

    if (toolCall.input.explanation) {
      await this.agent.renderer.updateConversationNote({
        path: title,
        newContent: toolCall.input.explanation,
        command: 'vault_grep',
        includeHistory: false,
        lang,
        handlerId,
      });
    }

    const result = await execute(toolCall.input, this.agent.plugin);

    await this.agent.renderer.serializeToolInvocation({
      path: title,
      command: 'vault_grep',
      handlerId,
      toolInvocations: [
        {
          ...toolCall,
          type: 'tool-result',
          output: {
            type: 'json',
            value: JSON.stringify(result),
          },
        },
      ],
    });

    return {
      status: IntentResultStatus.SUCCESS,
    };
  }
}
