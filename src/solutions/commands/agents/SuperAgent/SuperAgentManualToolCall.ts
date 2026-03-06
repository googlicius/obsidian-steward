import { ToolCallPart } from '../../tools/types';
import { ArtifactType } from 'src/solutions/artifact';
import { getTranslation } from 'src/i18n';
import { uniqueID } from 'src/utils/uniqueID';
import { ToolName } from '../../ToolRegistry';
import { parseStepProcessedQuery } from './stepProcessedQuery';
import { CommandSyntaxParser } from '../../command-syntax-parser';
import { getQuotedQuery } from 'src/utils/getQuotedQuery';
import * as handlers from '../handlers';
import type { SuperAgent } from '../SuperAgent';

function asSuperAgent(instance: SuperAgentManualToolCall): SuperAgent {
  return instance as unknown as SuperAgent;
}

/**
 * Mixin providing client-made tool call logic without AI
 */
export class SuperAgentManualToolCall {
  /**
   * Client-made tool call without AI
   */
  protected async manualToolCall(params: {
    title: string;
    query: string;
    activeTools: ToolName[];
    classifiedTasks: string[];
    lang?: string | null;
    /**
     * When set, indicates how the task was classified (static/prefixed/clustered).
     * For build_search_index, manual tool call (index everything) is only used when matchType is 'static'.
     */
    classificationMatchType?: 'static' | 'prefixed' | 'clustered';
  }): Promise<ToolCallPart | undefined> {
    const agent = asSuperAgent(this);
    const { title, query, activeTools, classifiedTasks, lang, classificationMatchType } = params;

    // Client-handled step: command syntax was processed locally, update todo list and move to next step
    const originalQuery = parseStepProcessedQuery(query);
    const isCommandSyntaxStepProcessed =
      originalQuery !== null && CommandSyntaxParser.isCommandSyntax(originalQuery);

    if (isCommandSyntaxStepProcessed && activeTools.includes(ToolName.TODO_LIST_UPDATE)) {
      const todoListUpdateToolCall = await this.craftTodoListUpdateToolCallManually(title);

      if (todoListUpdateToolCall) {
        return todoListUpdateToolCall;
      }
    }

    // Return undefined if there are multiple classified tasks
    if (classifiedTasks.length !== 1) {
      return undefined;
    }

    const task = classifiedTasks[0];
    const t = getTranslation(lang);

    switch (task) {
      case 'vault': {
        // Handle DELETE tool manual calls (vault task)
        if (activeTools.length === 1 && activeTools.includes(ToolName.DELETE)) {
          const artifact = await agent.plugin.artifactManagerV2
            .withTitle(title)
            .getMostRecentArtifactOfTypes([
              ArtifactType.SEARCH_RESULTS,
              ArtifactType.CREATED_NOTES,
              ArtifactType.LIST_RESULTS,
            ]);

          if (artifact) {
            return {
              type: 'tool-call',
              toolName: ToolName.DELETE,
              toolCallId: `manual-tool-call-${uniqueID()}`,
              input: {
                operations: [
                  {
                    mode: 'artifactId',
                    artifactId: artifact.id,
                  },
                ],
              },
            } as ToolCallPart<handlers.DeleteToolArgs>;
          }
        }
        return undefined;
      }

      case 'revert': {
        // Handle revert tool manual calls for static cluster: revert
        if (classificationMatchType === 'static') {
          // Get the most recent artifact from types created by VaultAgent
          const artifactTypes = [
            ArtifactType.MOVE_RESULTS,
            ArtifactType.CREATED_NOTES,
            ArtifactType.DELETED_FILES,
            ArtifactType.UPDATE_FRONTMATTER_RESULTS,
            ArtifactType.RENAME_RESULTS,
            ArtifactType.EDIT_RESULTS,
          ];

          const artifact = await agent.plugin.artifactManagerV2
            .withTitle(title)
            .getMostRecentArtifactOfTypes(artifactTypes);

          if (artifact?.id) {
            // Map artifact type to the appropriate revert tool
            const artifactTypeToToolMap: Partial<Record<ArtifactType, ToolName>> = {
              [ArtifactType.MOVE_RESULTS]: ToolName.REVERT_MOVE,
              [ArtifactType.CREATED_NOTES]: ToolName.REVERT_CREATE,
              [ArtifactType.DELETED_FILES]: ToolName.REVERT_DELETE,
              [ArtifactType.UPDATE_FRONTMATTER_RESULTS]: ToolName.REVERT_FRONTMATTER,
              [ArtifactType.RENAME_RESULTS]: ToolName.REVERT_RENAME,
              [ArtifactType.EDIT_RESULTS]: ToolName.REVERT_EDIT_RESULTS,
            };

            const toolName = artifactTypeToToolMap[artifact.artifactType];
            if (toolName) {
              return {
                type: 'tool-call',
                toolName,
                toolCallId: `manual-tool-call-${uniqueID()}`,
                input: {
                  artifactId: artifact.id,
                  explanation: t('revert.revertingArtifact', {
                    artifactType: artifact.artifactType,
                  }),
                },
              };
            }
          }
        }
        return undefined;
      }

      case 'help': {
        return {
          type: 'tool-call',
          toolName: ToolName.HELP,
          toolCallId: `manual-tool-call-${uniqueID()}`,
          input: {},
        };
      }

      case 'user_confirm': {
        return {
          type: 'tool-call',
          toolName: ToolName.USER_CONFIRM,
          toolCallId: `manual-tool-call-${uniqueID()}`,
          input: {},
        };
      }

      case 'stop': {
        return {
          type: 'tool-call',
          toolName: ToolName.STOP,
          toolCallId: `manual-tool-call-${uniqueID()}`,
          input: {},
        };
      }

      case 'thank_you': {
        return {
          type: 'tool-call',
          toolName: ToolName.THANK_YOU,
          toolCallId: `manual-tool-call-${uniqueID()}`,
          input: {},
        };
      }

      case 'more': {
        // Handle search_more tool manual calls
        return {
          type: 'tool-call',
          toolName: ToolName.SEARCH_MORE,
          toolCallId: `manual-tool-call-${uniqueID()}`,
          input: {},
        };
      }

      case 'build_search_index': {
        // Only use manual tool call (index everything) when static cluster matched.
        // Clustered match may indicate user wants specific folders (e.g. "index my files in Projects").
        if (classificationMatchType !== 'static') {
          return undefined;
        }
        return {
          type: 'tool-call',
          toolName: ToolName.BUILD_SEARCH_INDEX,
          toolCallId: `manual-tool-call-${uniqueID()}`,
          input: {},
        };
      }

      case 'search': {
        // Handle search tool manual calls
        const extraction = agent.search.extractSearchQueryWithoutLLM({
          query,
          searchSettings: agent.plugin.settings.search,
          lang,
        });

        if (extraction) {
          return {
            type: 'tool-call',
            toolName: ToolName.SEARCH,
            toolCallId: `manual-tool-call-${uniqueID()}`,
            input: {
              operations: extraction.operations,
              explanation: extraction.explanation,
              lang: extraction.lang,
              confidence: extraction.confidence,
            },
          };
        }
        return undefined;
      }

      case 'speech': {
        // Handle speech tool manual calls
        const quotedText = getQuotedQuery(query);
        if (quotedText) {
          return {
            type: 'tool-call',
            toolName: ToolName.SPEECH,
            toolCallId: `manual-tool-call-${uniqueID()}`,
            input: {
              text: quotedText,
              explanation: `Generating audio with: "${quotedText}"`,
              confidence: 1,
            },
          };
        }
        return undefined;
      }

      default:
        return undefined;
    }
  }

  protected async craftTodoListUpdateToolCallManually(title: string): Promise<ToolCallPart | null> {
    const agent = asSuperAgent(this);
    const todoListState = await agent.renderer.getConversationProperty<handlers.TodoListState>(
      title,
      'todo_list'
    );
    const steps = todoListState?.steps;
    const stepCount = steps?.length ?? 0;
    if (stepCount === 0 || !todoListState) {
      return null;
    }
    return {
      type: 'tool-call',
      toolName: ToolName.TODO_LIST_UPDATE,
      toolCallId: `manual-tool-call-${uniqueID()}`,
      input: {
        status: 'completed',
        nextStep: Math.min(todoListState.currentStep + 1, stepCount),
      },
    };
  }
}
