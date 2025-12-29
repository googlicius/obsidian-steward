import { type SuperAgent } from '../SuperAgent';
import { ToolCallPart } from '../../tools/types';
import { AgentHandlerParams, AgentResult, IntentResultStatus } from '../../types';
import { execute, grepTool, GrepArgs } from '../../tools/grep';
import { removeUndefined } from 'src/utils/removeUndefined';

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
    const { toolCall } = options;

    if (!params.handlerId) {
      throw new Error('VaultGrep.handle invoked without handlerId');
    }

    const result = await execute(toolCall.input, this.agent.plugin);

    await this.agent.renderer.serializeToolInvocation({
      path: params.title,
      command: 'vault_grep',
      handlerId: params.handlerId,
      step: params.invocationCount,
      toolInvocations: [
        {
          ...toolCall,
          type: 'tool-result',
          output: {
            type: 'json',
            value: removeUndefined(result),
          },
        },
      ],
    });

    return {
      status: IntentResultStatus.SUCCESS,
    };
  }
}
