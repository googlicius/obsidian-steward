import { normalizePath } from 'obsidian';
import { getBundledLib } from 'src/utils/bundledLibs';
import { z } from 'zod/v3';
import type { AgentHandlerContext } from '../AgentHandlerContext';
import type { HandlerInvocationContext } from '../HandlerInvocationContext';
import { ToolCallPart } from '../../tools/types';
import { AgentResult, IntentResultStatus } from '../../types';
import { removeUndefined } from 'src/utils/removeUndefined';
import type { PathExistenceResult } from 'src/services/VaultService/VaultService';

const existsPathSchema = z.string().transform(value => {
  const normalizedPath = normalizePath(value.trim());
  if (normalizedPath === '/') {
    return normalizedPath;
  }

  return normalizedPath.replace(/\/$/, '');
});

export const existsSchema = z.object({
  paths: z
    .array(existsPathSchema)
    .min(1)
    .describe(
      'Array of paths to check for existence. Can be paths or bare names which resolves against the working directory.'
    ),
});

export type ExistsToolArgs = z.infer<typeof existsSchema>;

export type { PathExistenceResult };

export type ExistsOutput = {
  paths: PathExistenceResult[];
};

export class VaultExists {
  constructor(private readonly agent: AgentHandlerContext) {}

  public static async getExistsTool() {
    const { tool } = await getBundledLib('ai');
    return tool({
      inputSchema: existsSchema,
    });
  }

  public extractPathsForGuardrails(input: ExistsToolArgs): string[] {
    const paths: string[] = [];
    for (const path of input.paths) {
      paths.push(normalizePath(path));
    }
    return paths;
  }

  public async handle(
    ctx: HandlerInvocationContext,
    options: { toolCall: ToolCallPart<ExistsToolArgs> }
  ): Promise<AgentResult> {
    const { toolCall } = options;

    const result = await this.executeExists(toolCall.input);

    await this.agent.renderer.serializeToolInvocation({
      path: ctx.title,
      command: 'vault_exists',
      handlerId: ctx.handlerId,
      step: ctx.step,
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

  private async executeExists(input: ExistsToolArgs): Promise<ExistsOutput> {
    const pathResults: Omit<PathExistenceResult, 'abstractFile'>[] = [];

    const vaultService = this.agent.plugin.vaultService;

    for (const path of input.paths) {
      const resolvedPaths = await vaultService.resolvePathExistence(path);
      pathResults.push({
        exists: resolvedPaths.exists,
        path: resolvedPaths.path,
        type: resolvedPaths.type,
      });
    }

    return {
      paths: pathResults,
    };
  }
}
