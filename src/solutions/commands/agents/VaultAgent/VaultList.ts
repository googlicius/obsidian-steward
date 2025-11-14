import { tool } from 'ai';
import { z } from 'zod';
import { getTranslation } from 'src/i18n';
import type VaultAgent from './VaultAgent';
import { ToolInvocation } from '../../tools/types';
import { AgentHandlerParams, AgentResult, IntentResultStatus } from '../../types';
import { SearchOperationV2 } from '../../handlers/SearchCommandHandler/zSchemas';

const listToolSchema = z.object({
  folderPath: z
    .string()
    .describe('The folder path to list files from. Specify / to lists from the root.'),
  explanation: z.string().describe('A brief explanation of why listing files is necessary.'),
});

export type ListToolArgs = z.infer<typeof listToolSchema>;

export class VaultList {
  protected static readonly listTool = tool({
    parameters: listToolSchema,
  });

  constructor(private readonly agent: VaultAgent) {}

  public static getListTool() {
    return VaultList.listTool;
  }

  public async handle(
    params: AgentHandlerParams,
    options: { toolCall: ToolInvocation<unknown, ListToolArgs> }
  ): Promise<AgentResult> {
    const { title, lang, handlerId } = params;
    const { toolCall } = options;

    if (!handlerId) {
      throw new Error('VaultList.handle invoked without handlerId');
    }

    await this.agent.renderer.updateConversationNote({
      path: title,
      newContent: toolCall.args.explanation,
      agent: 'vault',
      command: 'vault_list',
      includeHistory: false,
      lang,
      handlerId,
    });

    const result = await this.executeListTool(toolCall.args, lang);

    const listMessageId = await this.agent.renderer.updateConversationNote({
      path: title,
      newContent: `${result}`,
      agent: 'vault',
      command: 'vault_list',
      lang,
      handlerId,
      includeHistory: false,
    });

    await this.serializeListInvocation({
      title,
      handlerId,
      toolCall,
      result: listMessageId ? `messageRef:${listMessageId}` : result,
    });

    return {
      status: IntentResultStatus.SUCCESS,
    };
  }

  private async executeListTool(
    args: ListToolArgs,
    lang: string | null | undefined
  ): Promise<string> {
    const folderPath = (args.folderPath || '').trim();
    const t = getTranslation(lang);

    // Determine folder path for search - use "^/$" for root folder
    const searchFolderPath = !folderPath || folderPath === '/' ? '^/$' : folderPath;

    // Build search operation with only folder criteria
    const operations: SearchOperationV2[] = [
      {
        folders: [searchFolderPath],
        keywords: [],
        filenames: [],
        properties: [],
      },
    ];

    // Execute search using search service
    const queryResult = await this.agent.plugin.searchService.searchV3(operations);
    const results = queryResult.conditionResults;

    if (results.length === 0) {
      const messageKey = folderPath ? 'list.noFilesFoundInFolder' : 'list.noFilesFound';
      return t(messageKey, { folder: folderPath });
    }

    const fileLinks: string[] = [];
    const maxFilesToShow = 20;
    for (let index = 0; index < results.length && index < maxFilesToShow; index += 1) {
      const result = results[index];
      fileLinks.push(`- [[${result.document.path}]]`);
    }

    const moreCount = results.length > maxFilesToShow ? results.length - maxFilesToShow : 0;

    const headerKey = folderPath ? 'list.foundFilesInFolder' : 'list.foundFiles';
    let response = `${t(headerKey, {
      count: results.length,
      folder: folderPath,
    })}:\n\n${fileLinks.join('\n')}`;

    if (moreCount > 0) {
      response += `\n\n${t('list.moreFiles', { count: moreCount })}`;
    }

    return response;
  }

  private async serializeListInvocation(params: {
    title: string;
    handlerId: string;
    toolCall: ToolInvocation<unknown, ListToolArgs>;
    result: string;
  }): Promise<void> {
    const { title, handlerId, toolCall, result } = params;

    await this.agent.renderer.serializeToolInvocation({
      path: title,
      agent: 'vault',
      command: 'vault_list',
      handlerId,
      toolInvocations: [
        {
          ...toolCall,
          result,
        },
      ],
    });
  }
}
