import type { TextPart, FilePart, ImagePart } from 'ai';
import { logger } from 'src/utils/logger';
import { ToolCallPart, ToolResultPart } from 'src/solutions/commands/tools/types';
import { ReadContentArtifactImpl } from 'src/solutions/artifact';
import { removeUndefined } from 'src/utils/removeUndefined';
import type { ConversationMessage } from 'src/types/types';
import type { ConversationRenderer } from '../ConversationRenderer';

type ToolSerializationHost = Pick<
  ConversationRenderer,
  'plugin' | 'getConversationFileByName' | 'buildMessageMetadata' | 'getMessageById'
>;

export class ToolSerialization {
  /**
   * Serialize tool calls to a conversation note.
   * The result could be inlined or referenced to a message or an artifact.
   * @returns The message ID for referencing
   */
  public async serializeToolInvocation(
    this: ToolSerializationHost,
    params: {
      path: string;
      command?: string;
      agent?: string;
      text?: string;
      handlerId?: string;
      step?: number;
      toolInvocations: (ToolCallPart | ToolResultPart)[];
    }
  ): Promise<string | undefined> {
    try {
      const file = this.getConversationFileByName(params.path);

      const { messageId, comment } = await this.buildMessageMetadata(params.path, {
        role: 'Assistant',
        command: params.command,
        agent: params.agent,
        type: 'tool-invocation',
        handlerId: params.handlerId,
        step: params.step,
      });

      await this.plugin.app.vault.process(file, currentContent => {
        let contentToAdd = params.text ? `${params.text}\n` : '';

        contentToAdd += `\`\`\`stw-artifact\n${JSON.stringify(params.toolInvocations)}\n\`\`\``;
        return `${currentContent}\n\n${comment}\n${contentToAdd}`;
      });

      return messageId;
    } catch (error: unknown) {
      logger.error('Error serializing tool call:', error);
      return undefined;
    }
  }

