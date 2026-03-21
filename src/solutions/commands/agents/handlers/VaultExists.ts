import { tool } from 'ai';
import { normalizePath, TFile, TFolder } from 'obsidian';
import { z } from 'zod/v3';
import type { AgentHandlerContext } from '../AgentHandlerContext';
import { ToolCallPart } from '../../tools/types';
import { AgentHandlerParams, AgentResult, IntentResultStatus } from '../../types';
import { removeUndefined } from 'src/utils/removeUndefined';

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

export type PathExistenceResult = {
  path: string;
  exists: boolean;
  type: 'file' | 'folder' | null;
};

export type ExistsOutput = {
  paths: PathExistenceResult[];
};

export class VaultExists {
  private static readonly existsTool = tool({
    inputSchema: existsSchema,
  });

  constructor(private readonly agent: AgentHandlerContext) {}

  public static getExistsTool() {
    return VaultExists.existsTool;
  }

  public extractPathsForGuardrails(input: ExistsToolArgs): string[] {
    const paths: string[] = [];
    for (const path of input.paths) {
      paths.push(normalizePath(path));
    }
    return paths;
  }

  public async handle(
    params: AgentHandlerParams,
    options: { toolCall: ToolCallPart<ExistsToolArgs> }
  ): Promise<AgentResult> {
    const { toolCall } = options;

    if (!params.handlerId) {
      throw new Error('VaultExists.handle invoked without handlerId');
    }

    const result = await this.executeExists(toolCall.input);

    await this.agent.renderer.serializeToolInvocation({
      path: params.title,
      command: 'vault_exists',
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

  private async executeExists(input: ExistsToolArgs): Promise<ExistsOutput> {
    const pathResults: PathExistenceResult[] = [];

    for (const path of input.paths) {
      const abstractFile =
        this.agent.plugin.app.vault.getAbstractFileByPath(path) ||
        (await this.agent.plugin.mediaTools.findFileByNameOrPath(path));

      if (!abstractFile) {
        pathResults.push({
          path,
          exists: false,
          type: null,
        });
        continue;
      }

      pathResults.push({
        path: abstractFile.path,
        exists: true,
        type:
          abstractFile instanceof TFile
            ? 'file'
            : abstractFile instanceof TFolder
              ? 'folder'
              : null,
      });
    }

    return {
      paths: pathResults,
    };
  }
}
