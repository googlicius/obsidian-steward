import type VaultAgent from './VaultAgent';
import { ToolInvocation } from '../../tools/types';
import { AgentHandlerParams, AgentResult, IntentResultStatus } from '../../types';
import { execute, grepTool, GrepArgs } from '../../tools/grep';

export type GrepToolArgs = GrepArgs;

export class VaultGrep {
  constructor(private readonly agent: VaultAgent) {}

  public static getGrepTool() {
    return grepTool;
  }

  public async handle(
    params: AgentHandlerParams,
    options: { toolCall: ToolInvocation<unknown, GrepToolArgs> }
  ): Promise<AgentResult> {
    const { title, lang, handlerId } = params;
    const { toolCall } = options;

    if (!handlerId) {
      throw new Error('VaultGrep.handle invoked without handlerId');
    }

    if (toolCall.args.explanation) {
      await this.agent.renderer.updateConversationNote({
        path: title,
        newContent: toolCall.args.explanation,
        agent: 'vault',
        command: 'vault_grep',
        includeHistory: false,
        lang,
        handlerId,
      });
    }

    const result = await execute(toolCall.args, this.agent.plugin);

    await this.agent.renderer.serializeToolInvocation({
      path: title,
      agent: 'vault',
      command: 'vault_grep',
      handlerId,
      toolInvocations: [
        {
          ...toolCall,
          result,
        },
      ],
    });

    return {
      status: IntentResultStatus.SUCCESS,
    };
  }
}