  /**
   * Deserialize tool calls from a message
   */
  public async deserializeToolInvocations(
    this: ToolSerializationHost,
    params: {
      message: ConversationMessage;
      conversationTitle: string;
    }
  ): Promise<Array<ToolCallPart | ToolResultPart | FilePart | ImagePart | TextPart> | null> {
    const toolInvocationsMatches = params.message.content.match(
      /```stw-artifact\n([\s\S]*?)\n```/g
    );
    if (!toolInvocationsMatches || toolInvocationsMatches.length === 0) {
      logger.error('No stw-artifact blocks found in message content');
      return null;
    }

    const toolInvocations: Array<ToolCallPart | ToolResultPart | FilePart | ImagePart | TextPart> =
      [];

    const resolveToolInvocation = async (
      type: 'tool-call' | 'tool-result',
      toolInvocation: ReturnType<typeof JSON.parse>
    ): Promise<Array<ToolCallPart | ToolResultPart | FilePart | ImagePart | TextPart>> => {
      switch (type) {
        case 'tool-call': {
          const input = toolInvocation.input ?? toolInvocation.args;
          return [
            {
              type,
              toolName: toolInvocation.toolName,
              toolCallId: toolInvocation.toolCallId,
              input,
            },
          ];
        }

        case 'tool-result':
        default: {
          const output = toolInvocation.output ?? toolInvocation.result;
          const additionalParts: Array<TextPart | FilePart | ImagePart> = [];

          let resolvedOutput: ToolResultPart['output'] =
            typeof output === 'string'
              ? {
                  type: 'text',
                  value: output,
                }
              : output;

          if (
            resolvedOutput.type !== 'execution-denied' &&
            typeof resolvedOutput.value === 'string'
          ) {
            if (resolvedOutput.value.startsWith('artifactRef:')) {
              const artifactId = resolvedOutput.value.substring('artifactRef:'.length);
              const artifact = await this.plugin.artifactManagerV2
                .withTitle(params.conversationTitle)
                .getArtifactById(artifactId);
              if (artifact) {
                if (artifact.deleteReason) {
                  resolvedOutput = {
                    type: 'json',
                    value: removeUndefined({
                      id: artifact.id,
                      artifactType: artifact.artifactType,
                      deleteReason: artifact.deleteReason,
                      status: 'deleted',
                    }),
                  };
                } else {
                  resolvedOutput = {
                    type: 'json',
                    value: removeUndefined(artifact),
                  };

                  if (
                    artifact instanceof ReadContentArtifactImpl &&
                    artifact.imagePaths &&
                    artifact.imagePaths.length > 0
                  ) {
                    const imageParts = await this.plugin.userMessageService.getImagePartsFromPaths(
                      artifact.imagePaths
                    );
                    for (const [path, imagePart] of imageParts) {
                      additionalParts.push({ type: 'text', text: path }, imagePart);
                    }
                  }
                }
              } else {
                logger.error(`Artifact not found: ${artifactId}`);
                resolvedOutput = {
                  type: 'error-text',
                  value: `Artifact not found: ${artifactId}`,
                };
              }
            } else if (resolvedOutput.value.startsWith('messageRef:')) {
              const messageId = resolvedOutput.value.substring('messageRef:'.length);
              const referencedMessage = await this.getMessageById(
                params.conversationTitle,
                messageId,
                true
              );
              if (referencedMessage) {
                resolvedOutput = {
                  type: 'text',
                  value: referencedMessage.content,
                };
              } else {
                logger.error(`Message not found: ${messageId}`);
                resolvedOutput = {
                  type: 'error-text',
                  value: `Message not found: ${messageId}`,
                };
              }
            }
          }

          return [
            {
              type,
              toolName: toolInvocation.toolName,
              toolCallId: toolInvocation.toolCallId,
              output: resolvedOutput,
            },
            ...additionalParts,
          ];
        }
      }
    };

    for (const toolInvocationsMatch of toolInvocationsMatches) {
      const toolInvocationData = JSON.parse(
        toolInvocationsMatch.replace(/```stw-artifact\n|\n```/g, '')
      );

      if (!Array.isArray(toolInvocationData)) {
        logger.error('Tool invocation data should be an array', toolInvocationData);
        continue;
      }

      for (const toolInvocation of toolInvocationData) {
        const { toolName, toolCallId, type } = toolInvocation;

        if (!toolName || !toolCallId || !type) {
          logger.error('Invalid tool call data structure', toolInvocation);
          continue;
        }

        if (type === 'tool-call') {
          toolInvocations.push(...(await resolveToolInvocation('tool-call', toolInvocation)));
          if (toolInvocation.output || toolInvocation.result) {
            toolInvocations.push(...(await resolveToolInvocation('tool-result', toolInvocation)));
          }
        } else {
          if (toolInvocation.input) {
            toolInvocations.push(...(await resolveToolInvocation('tool-call', toolInvocation)));
          }
          toolInvocations.push(...(await resolveToolInvocation('tool-result', toolInvocation)));
        }
      }
    }

    return toolInvocations.length > 0 ? toolInvocations : null;
  }

  /**
   * Extracts tool names from a tool-invocation message content (sync, no artifact resolution).
   * Used for filtering groups by compactability before full deserialization.
   */
  public extractToolNamesFromToolInvocation(content: string): string[] {
    const matches = content.match(/```stw-artifact\n([\s\S]*?)\n```/g);
    if (!matches?.length) return [];

    const names: string[] = [];
    for (const match of matches) {
      try {
        const jsonStr = match.replace(/```stw-artifact\n|\n```/g, '');
        const data = JSON.parse(jsonStr);
        if (!Array.isArray(data)) continue;
        for (const item of data) {
          if (item?.toolName && typeof item.toolName === 'string') {
            names.push(item.toolName);
          }
        }
      } catch {
        // Skip malformed blocks
      }
    }
    return names;
  }
}
