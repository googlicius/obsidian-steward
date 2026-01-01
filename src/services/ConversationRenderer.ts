import { getLanguage, parseYaml, TFile } from 'obsidian';
import { uniqueID } from '../utils/uniqueID';
import { getTranslation } from '../i18n';
import { ConversationMessage, ConversationRole } from '../types/types';
import type StewardPlugin from '../main';
import { logger } from 'src/utils/logger';
import {
  SELECTED_MODEL_PATTERN,
  STW_SELECTED_PATTERN,
  STW_SELECTED_METADATA_PATTERN,
} from 'src/constants';
import { prependChunk } from 'src/utils/textStreamer';
import { ModelMessage, TextPart, FilePart, ImagePart, ReasoningOutput } from 'ai';
import { ToolCallPart, ToolResultPart } from 'src/solutions/commands/tools/types';
import { MarkdownUtil } from 'src/utils/markdownUtils';
import { ArtifactType, ReadContentArtifactImpl } from 'src/solutions/artifact';
import { removeUndefined } from 'src/utils/removeUndefined';

export class ConversationRenderer {
  static instance: ConversationRenderer;

  private constructor(private plugin: StewardPlugin) {}

  static getInstance(plugin?: StewardPlugin): ConversationRenderer {
    if (plugin) {
      ConversationRenderer.instance = new ConversationRenderer(plugin);
      return ConversationRenderer.instance;
    }
    if (!ConversationRenderer.instance) {
      throw new Error('ConversationRenderer not initialized');
    }
    return ConversationRenderer.instance;
  }

  /**
   * Extract selected model from a text using SELECTED_MODEL_PATTERN.
   * Returns in the format "provider:modelId" or null if not found.
   */
  public extractSelectedModelFromText(text: string | undefined | null): string | null {
    if (!text) return null;
    const regex = new RegExp(SELECTED_MODEL_PATTERN, 'i');
    const match = regex.exec(text);
    if (!match) return null;

    const provider = match[2];
    const modelId = match[3];
    if (!provider || !modelId) return null;
    return `${provider}:${modelId}`;
  }

  /**
   * Extract stw-selected blocks from content and create artifact if found
   */
  private async createStwSelectedArtifactIfPresent(title: string, content: string): Promise<void> {
    if (!content.includes('{{stw-selected')) {
      return;
    }

    const stwSelectedMatches = Array.from(content.matchAll(new RegExp(STW_SELECTED_PATTERN, 'g')));
    if (stwSelectedMatches.length === 0) {
      return;
    }

    const selections: Array<{
      fromLine: number;
      toLine: number;
      selection: string;
      path: string;
    }> = [];

    for (const match of stwSelectedMatches) {
      if (match[1]) {
        const stwBlock = match[1];
        const metadataMatch = stwBlock.match(new RegExp(STW_SELECTED_METADATA_PATTERN));

        if (metadataMatch) {
          const [, fromLineStr, toLineStr, escapedSelection, path] = metadataMatch;
          const fromLine = parseInt(fromLineStr, 10);
          const toLine = parseInt(toLineStr, 10);

          // Unescape the selection content
          const selection = new MarkdownUtil(escapedSelection).unescape().decodeURI().getText();

          selections.push({
            fromLine,
            toLine,
            selection,
            path,
          });
        }
      }
    }

    if (selections.length > 0) {
      await this.plugin.artifactManagerV2.withTitle(title).storeArtifact({
        artifact: {
          artifactType: ArtifactType.STW_SELECTED,
          selections,
        },
      });
    }
  }

  /**
   * Formats role text based on the showLabel parameter and showPronouns setting
   */
  private formatRoleText(role?: string, showLabel?: boolean): string {
    if (!role) {
      return '';
    }

    if (showLabel === false || !this.plugin.settings.showPronouns) {
      return '';
    }

    return `**${role}:** `;
  }

  /**
   * Gets the content after deleting a message and all messages below it
   * This is a pure function that doesn't read or modify the vault
   * @param content The full conversation content
   * @param messageId The ID of the message to delete from
   * @returns The new content with the message and below removed
   */
  private getContentAfterDeletion(content: string, messageId: string): string {
    // Find the position of the message with the given ID
    const messageCommentRegex = new RegExp(`<!--STW ID:${messageId}[^>]*-->`, 'i');
    const match = messageCommentRegex.exec(content);

    if (!match || match.index === undefined) {
      return content;
    }

    // Keep content up to the message (excluding the message itself)
    let newContent = content.substring(0, match.index).trimEnd();

    // Sanitize the content by removing trailing separators
    newContent = this.sanitizeConversationContent(newContent);

    return newContent;
  }

  public async updateTheTitle(
    title: string,
    newTitle: string,
    options?: {
      strategy: 'vaultEvent' | 'cmDispatch';
    }
  ): Promise<string> {
    const { strategy = 'cmDispatch' } = options || {};

    const folderPath = `${this.plugin.settings.stewardFolder}/Conversations`;

    // Get the current file
    const currentFile = this.plugin.app.vault.getFileByPath(`${folderPath}/${title}.md`);
    const currentNote = this.plugin.app.workspace.getActiveFile();

    if (!currentFile || !currentNote) {
      return title;
    }

    const existingFile = this.plugin.app.vault.getFileByPath(`${folderPath}/${newTitle}.md`);
    if (existingFile) {
      await this.plugin.app.fileManager.trashFile(existingFile);
    }

    await this.plugin.app.fileManager.renameFile(currentFile, `${folderPath}/${newTitle}.md`);

    const currentNoteContent = await this.plugin.app.vault.read(currentNote);
    // Automatically updated by Obsidian
    if (currentNoteContent.includes(`![[${newTitle}]]`)) {
      return newTitle;
    }

    if (strategy === 'cmDispatch') {
      const editorView = this.plugin.editor.cm;
      const { state } = editorView;
      const { doc } = state;

      try {
        const cursorPos = state.selection.main.head;
        const cursorLine = doc.lineAt(cursorPos);

        // Find the line 2 lines above the current cursor position
        const targetLineNumber = Math.max(1, cursorLine.number - 2);
        const targetLine = doc.line(targetLineNumber);

        const lineText = targetLine.text;
        const oldLinkText = `![[${folderPath}/${title}]]`;

        if (lineText.includes(oldLinkText)) {
          editorView.dispatch({
            changes: {
              from: targetLine.from,
              to: targetLine.to,
              insert: `![[${folderPath}/${newTitle}]]`,
            },
          });

          logger.log(`Updated embed link to ${newTitle}`);

          return newTitle;
        } else {
          logger.log(`No embed link found on line ${targetLineNumber} to update`);
          return title;
        }
      } catch (error) {
        logger.error('Error updating embed link with CodeMirror dispatch:', error);
        return title;
      }
    } else {
      return new Promise(resolve => {
        const eventRef = this.plugin.app.vault.on('modify', async file => {
          if (file instanceof TFile && file.path === currentNote.path) {
            // Off ref immediately
            await this.plugin.app.vault.process(file, currentContent => {
              return currentContent.replace(`${folderPath}/${title}`, `${folderPath}/${newTitle}`);
            });
            this.plugin.app.vault.offref(eventRef);
            resolve(newTitle);
          }
        });

        // Ensure the event is off
        setTimeout(() => {
          this.plugin.app.vault.offref(eventRef);
          resolve(newTitle);
        }, 3000);
      });
    }
  }

  /**
   * Serialize tool calls to a conversation note.
   * The result could be inlined or referenced to a message or an artifact.
   * @returns The message ID for referencing
   */
  public async serializeToolInvocation(params: {
    path: string;
    command?: string;
    agent?: string;
    text?: string;
    handlerId?: string;
    step?: number;
    toolInvocations: ToolResultPart[];
  }): Promise<string | undefined> {
    try {
      const folderPath = `${this.plugin.settings.stewardFolder}/Conversations`;
      const notePath = `${folderPath}/${params.path}.md`;

      // Get the file reference
      const file = this.plugin.app.vault.getFileByPath(notePath);
      if (!file) {
        throw new Error(`Note not found: ${notePath}`);
      }

      // Get message metadata
      const { messageId, comment } = await this.buildMessageMetadata(params.path, {
        role: 'Assistant',
        command: params.command,
        agent: params.agent,
        type: 'tool-invocation',
        handlerId: params.handlerId,
        step: params.step,
      });

      // Process the file content
      await this.plugin.app.vault.process(file, currentContent => {
        const indicator = this.getGeneratingIndicator(currentContent);

        // Remove the generating indicator and any trailing newlines
        currentContent = this.removeGeneratingIndicator(currentContent);

        let contentToAdd = params.text ? `${params.text}\n` : '';

        contentToAdd += `\`\`\`stw-artifact\n${JSON.stringify(params.toolInvocations)}\n\`\`\``;

        // Preserve the generating indicator if exists
        const shouldKeepIndicator = indicator && !params.text;
        if (shouldKeepIndicator) {
          contentToAdd += indicator;
        }

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
  public async deserializeToolInvocations(params: {
    message: ConversationMessage;
    conversationTitle: string;
  }): Promise<Array<ToolCallPart | ToolResultPart | FilePart | ImagePart | TextPart> | null> {
    // Extract all tool calls from the message content
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
          // Resolve the result based on its type (Backward-compatible with AI SDK v4 format)
          // let resolvedOutput: ToolResultPart['output'];
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
            // Check if it's an artifact reference
            if (resolvedOutput.value.startsWith('artifactRef:')) {
              const artifactId = resolvedOutput.value.substring('artifactRef:'.length);
              const artifact = await this.plugin.artifactManagerV2
                .withTitle(params.conversationTitle)
                .getArtifactById(artifactId);
              if (artifact) {
                // If the artifact is marked as deleted, then skip sending data, return the deleteReason instead
                if (artifact.deleteReason) {
                  resolvedOutput = {
                    type: 'json',
                    value: removeUndefined({
                      id: artifact.id,
                      artifactType: artifact.artifactType,
                      deleteReason: artifact.deleteReason,
                      status: 'deleted', // Add this field
                      // Don't send other fields of the artifact.
                    }),
                  };
                } else {
                  resolvedOutput = {
                    type: 'json',
                    value: removeUndefined(artifact),
                  };

                  // Check if artifact has imagePaths (from READ_CONTENT artifacts)
                  // Include images in the same content as the tool-result
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
                true // Exclude tool-hidden content when resolving message references
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
            // Otherwise, it's an inlined result, keep as is
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

      // Ensure toolInvocationData is an array
      if (!Array.isArray(toolInvocationData)) {
        logger.error('Tool invocation data should be an array', toolInvocationData);
        continue;
      }

      for (const toolInvocation of toolInvocationData) {
        const { toolName, toolCallId, type } = toolInvocation;

        if (!toolName || !toolCallId || !type) {
          logger.error('Invalid tool call data structure', toolInvocation);
          continue; // Skip invalid tool calls but continue processing others
        }

        if (type === 'tool-call') {
          toolInvocations.push(...(await resolveToolInvocation('tool-call', toolInvocation)));
          // In the old version, all types are tool-call, we need to handle tool-result here.
          // Check for both output (new format) and result (old format) for backward compatibility
          if (toolInvocation.output || toolInvocation.result) {
            toolInvocations.push(...(await resolveToolInvocation('tool-result', toolInvocation)));
          }
        } else {
          // In the new version, the input could be included, so handle tool-call here
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
   * Updates a conversation note with the given content
   */
  public async updateConversationNote(params: {
    path: string;
    newContent: string;
    command?: string;
    agent?: string;
    /**
     * If provided, the placeholder will be replaced with the newContent.
     */
    replacePlaceHolder?: string;
    /**
     * The content of an artifact.
     */
    artifactContent?: string;
    /**
     * The role of the message.
     * If not provided, the role will be Steward by default, but not displayed in the conversation
     */
    role?:
      | string
      | {
          name: string;
          showLabel: boolean;
        };
    /**
     * The history will be included in conversation context.
     * If not provided, the history will be included by default.
     */
    includeHistory?: boolean;
    /**
     * The language of the conversation.
     * If provided, it will be included in the conversation property.
     */
    lang?: string | null;
    /**
     * The message ID to replace. If provided, this message and all messages below it will be removed
     * before adding the new content.
     */
    messageId?: string;
    /**
     * Handler ID to group all messages issued in one handle function call.
     */
    handlerId?: string;
    /**
     * Step number for grouping messages in one invocation or one streamText function call.
     * Should be params.invocationCount + 1 when called from handlers.
     */
    step?: number;
  }): Promise<string | undefined> {
    try {
      const folderPath = `${this.plugin.settings.stewardFolder}/Conversations`;
      const notePath = `${folderPath}/${params.path}.md`;

      // Get the file reference
      const file = this.plugin.app.vault.getFileByPath(notePath);
      if (!file) {
        throw new Error(`Note not found: ${notePath}`);
      }

      const { roleName, showLabel } = (() => {
        if (typeof params.role === 'string') {
          return { roleName: params.role, showLabel: undefined };
        }
        return { roleName: params.role?.name, showLabel: params.role?.showLabel };
      })();

      // Get message metadata
      const { messageId, comment } = await this.buildMessageMetadata(params.path, {
        role: roleName ?? 'Steward',
        command: params.command,
        agent: params.agent,
        includeHistory: params.includeHistory ?? true,
        handlerId: params.handlerId,
        step: params.step,
      });

      // Update language and model properties in the frontmatter if provided
      const updatedProperties = [];
      if (params.lang) {
        updatedProperties.push({ name: 'lang', value: params.lang });
      }

      const selectedModel = this.extractSelectedModelFromText(params.newContent);
      if (selectedModel) {
        updatedProperties.push({ name: 'model', value: selectedModel });
      }

      if (updatedProperties.length > 0) {
        await this.updateConversationFrontmatter(params.path, updatedProperties);
      }

      // Process the file content
      await this.plugin.app.vault.process(file, currentContent => {
        // Remove the generating indicator and any trailing newlines
        currentContent = this.removeGeneratingIndicator(currentContent);

        let processedArtifactContent = '';
        if (params.artifactContent) {
          // Escape backticks in artifact content to prevent breaking the code block
          const escapedArtifactContent = params.artifactContent.replace(/`/g, '\\`');
          processedArtifactContent += `\n\`\`\`stw-artifact\n${escapedArtifactContent}\n\`\`\``;
        }

        // If replacePlaceHolder is provided, replace it with the newContent
        if (params.replacePlaceHolder) {
          const newContent = processedArtifactContent
            ? `${params.newContent}${processedArtifactContent}`
            : params.newContent;

          // Return the updated content immediately, no need for further processing
          return currentContent.replace(params.replacePlaceHolder, newContent);
        }

        // If messageId is provided, remove that message and all messages below it
        if (params.messageId) {
          currentContent = this.getContentAfterDeletion(currentContent, params.messageId);
        }

        // Prepare the content to be added
        let contentToAdd = '';

        if (params.role === 'User') {
          currentContent = `${currentContent}\n\n---`;
          // Format user message as a callout
          contentToAdd = this.plugin.noteContentService.formatCallout(
            `${this.formatRoleText(params.role, showLabel)}${params.newContent}`,
            'stw-user-message',
            { id: messageId }
          );
        } else {
          // For Steward or System messages, use the regular format
          const roleText = this.formatRoleText(roleName, showLabel);
          contentToAdd = `${roleText}${params.newContent}`;
        }

        // Add hidden content after visible content if provided
        if (processedArtifactContent) {
          contentToAdd += processedArtifactContent;
        }

        // Return the updated content
        return `${currentContent}\n\n${comment}\n${contentToAdd}`;
      });

      if (roleName === 'User') {
        // Automatically create STW_SELECTED artifact if stw-selected blocks are present
        await this.createStwSelectedArtifactIfPresent(params.path, params.newContent);
      }

      return messageId;
    } catch (error) {
      logger.error('Error updating conversation note:', error);
      return undefined;
    }
  }

  /**
   * Streams content to a conversation note
   * @param params Options for streaming content
   * @returns The message ID for referencing
   */
  public async streamConversationNote(params: {
    path: string;
    stream: AsyncIterable<string>;
    role?: 'Steward';
    folderPath?: string;
    command?: string;
    position?: number;
    includeHistory?: boolean;
    handlerId?: string;
    /**
     * Step number for grouping messages in one invocation or one AI function call.
     * Should be params.invocationCount + 1 when called from handlers.
     */
    step?: number;
  }): Promise<string | undefined> {
    const folderPath = params.folderPath || `${this.plugin.settings.stewardFolder}/Conversations`;

    try {
      const path = params.path.endsWith('.md') ? params.path : `${params.path}.md`;
      const notePath = `${folderPath}/${path}`;

      // Get the current content of the note
      const file = this.plugin.app.vault.getFileByPath(notePath);
      if (!file) {
        throw new Error(`Note not found: ${notePath}`);
      }

      // Check if stream is empty by trying to get the first chunk
      const streamIterator = params.stream[Symbol.asyncIterator]();
      const firstResult = await streamIterator.next();

      // If stream is empty, return undefined without creating metadata
      if (firstResult.done) {
        return undefined;
      }

      const isReasoning = firstResult.value.includes('stw-thinking');

      // Create a stream that includes the first chunk we already retrieved
      const streamWithFirstChunk = prependChunk(firstResult.value, streamIterator);

      const { messageId, comment } = await this.buildMessageMetadata(path, {
        role: 'Steward',
        command: params.command,
        includeHistory: params.includeHistory ?? true,
        handlerId: params.handlerId,
        step: params.step,
        ...(isReasoning && {
          type: 'reasoning',
        }),
      });

      const roleText = this.formatRoleText(params.role);

      let contentToModify = '';

      // Write the initial content
      await this.plugin.app.vault.process(file, currentContent => {
        // Remove the generating indicator and any trailing newlines
        currentContent = this.removeGeneratingIndicator(currentContent);

        // Prepare the initial content with metadata
        const initialContent = `${currentContent}\n\n${comment}\n${roleText}`;

        // If position is provided, insert at that position
        // Otherwise, append to the end
        contentToModify =
          params.position !== undefined
            ? currentContent.slice(0, params.position) +
              initialContent +
              currentContent.slice(params.position)
            : initialContent;

        return contentToModify;
      });

      // Stream the content
      await this.streamFile(file, streamWithFirstChunk);

      // Return the message ID for referencing
      return messageId;
    } catch (error) {
      logger.error('Error streaming to conversation note:', error);
      return undefined;
    }
  }

  public async streamFile(file: TFile, stream: AsyncIterable<string>) {
    for await (const chunk of stream) {
      await this.plugin.app.vault.process(file, currentContent => {
        return currentContent + chunk;
      });
    }
  }

  public async buildMessageMetadata(
    title: string,
    options: {
      messageId?: string;
      role?: string;
      command?: string;
      agent?: string;
      includeHistory?: boolean;
      type?: string;
      artifactType?: ArtifactType;
      handlerId?: string;
      step?: number;
    } = {}
  ) {
    const {
      messageId = uniqueID(),
      role = 'Steward',
      command,
      agent,
      includeHistory,
      handlerId,
      step,
    } = options;

    const metadata: { [x: string]: string | number } = {
      ID: messageId,
      ROLE: role.toLowerCase(),
      ...(command && {
        COMMAND: command,
      }),
      ...(agent && {
        AGENT: agent,
      }),
      ...(options.type && {
        TYPE: options.type,
      }),
      ...(options.artifactType && {
        ARTIFACT_TYPE: options.artifactType,
      }),
      ...(includeHistory === false && {
        HISTORY: 'false',
      }),
      ...(handlerId && {
        HANDLER_ID: handlerId,
      }),
      ...(step !== undefined && {
        STEP: step,
      }),
    };

    if (command === 'more') {
      const prevMoreMetadata = await this.findMostRecentMessageMetadata({
        conversationTitle: title,
        command,
        role: 'steward',
      });
      metadata.PAGE = prevMoreMetadata ? parseInt(prevMoreMetadata.PAGE) + 1 : 2;
    }

    let metadataAsHTMLComment = '<!--STW ';

    for (const [key, value] of Object.entries(metadata)) {
      metadataAsHTMLComment += `${key}:${value},`;
    }

    // Remove trailing comma and close comment
    metadataAsHTMLComment = metadataAsHTMLComment.slice(0, -1) + '-->';

    return {
      messageId,
      comment: metadataAsHTMLComment,
    };
  }

  /**
   * Find the most recent message metadata with a specific command and role
   * @param conversationTitle The conversation title
   * @param command The command to look for
   * @param role The role to look for (user or steward)
   * @returns The message metadata, or null if not found
   */
  public async findMostRecentMessageMetadata(params: {
    conversationTitle: string;
    command?: string;
    role: string;
  }): Promise<Record<string, string> | null> {
    try {
      // Get the conversation file
      const folderPath = `${this.plugin.settings.stewardFolder}/Conversations`;
      const notePath = `${folderPath}/${params.conversationTitle}.md`;
      const file = this.plugin.app.vault.getFileByPath(notePath);

      if (!file) {
        throw new Error(`Note not found: ${notePath}`);
      }

      // Read the content
      const content = await this.plugin.app.vault.cachedRead(file);

      // Prepare the regular expression pattern
      const rolePattern = `,ROLE:${params.role.toLowerCase()}`;
      const commandPattern = params.command ? `,COMMAND:${params.command}` : '';

      // Find all matching comment blocks
      const commentBlockRegex = new RegExp(
        `<!--STW ID:(.*?)${rolePattern}${commandPattern}.*?-->`,
        'gi'
      );

      const matches = Array.from(content.matchAll(commentBlockRegex));

      // Find the most recent match
      if (matches.length > 0) {
        const lastMatch = matches[matches.length - 1];
        const fullComment = lastMatch[0];

        // Parse all metadata fields
        const metadataObject: Record<string, string> = {};
        const metadataRegex = /([A-Z]+):([^,]+)(?=,|-->)/gi;
        let metadataMatch;

        while ((metadataMatch = metadataRegex.exec(fullComment)) !== null) {
          const [, key, value] = metadataMatch;
          metadataObject[key] = value;
        }

        return metadataObject;
      }

      return null;
    } catch (error) {
      logger.error('Error finding message:', error);
      return null;
    }
  }

  /**
   * Adds a generating indicator to a conversation note
   */
  public async addGeneratingIndicator(path: string, indicatorText: string): Promise<void> {
    const folderPath = `${this.plugin.settings.stewardFolder}/Conversations`;
    const notePath = `${folderPath}/${path}.md`;
    const file = this.plugin.app.vault.getFileByPath(notePath);
    if (!file) {
      throw new Error(`Note not found: ${notePath}`);
    }

    await this.plugin.app.vault.process(file, currentContent => {
      currentContent = this.removeGeneratingIndicator(currentContent);
      return `${currentContent}\n\n*${indicatorText}*`;
    });
  }

  /**
   * Gets the generating indicator from the end of the content if it exists
   * @returns The indicator string (including leading newlines) or empty string if not found
   */
  public getGeneratingIndicator(content: string): string {
    const indicatorMatch = content.match(/(\n\n\*.*?\.\.\.\*)$/);
    return indicatorMatch ? indicatorMatch[1] : '';
  }

  /**
   * Removes the generating indicator from the content
   */
  public removeGeneratingIndicator(content: string): string {
    return content.replace(/\n\n\*.*?\.\.\.\*$/, '');
  }

  /**
   * Removes the generating indicator from the conversation note
   */
  public removeIndicator(title: string): Promise<string> {
    const folderPath = `${this.plugin.settings.stewardFolder}/Conversations`;
    const notePath = `${folderPath}/${title}.md`;
    const file = this.plugin.app.vault.getFileByPath(notePath);
    if (!file) {
      throw new Error(`Note not found: ${notePath}`);
    }

    return this.plugin.app.vault.process(file, currentContent => {
      return this.removeGeneratingIndicator(currentContent);
    });
  }

  /**
   * Creates a new conversation note
   */
  public async createConversationNote(
    title: string,
    commandType: string,
    content: string,
    language?: string
  ): Promise<void> {
    try {
      // Get the configured folder for conversations
      const folderPath = `${this.plugin.settings.stewardFolder}/Conversations`;
      const notePath = `${folderPath}/${title}.md`;

      // Check if conversations folder exists, create if not
      const folderExists = this.plugin.app.vault.getFolderByPath(folderPath);
      if (!folderExists) {
        await this.plugin.app.vault.createFolder(folderPath);
      }

      // Generate a message ID
      const messageId = uniqueID();

      // Get translation function with the appropriate language
      const t = getTranslation(language);

      // Determine model: from query if present, otherwise from settings
      const modelFromQuery = this.extractSelectedModelFromText(content);

      const properties = [
        { name: 'model', value: modelFromQuery || this.plugin.settings.llm.chat.model },
        { name: 'lang', value: language || getLanguage() },
      ];

      const activeNote = this.plugin.app.workspace.getActiveFile();

      if (activeNote && !activeNote.name.includes(this.plugin.chatTitle)) {
        properties.push({ name: 'current_note', value: activeNote.name });
      }

      // Create YAML frontmatter with model, current_note, and language
      const frontmatter = `---\n${properties.map(property => `${property.name}: ${property.value}`).join('\n')}\n---\n\n`;

      // Format user message as a callout with the role text
      const userMessage = this.plugin.noteContentService.formatCallout(
        `${this.formatRoleText('User')}/${commandType.trim()} ${content}`,
        'stw-user-message',
        { id: messageId }
      );

      // Build initial content based on command type
      let initialContent =
        frontmatter +
        `<!--STW ID:${messageId},ROLE:user,COMMAND:${commandType}-->\n${userMessage}\n\n`;

      // Handle vault command with optional tools parameter
      if (commandType.startsWith('vault')) {
        // Check if tools parameter is specified to show appropriate message
        const [, queryString] = commandType.split('?');
        if (queryString) {
          const urlParams = new URLSearchParams(queryString);
          const tools = urlParams.get('tools')?.split(',') || [];

          if (tools.includes('move')) {
            initialContent += `*${t('conversation.moving')}*`;
          } else if (tools.includes('copy')) {
            initialContent += `*${t('conversation.copying')}*`;
          } else if (tools.includes('delete')) {
            initialContent += `*${t('conversation.deleting')}*`;
          }
        }
      } else {
        switch (commandType) {
          case 'search':
            initialContent += `*${t('conversation.searching')}*`;
            break;

          case 'calc':
            initialContent += `*${t('conversation.calculating')}*`;
            break;

          case 'image':
            initialContent += `*${t('conversation.generatingImage')}*`;
            break;

          case 'audio':
          case 'speak':
            initialContent += `*${t('conversation.generatingAudio')}*`;
            break;

          case 'update':
            initialContent += `*${t('conversation.updating')}*`;
            break;

          case ' ':
          default:
            initialContent += `*${t('conversation.planning')}*`;
            break;
        }
      }

      // Remove the conversation note if exist
      const existingFile = this.plugin.app.vault.getFileByPath(notePath);
      if (existingFile) {
        await this.plugin.app.fileManager.trashFile(existingFile);
      }

      // Create the conversation note
      await this.plugin.app.vault.create(notePath, initialContent);

      // Automatically create STW_SELECTED artifact if stw-selected blocks are present
      await this.createStwSelectedArtifactIfPresent(title, content);
    } catch (error) {
      logger.error('Error creating conversation note:', error);
      throw error;
    }
  }

  /**
   * Find message metadata by ID
   * @param conversationTitle The conversation title
   * @param messageId The message ID
   * @returns The message metadata, or null if not found
   */
  public async findMessageMetadataById(
    conversationTitle: string,
    messageId: string
  ): Promise<Record<string, string> | null> {
    try {
      // Get the conversation file
      const folderPath = `${this.plugin.settings.stewardFolder}/Conversations`;
      const notePath = `${folderPath}/${conversationTitle}.md`;
      const file = this.plugin.app.vault.getFileByPath(notePath);

      if (!file) {
        throw new Error(`Note not found: ${notePath}`);
      }

      // Read the content
      const content = await this.plugin.app.vault.cachedRead(file);

      // Find the comment block with the given ID
      const idPattern = `ID:${messageId}`;
      const commentBlockRegex = new RegExp(`<!--STW ${idPattern}.*?-->`, 'gi');
      const matches = Array.from(content.matchAll(commentBlockRegex));

      // If a match is found, parse it into an object
      if (matches.length > 0) {
        const fullComment = matches[0][0];

        // Parse all metadata fields
        const metadataObject: Record<string, string> = {};
        const metadataRegex = /([A-Z]+):([^,]+)(?=,|-->)/gi;
        let metadataMatch;

        while ((metadataMatch = metadataRegex.exec(fullComment)) !== null) {
          const [, key, value] = metadataMatch;
          metadataObject[key] = value;
        }

        return metadataObject;
      }

      return null;
    } catch (error) {
      logger.error('Error finding message metadata by ID:', error);
      return null;
    }
  }

  /**
   * Removes content marked with <!--stw-tool-hidden-start--> and <!--stw-tool-hidden-end-->
   * from the message content. This content is visible in reading view but excluded from
   * tool call results.
   * @param content The message content to filter
   * @returns The filtered content with tool-hidden sections removed
   */
  private removeToolHiddenContent(content: string): string {
    // Match content between <!--stw-tool-hidden-start--> and <!--stw-tool-hidden-end-->
    // Using non-greedy match to handle multiple sections
    const toolHiddenRegex = /<!--stw-tool-hidden-start-->[\s\S]*?<!--stw-tool-hidden-end-->/g;
    return content.replace(toolHiddenRegex, '').trim();
  }

  /**
   * Gets a specific message by ID from a conversation
   * @param conversationTitle The title of the conversation
   * @param messageId The ID of the message to retrieve
   * @param excludeToolHidden If true, removes content marked with tool-hidden markers
   * @returns The conversation message, or null if not found
   */
  public async getMessageById(
    conversationTitle: string,
    messageId: string,
    excludeToolHidden = false
  ): Promise<ConversationMessage | null> {
    try {
      // Get the conversation file
      const folderPath = `${this.plugin.settings.stewardFolder}/Conversations`;
      const notePath = `${folderPath}/${conversationTitle}.md`;
      const file = this.plugin.app.vault.getFileByPath(notePath);

      if (!file) {
        throw new Error(`Note not found: ${notePath}`);
      }

      // Read the content
      const content = await this.plugin.app.vault.cachedRead(file);

      // Find the comment block with the given ID
      const idPattern = `ID:${messageId}`;
      const commentBlockRegex = new RegExp(`<!--STW ${idPattern}[^>]*-->`, 'gi');
      const match = commentBlockRegex.exec(content);

      if (!match) {
        return null;
      }

      // Parse metadata from the comment block
      const metadataStr = match[0].replace(/<!--STW |-->/g, '');
      const metadata: Record<string, string> = {};
      const pairs = metadataStr.split(',');
      for (const pair of pairs) {
        const [key, value] = pair.split(':');
        if (key && value) {
          metadata[key] = value;
        }
      }

      // Get the message content
      const startPos = (match.index ?? 0) + match[0].length;

      // Find the next comment block to determine the end of this message
      const nextCommentRegex = /<!--STW ID:[^>]*-->/gi;
      nextCommentRegex.lastIndex = startPos;
      const nextMatch = nextCommentRegex.exec(content);

      const endPos = nextMatch ? (nextMatch.index ?? content.length) : content.length;
      let messageContent = content.substring(startPos, endPos).trim();

      // If no role is defined, return null
      if (!metadata.ROLE) {
        return null;
      }

      // Clean up the content based on role
      if (metadata.ROLE === 'user') {
        // Try to extract content from stw-user-message callout
        const calloutContent = this.plugin.noteContentService.extractCalloutContent(
          messageContent,
          'stw-user-message'
        );

        if (calloutContent) {
          // Remove the role text if present
          messageContent = calloutContent.replace(/^\*\*User:\*\* /i, '');
        }
      }

      // Remove any role name with the syntax **Role:**
      messageContent = messageContent.replace(/\*\*(User|Steward|System):\*\* /g, '');

      // Remove separator lines
      messageContent = messageContent.replace(/^---$/gm, '');

      // Remove loading indicators
      messageContent = messageContent.replace(/\*.*?\.\.\.\*$/gm, '');

      // Remove tool-hidden content if requested (for tool call results)
      if (excludeToolHidden) {
        messageContent = this.removeToolHiddenContent(messageContent);
      }

      // Convert role from 'steward' to 'assistant'
      const role = metadata.ROLE === 'steward' ? 'assistant' : metadata.ROLE;

      // Determine if this message should be included in history
      const includeInHistory = metadata.HISTORY !== 'false';

      return {
        id: metadata.ID,
        role: role as ConversationRole,
        content: messageContent.trim(),
        intent: metadata.COMMAND || metadata.AGENT,
        lang: metadata.LANG,
        history: includeInHistory,
        ...(metadata.TYPE && {
          type: metadata.TYPE,
        }),
        ...(metadata.ARTIFACT_TYPE && {
          artifactType: metadata.ARTIFACT_TYPE,
        }),
        ...(metadata.HANDLER_ID && {
          handlerId: metadata.HANDLER_ID,
        }),
      };
    } catch (error) {
      logger.error('Error getting message by ID:', error);
      return null;
    }
  }

  /**
   * Gets all messages with a specific handler ID from a conversation
   * @param conversationTitle The title of the conversation
   * @param handlerId The handler ID to filter by
   * @returns Array of conversation messages with the specified handler ID
   */
  public async getMessagesByHandlerId(
    conversationTitle: string,
    handlerId: string
  ): Promise<ModelMessage[]> {
    try {
      // Get all messages from the conversation
      const allMessages = await this.extractConversationHistory(conversationTitle);

      // Filter messages by handler ID
      return allMessages.filter(
        message => 'handlerId' in message && message.handlerId === handlerId
      );
    } catch (error) {
      logger.error('Error getting messages by handler ID:', error);
      return [];
    }
  }

  /**
   * Update the metadata for a message
   * @param conversationTitle The conversation title
   * @param messageId The message ID
   * @param newMetadata The updated metadata
   */
  public async updateMessageMetadata(
    conversationTitle: string,
    messageId: string,
    newMetadata: Record<string, string>
  ): Promise<boolean> {
    try {
      // Get the conversation file
      const folderPath = `${this.plugin.settings.stewardFolder}/Conversations`;
      const notePath = `${folderPath}/${conversationTitle}.md`;
      const file = this.plugin.app.vault.getFileByPath(notePath);

      if (!file) {
        throw new Error(`Note not found: ${notePath}`);
      }

      // Update the file with regex check inside process to ensure current content
      let foundMatch = false;
      await this.plugin.app.vault.process(file, currentContent => {
        // Find the comment block with the given ID in the current content
        const idPattern = `ID:${messageId}`;
        const commentBlockRegex = new RegExp(`<!--STW ${idPattern}.*?-->`, 'gi');
        const matches = Array.from(currentContent.matchAll(commentBlockRegex));

        if (matches.length > 0) {
          foundMatch = true;

          // Get the existing comment block
          const originalCommentBlock = matches[0][0];

          // Create the updated comment block
          let updatedCommentBlock = '<!--STW ';
          for (const [key, value] of Object.entries(newMetadata)) {
            updatedCommentBlock += `${key}:${value},`;
          }
          // Remove trailing comma and close comment
          updatedCommentBlock = updatedCommentBlock.slice(0, -1) + '-->';

          // Replace the comment block in the content
          return currentContent.replace(originalCommentBlock, updatedCommentBlock);
        }

        // Return unchanged content if no match found
        return currentContent;
      });

      return foundMatch;
    } catch (error) {
      logger.error('Error updating message metadata:', error);
      return false;
    }
  }

  /**
   * Extracts all messages from a conversation
   * @param conversationTitle The title of the conversation
   * @returns Array of all conversation messages
   */
  public async extractAllConversationMessages(
    conversationTitle: string
  ): Promise<ConversationMessage[]> {
    try {
      // Get the conversation file
      const folderPath = `${this.plugin.settings.stewardFolder}/Conversations`;
      const notePath = `${folderPath}/${conversationTitle}.md`;
      const file = this.plugin.app.vault.getFileByPath(notePath);

      if (!file) {
        throw new Error(`Note not found: ${notePath}`);
      }

      // Read the content
      const content = await this.plugin.app.vault.cachedRead(file);

      // Find all metadata blocks
      const metadataRegex = /<!--STW (.*?)-->/gi;
      const matches = Array.from(content.matchAll(metadataRegex));

      const messages: Array<ConversationMessage> = [];

      // Process each message block
      for (let i = 0; i < matches.length; i++) {
        const match = matches[i];
        const metadataStr = match[1];
        const metadata: Record<string, string> = {};

        // Parse metadata
        const pairs = metadataStr.split(',');
        for (const pair of pairs) {
          const [key, value] = pair.split(':');
          if (key && value) {
            metadata[key] = value;
          }
        }

        // Get the message content
        const startPos = (match.index || 0) + match[0].length;
        const endPos = i < matches.length - 1 ? matches[i + 1].index || 0 : content.length;
        let messageContent = content.substring(startPos, endPos).trim();

        // If no role is defined, append to the previous message if available
        if (!metadata.ROLE) {
          if (messages.length > 0) {
            // Append this content to the previous message
            messages[messages.length - 1].content += '\n\n' + messageContent;
          }
          continue;
        }

        // Clean up the content based on role
        if (metadata.ROLE === 'user') {
          // Try to extract content from stw-user-message callout
          const calloutContent = this.plugin.noteContentService.extractCalloutContent(
            messageContent,
            'stw-user-message'
          );

          if (calloutContent) {
            // Remove the role text if present
            messageContent = calloutContent.replace(/^\*\*User:\*\* /i, '');
          } else {
            // For backward compatibility, try the old heading format
            messageContent = messageContent.replace(/^##### \*\*User:\*\* /m, '');
          }
        } else if (metadata.ROLE === 'steward') {
          // Special handling for search results
          if (metadata.COMMAND === 'search') {
            // Extract file paths from search results
            const paths: string[] = [];
            const pathRegex = /\[\[(.*?)\]\]/g;
            let pathMatch;

            while ((pathMatch = pathRegex.exec(messageContent)) !== null) {
              if (pathMatch[1]) {
                paths.push(pathMatch[1]);
              }
            }

            // If paths were found, use them as content
            if (paths.length > 0) {
              messageContent = `Search results: ${paths.join(', ')}`;
            }
          }
        }

        // Remove any role name with the syntax **Role:**
        messageContent = messageContent.replace(/\*\*(User|Steward|System):\*\* /g, '');

        // Remove separator lines
        messageContent = messageContent.replace(/^---$/gm, '');

        // Remove loading indicators
        messageContent = messageContent.replace(/\*.*?\.\.\.\*$/gm, '');

        // Remove stw-thinking block when type is reasoning
        if (metadata.TYPE === 'reasoning') {
          // Extract content inside stw-thinking code block (supports both 3 and 4 backticks for compatibility)
          const stwThinkingRegex =
            /````stw-thinking\s*([\s\S]*?)\s*````|```stw-thinking\s*([\s\S]*?)\s*```/m;
          const match = stwThinkingRegex.exec(messageContent);
          if (match) {
            messageContent = (match[1] || match[2] || '').trim();
          }
        }

        // Convert role from 'steward' to 'assistant'
        const role = metadata.ROLE === 'steward' ? 'assistant' : metadata.ROLE;

        // Determine if this message should be included in history
        const includeInHistory = metadata.HISTORY !== 'false';

        messages.push({
          id: metadata.ID,
          role: role as ConversationRole,
          content: messageContent.trim(),
          intent: metadata.COMMAND || metadata.AGENT,
          lang: metadata.LANG,
          history: includeInHistory,
          ...(metadata.TYPE && {
            type: metadata.TYPE,
          }),
          ...(metadata.ARTIFACT_TYPE && {
            artifactType: metadata.ARTIFACT_TYPE,
          }),
          ...(metadata.HANDLER_ID && {
            handlerId: metadata.HANDLER_ID,
          }),
          ...(metadata.STEP !== undefined && {
            step: parseInt(metadata.STEP, 10),
          }),
        });
      }

      return messages;
    } catch (error) {
      logger.error('Error extracting conversation messages:', error);
      return [];
    }
  }

  /**
   * Extracts conversation history from a conversation markdown file
   * @returns Array of conversation history messages
   */
  public async extractConversationHistory(
    conversationTitle: string,
    options?: {
      maxMessages?: number;
      summaryPosition?: number;
    }
  ): Promise<ModelMessage[]> {
    const { maxMessages = 10 } = options || {};
    let { summaryPosition = 0 } = options || {};

    try {
      // Get all messages from the conversation
      const allMessages = await this.extractAllConversationMessages(conversationTitle);

      // Filter out messages where history is explicitly set to false
      const messagesForHistory: (ConversationMessage & { ignored?: boolean })[] =
        allMessages.filter(message => message.history !== false);

      // Remove the last message if it is a user message which is just being added.
      if (
        messagesForHistory.length > 0 &&
        messagesForHistory[messagesForHistory.length - 1].role === 'user'
      ) {
        messagesForHistory.pop();
      }

      // Find the most recent summary message or the start of the latest topic
      const continuationCommands = [' ', 'confirm', 'thank_you'];
      let topicStartIndex = 0;

      for (let i = messagesForHistory.length - 1; i >= 0; i--) {
        const message = messagesForHistory[i];

        // Check for summary message first (highest priority)
        if (message.intent === 'summary') {
          if (summaryPosition === 0) {
            topicStartIndex = i;
            break;
          }
          messagesForHistory[i].ignored = true;
          summaryPosition--;
        }

        if (message.role === 'user' && !continuationCommands.includes(message.intent)) {
          // Found a message that starts a new topic
          topicStartIndex = i;
          break;
        }
      }

      // Get messages after the topicStartIndex (either summary or topic start)
      const filteredMessages = messagesForHistory
        .slice(topicStartIndex)
        .filter(message => !message.ignored);

      // Slice messages without cutting in the middle of a step
      const messagesToInclude = this.sliceMessagesPreservingSteps(filteredMessages, maxMessages);

      // Group consecutive messages by (handlerId, role, step) for merging
      const groupedMessages = this.groupMessagesByStep(messagesToInclude);

      // Find the index of the last assistant group (to only include reasoning for it)
      const lastAssistantGroupIndex = groupedMessages.findLastIndex(
        group => group[0].role === 'assistant'
      );

      // Convert grouped messages to ModelMessages
      const modelMessages: ModelMessage[] = [];

      for (let groupIndex = 0; groupIndex < groupedMessages.length; groupIndex++) {
        const group = groupedMessages[groupIndex];
        const firstMessage = group[0];
        const isLastAssistantGroup = groupIndex === lastAssistantGroupIndex;

        // User messages are not grouped by step, process individually
        if (firstMessage.role === 'user') {
          const content = this.plugin.userMessageService.sanitizeQuery(firstMessage.content);
          modelMessages.push({
            role: 'user',
            content,
            ...(firstMessage.handlerId && { handlerId: firstMessage.handlerId }),
          });
          continue;
        }

        // Process assistant/tool messages - collect all parts from the group
        const assistantParts: (TextPart | ToolCallPart | ReasoningOutput)[] = [];
        const toolResultParts: ToolResultPart[] = [];
        const additionalUserParts: (TextPart | FilePart | ImagePart)[] = [];

        for (const message of group) {
          if (message.type === 'tool-invocation') {
            const toolInvocations = await this.deserializeToolInvocations({
              message,
              conversationTitle,
            });

            if (toolInvocations && toolInvocations.length > 0) {
              for (const part of toolInvocations) {
                if (part.type === 'tool-call') {
                  assistantParts.push(part);
                } else if (part.type === 'tool-result') {
                  toolResultParts.push(part);
                } else if (part.type === 'text' || part.type === 'file' || part.type === 'image') {
                  additionalUserParts.push(part);
                }
              }
            }
          } else if (message.type === 'reasoning') {
            // Only include reasoning for the latest assistant message
            if (isLastAssistantGroup) {
              assistantParts.push({ type: 'reasoning', text: message.content });
            }
          } else if (message.role === 'assistant') {
            assistantParts.push({ type: 'text', text: message.content });
          }
        }

        // Auto-include empty reasoning content if missing (only for the latest assistant message)
        if (isLastAssistantGroup) {
          const hasReasoningPart = assistantParts.some(part => part.type === 'reasoning');
          if (!hasReasoningPart && assistantParts.length > 0) {
            // Insert empty reasoning at the beginning (reasoning should come before text)
            assistantParts.unshift({ type: 'reasoning', text: '' });
          }
        }

        // Push assistant message with all collected parts
        if (assistantParts.length > 0) {
          modelMessages.push({
            role: 'assistant',
            content: assistantParts,
            ...(firstMessage.handlerId && { handlerId: firstMessage.handlerId }),
          });
        }

        // Push tool message with tool-result parts
        if (toolResultParts.length > 0) {
          modelMessages.push({
            role: 'tool',
            content: toolResultParts,
            ...(firstMessage.handlerId && { handlerId: firstMessage.handlerId }),
          });
        }

        // Push additional parts (images) as a user message if present
        if (additionalUserParts.length > 0) {
          modelMessages.push({
            role: 'user',
            content: additionalUserParts,
          });
        }
      }

      return modelMessages;
    } catch (error) {
      logger.error('Error extracting conversation history:', error);
      return [];
    }
  }

  /**
   * Slices messages to a maximum count without cutting in the middle of a step.
   * If the slice would cut through messages with the same (handlerId, step),
   * it adjusts to include all messages from that step.
   */
  private sliceMessagesPreservingSteps(
    messages: ConversationMessage[],
    maxMessages: number
  ): ConversationMessage[] {
    if (messages.length <= maxMessages) {
      return messages;
    }

    // Start with the basic slice from the end
    let startIndex = messages.length - maxMessages;
    const firstMessage = messages[startIndex];

    // If the first message has a step, find where this step begins
    if (firstMessage.step !== undefined && firstMessage.handlerId) {
      // Look backwards to find the start of this step
      for (let i = startIndex - 1; i >= 0; i--) {
        const prevMessage = messages[i];
        if (
          prevMessage.handlerId === firstMessage.handlerId &&
          prevMessage.step === firstMessage.step
        ) {
          startIndex = i;
        } else {
          break;
        }
      }
    }

    return messages.slice(startIndex);
  }

  /**
   * Groups consecutive messages that share the same (handlerId, role, step).
   * User messages are not grouped (each becomes its own group).
   * Messages without a step are not grouped with others.
   */
  private groupMessagesByStep(messages: ConversationMessage[]): ConversationMessage[][] {
    const groups: ConversationMessage[][] = [];
    let currentGroup: ConversationMessage[] = [];

    for (const message of messages) {
      // User messages always start a new group and are not merged
      if (message.role === 'user') {
        if (currentGroup.length > 0) {
          groups.push(currentGroup);
          currentGroup = [];
        }
        groups.push([message]);
        continue;
      }

      // Messages without step or handlerId are not grouped
      if (message.step === undefined || !message.handlerId) {
        if (currentGroup.length > 0) {
          groups.push(currentGroup);
          currentGroup = [];
        }
        groups.push([message]);
        continue;
      }

      // Check if this message belongs to the current group
      if (currentGroup.length > 0) {
        const lastMessage = currentGroup[currentGroup.length - 1];
        const sameGroup =
          lastMessage.handlerId === message.handlerId &&
          lastMessage.step === message.step &&
          lastMessage.role !== 'user';

        if (sameGroup) {
          currentGroup.push(message);
        } else {
          groups.push(currentGroup);
          currentGroup = [message];
        }
      } else {
        currentGroup = [message];
      }
    }

    // Don't forget the last group
    if (currentGroup.length > 0) {
      groups.push(currentGroup);
    }

    return groups;
  }

  /**
   * Gets a property from the conversation's YAML frontmatter
   * Tries cache first, then reads directly from file if not found
   * @param conversationTitle The title of the conversation
   * @param property The property name to retrieve
   * @returns The property value or undefined if not found
   */
  public async getConversationProperty<T>(
    conversationTitle: string,
    property: string,
    forceRefresh?: boolean
  ): Promise<T | undefined> {
    try {
      // Get the conversation file
      const folderPath = `${this.plugin.settings.stewardFolder}/Conversations`;
      const notePath = `${folderPath}/${conversationTitle}.md`;
      const file = this.plugin.app.vault.getFileByPath(notePath);

      if (!file) {
        throw new Error(`Note not found: ${notePath}`);
      }

      // Try to get from cache first
      const fileCache = this.plugin.app.metadataCache.getFileCache(file);

      if (fileCache?.frontmatter && !forceRefresh) {
        return fileCache.frontmatter[property];
      }

      // Cache miss, read directly from file
      if (forceRefresh) {
        logger.log(`Force refresh for property ${property}, reading directly from file`);
      } else {
        logger.log(`Cache miss for property ${property}, reading directly from file`);
      }
      const fileContent = await this.plugin.app.vault.read(file);
      const frontmatterRegex = /^---\n([\s\S]*?)\n---/;
      const match = fileContent.match(frontmatterRegex);

      if (match) {
        const frontmatter = parseYaml(match[1]) as Record<string, unknown>;
        return frontmatter[property] as T;
      }

      return undefined;
    } catch (error) {
      logger.error(`Error getting conversation property ${property}:`, error);
      return undefined;
    }
  }

  /**
   * Updates a property in the conversation's YAML frontmatter
   * @param conversationTitle The title of the conversation
   * @param properties The properties to update
   * @returns True if successful, false otherwise
   */
  public async updateConversationFrontmatter(
    conversationTitle: string,
    properties: Array<{ name: string; value: unknown }>
  ): Promise<boolean> {
    try {
      // Get the conversation file
      const folderPath = `${this.plugin.settings.stewardFolder}/Conversations`;
      const notePath = `${folderPath}/${conversationTitle}.md`;
      const file = this.plugin.app.vault.getFileByPath(notePath);

      if (!file) {
        throw new Error(`Note not found: ${notePath}`);
      }

      await this.plugin.app.fileManager.processFrontMatter(file, frontmatter => {
        for (const { name, value } of properties) {
          frontmatter[name] = value;
        }
      });

      return true;
    } catch (error) {
      logger.error(`Error updating conversation frontmatter:`, error);
      return false;
    }
  }

  /**
   * Deletes a message and all messages below it from a conversation note
   * @param conversationTitle The title of the conversation
   * @param messageId The ID of the message to delete
   * @returns True if successful, false otherwise
   */
  public async deleteMessageAndBelow(
    conversationTitle: string,
    messageId: string
  ): Promise<boolean> {
    try {
      // Get the conversation file
      const folderPath = `${this.plugin.settings.stewardFolder}/Conversations`;
      const notePath = `${folderPath}/${conversationTitle}.md`;
      const file = this.plugin.app.vault.getFileByPath(notePath);

      if (!file) {
        throw new Error(`Note not found: ${notePath}`);
      }

      await this.plugin.app.vault.process(file, currentContent => {
        // Use the pure function to get content after deletion
        currentContent = this.getContentAfterDeletion(currentContent, messageId);
        if (currentContent === null) {
          logger.error(`Message with ID ${messageId} not found in ${notePath}`);
        }
        return currentContent;
      });

      return true;
    } catch (error) {
      logger.error('Error deleting message and below:', error);
      return false;
    }
  }

  /**
   * Sanitizes conversation content by removing trailing separator lines
   * and ensuring proper formatting
   * @param content The content to sanitize
   * @returns The sanitized content
   */
  public sanitizeConversationContent(content: string): string {
    if (!content) return '';

    // Remove trailing whitespace first
    let sanitizedContent = content.trimEnd();

    // Use regex to find and remove trailing separator lines
    // This handles cases where the separator might be followed by newlines
    const trailingSeparatorRegex = /(\n*---\n*)+$/;

    // Remove trailing separators
    if (trailingSeparatorRegex.test(sanitizedContent)) {
      sanitizedContent = sanitizedContent.replace(trailingSeparatorRegex, '');
      sanitizedContent = sanitizedContent.trimEnd();
    }

    // Ensure the content doesn't end with multiple newlines
    sanitizedContent = sanitizedContent.replace(/\n+$/, '\n');

    return sanitizedContent;
  }

  /**
   * Sanitizes a conversation note by removing trailing separators and ensuring proper formatting
   * @param conversationPath The path to the conversation note
   * @returns True if successful, false otherwise
   */
  public async sanitizeConversationNote(conversationPath: string): Promise<boolean> {
    try {
      // Get the conversation file
      const file = this.plugin.app.vault.getFileByPath(conversationPath);

      if (!file) {
        throw new Error(`Note not found: ${conversationPath}`);
      }

      await this.plugin.app.vault.process(file, currentContent => {
        currentContent = this.removeGeneratingIndicator(currentContent);
        return this.sanitizeConversationContent(currentContent);
      });

      return true;
    } catch (error) {
      logger.error('Error sanitizing conversation note:', error);
      return false;
    }
  }

  /**
   * Extracts the conversation title from a path
   * @param path The path to extract the title from
   * @returns The conversation title
   */
  public extractTitleFromPath(path: string): string {
    const pathParts = path.split('/');
    const fileName = pathParts[pathParts.length - 1];
    return fileName.replace('.md', '');
  }
}
