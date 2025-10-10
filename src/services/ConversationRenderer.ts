import { TFile } from 'obsidian';
import { uniqueID } from '../utils/uniqueID';
import { getTranslation } from '../i18n';
import { ConversationHistoryMessage, ConversationMessage, ConversationRole } from '../types/types';
import { getObsidianLanguage } from '../utils/getObsidianLanguage';
import type StewardPlugin from '../main';
import { logger } from 'src/utils/logger';
import { ArtifactType } from 'src/solutions/artifact';

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
   * Updates the command type in the comment block of the last user message
   * @param title The conversation title
   * @param commandType The extracted command type
   */
  public async updateLastUserMessageCommand(title: string, commandType: string): Promise<void> {
    try {
      // Get the conversation file
      const folderPath = `${this.plugin.settings.stewardFolder}/Conversations`;
      const notePath = `${folderPath}/${title}.md`;
      const file = this.plugin.app.vault.getFileByPath(notePath);

      if (!file) {
        throw new Error(`Note not found: ${notePath}`);
      }

      // Read the current content
      let content = await this.plugin.app.vault.read(file);

      // Find the last user message with a comment block
      const commentBlockRegex = /<!--STW ID:(.*?),ROLE:user,COMMAND:(.*?)-->/gi;
      const matches = Array.from(content.matchAll(commentBlockRegex));

      if (matches.length > 0) {
        // Get the last user message comment block
        const lastMatch = matches[matches.length - 1];
        const originalCommentBlock = lastMatch[0];
        const messageId = lastMatch[1];

        // Create the updated comment block with the new command type
        const updatedCommentBlock = `<!--STW ID:${messageId},ROLE:user,COMMAND:${commandType}-->`;

        // Replace only the last occurrence of the comment block
        const lastIndex = content.lastIndexOf(originalCommentBlock);
        if (lastIndex !== -1) {
          content =
            content.substring(0, lastIndex) +
            updatedCommentBlock +
            content.substring(lastIndex + originalCommentBlock.length);

          // Update the file
          await this.plugin.app.vault.modify(file, content);
        }
      }
    } catch (error) {
      logger.error('Error updating comment block:', error);
      // Don't throw, as this is not a critical operation
    }
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
  public async serializeToolInvocation<T>(params: {
    path: string;
    command: string;
    text?: string;
    handlerId?: string;
    toolInvocations: {
      toolName: string;
      toolCallId: string;
      args: Record<string, unknown>;
      result?: T;
    }[];
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
        type: 'tool-invocation',
        handlerId: params.handlerId,
      });

      // Process the file content
      await this.plugin.app.vault.process(file, currentContent => {
        // Remove the generating indicator and any trailing newlines
        currentContent = this.removeGeneratingIndicator(currentContent);

        let contentToAdd = params.text ? `${params.text}\n` : '';

        contentToAdd += `\`\`\`stw-artifact\n${JSON.stringify(params.toolInvocations)}\n\`\`\``;

        // Return the updated content
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
   * @param params - Either a messageId (string) or a ConversationMessage
   * @returns The deserialized tool call with resolved result
   */
  public async deserializeToolInvocations(params: {
    message: ConversationMessage;
    conversationTitle: string;
  }): Promise<
    | {
        toolName: string;
        toolCallId: string;
        args: Record<string, unknown>;
        result: unknown;
      }[]
    | null
  > {
    try {
      // Extract all tool calls from the message content
      const toolInvocationsMatches = params.message.content.match(
        /```stw-artifact\n([\s\S]*?)\n```/g
      );
      if (!toolInvocationsMatches || toolInvocationsMatches.length === 0) {
        logger.error('No stw-artifact blocks found in message content');
        return null;
      }

      const toolInvocations = [];

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
          const { toolName, toolCallId, args, result } = toolInvocation;

          if (!toolName || !toolCallId || !args) {
            logger.error('Invalid tool call data structure', toolInvocation);
            continue; // Skip invalid tool calls but continue processing others
          }

          // Resolve the result based on its type
          let resolvedResult = result;

          if (typeof result === 'string') {
            // Check if it's an artifact reference
            if (result.startsWith('artifactRef:')) {
              const artifactId = result.substring('artifactRef:'.length);
              const artifact = await this.plugin.artifactManagerV2
                .withTitle(params.conversationTitle)
                .getArtifactById(artifactId);
              if (artifact) {
                resolvedResult = artifact;
              } else {
                logger.error(`Artifact not found: ${artifactId}`);
                resolvedResult = null;
              }
            } else if (result.startsWith('messageRef:')) {
              const messageId = result.substring('messageRef:'.length);
              const referencedMessage = await this.getMessageById(
                params.conversationTitle,
                messageId
              );
              if (referencedMessage) {
                resolvedResult = referencedMessage.content;
              } else {
                logger.error(`Message not found: ${messageId}`);
                resolvedResult = null;
              }
            }
            // Otherwise, it's an inlined result, keep as is
          }

          toolInvocations.push({
            toolName,
            toolCallId,
            args,
            result: resolvedResult,
          });
        }
      }

      return toolInvocations.length > 0 ? toolInvocations : null;
    } catch (error: unknown) {
      logger.error('Error deserializing tool calls:', error);
      return null;
    }
  }

  /**
   * Updates a conversation note with the given content
   */
  public async updateConversationNote(params: {
    path: string;
    newContent: string;
    command?: string;
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
        includeHistory: params.includeHistory ?? true,
        handlerId: params.handlerId,
      });

      // Update language property in the frontmatter if provided
      if (params.lang) {
        await this.updateConversationFrontmatter(params.path, [
          { name: 'lang', value: params.lang },
        ]);
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

      let currentContent = await this.plugin.app.vault.read(file);

      // Remove the generating indicator and any trailing newlines
      currentContent = this.removeGeneratingIndicator(currentContent);

      const { messageId, comment } = await this.buildMessageMetadata(path, {
        role: 'Steward',
        command: params.command,
        includeHistory: params.includeHistory ?? true,
        handlerId: params.handlerId,
      });

      const roleText = this.formatRoleText(params.role);

      // Prepare the initial content with metadata
      const initialContent = `${currentContent}\n\n${comment}\n${roleText}`;

      // If position is provided, insert at that position
      // Otherwise, append to the end
      const contentToModify =
        params.position !== undefined
          ? currentContent.slice(0, params.position) +
            initialContent +
            currentContent.slice(params.position)
          : initialContent;

      // Write the initial content
      await this.plugin.app.vault.modify(file, contentToModify);

      // Stream the content
      await this.streamFile(file, params.stream, contentToModify);

      // Return the message ID for referencing
      return messageId;
    } catch (error) {
      logger.error('Error streaming to conversation note:', error);
      return undefined;
    }
  }

  public async streamFile(file: TFile, stream: AsyncIterable<string>, initialContent = '') {
    let accumulatedContent = '';
    for await (const chunk of stream) {
      accumulatedContent += chunk;
      await this.plugin.app.vault.modify(file, initialContent + accumulatedContent);
    }
  }

  public async buildMessageMetadata(
    title: string,
    options: {
      messageId?: string;
      role?: string;
      command?: string;
      includeHistory?: boolean;
      type?: string;
      artifactType?: ArtifactType;
      handlerId?: string;
    } = {}
  ) {
    const {
      messageId = uniqueID(),
      role = 'Steward',
      command,
      includeHistory,
      handlerId,
    } = options;

    const metadata: { [x: string]: string | number } = {
      ID: messageId,
      ROLE: role.toLowerCase(),
      ...(command && {
        COMMAND: command,
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

    const currentContent = this.removeGeneratingIndicator(await this.plugin.app.vault.read(file));
    const newContent = `${currentContent}\n\n*${indicatorText}*`;
    await this.plugin.app.vault.modify(file, newContent);
  }

  /**
   * Removes the generating indicator from the content
   */
  public removeGeneratingIndicator(content: string): string {
    return content.replace(/\n\n\*.*?\.\.\.\*$/, '');
  }

  public async removeGeneratingIndicatorByPath(path: string): Promise<void> {
    const folderPath = `${this.plugin.settings.stewardFolder}/Conversations`;
    const notePath = `${folderPath}/${path}.md`;

    // Get the current content of the note
    const file = this.plugin.app.vault.getFileByPath(notePath);
    if (!file) {
      throw new Error(`Note not found: ${notePath}`);
    }

    let currentContent = await this.plugin.app.vault.read(file);
    currentContent = this.removeGeneratingIndicator(currentContent);
    await this.plugin.app.vault.modify(file, currentContent);
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

      // Get the current model from settings
      const currentModel = this.plugin.settings.llm.chat.model;

      // Get the current language from settings
      const currentLanguage = language || getObsidianLanguage();

      // Create YAML frontmatter with model and language
      const frontmatter = `---\nmodel: ${currentModel}\nlang: ${currentLanguage}\n---\n\n`;

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

      switch (commandType) {
        case 'move':
          initialContent += `*${t('conversation.moving')}*`;
          break;

        case 'move_from_artifact':
          initialContent += `*${t('conversation.moving')}*`;
          break;

        case 'delete':
          initialContent += `*${t('conversation.deleting')}*`;
          break;

        case 'copy':
          initialContent += `*${t('conversation.copying')}*`;
          break;

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

        case 'prompt':
          initialContent += `*${t('conversation.creatingPrompt')}*`;
          break;

        case ' ':
        default:
          initialContent += `*${t('conversation.orchestrating')}*`;
          break;
      }

      // Remove the conversation note if exist
      const existingFile = this.plugin.app.vault.getFileByPath(notePath);
      if (existingFile) {
        await this.plugin.app.fileManager.trashFile(existingFile);
      }

      // Create the conversation note
      await this.plugin.app.vault.create(notePath, initialContent);
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
   * Gets a specific message by ID from a conversation
   * @param conversationTitle The title of the conversation
   * @param messageId The ID of the message to retrieve
   * @returns The conversation message, or null if not found
   */
  public async getMessageById(
    conversationTitle: string,
    messageId: string
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

      // Convert role from 'steward' to 'assistant'
      const role = metadata.ROLE === 'steward' ? 'assistant' : metadata.ROLE;

      // Determine if this message should be included in history
      const includeInHistory = metadata.HISTORY !== 'false';

      return {
        id: metadata.ID,
        role: role as ConversationRole,
        content: messageContent.trim(),
        command: metadata.COMMAND || '',
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
  ): Promise<ConversationHistoryMessage[]> {
    try {
      // Get all messages from the conversation
      const allMessages = await this.extractConversationHistory(conversationTitle);

      // Filter messages by handler ID
      return allMessages.filter(message => message.handlerId === handlerId);
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

      // Read the current content
      let content = await this.plugin.app.vault.read(file);

      // Find the comment block with the given ID
      const idPattern = `ID:${messageId}`;
      const commentBlockRegex = new RegExp(`<!--STW ${idPattern}.*?-->`, 'gi');
      const matches = Array.from(content.matchAll(commentBlockRegex));

      if (matches.length > 0) {
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
        content = content.replace(originalCommentBlock, updatedCommentBlock);

        // Update the file
        await this.plugin.app.vault.modify(file, content);
        return true;
      }

      return false;
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

        // Convert role from 'steward' to 'assistant'
        const role = metadata.ROLE === 'steward' ? 'assistant' : metadata.ROLE;

        // Determine if this message should be included in history
        const includeInHistory = metadata.HISTORY !== 'false';

        messages.push({
          id: metadata.ID,
          role: role as ConversationRole,
          content: messageContent.trim(),
          command: metadata.COMMAND || '',
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
  ): Promise<ConversationHistoryMessage[]> {
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
        if (message.command === 'summary') {
          if (summaryPosition === 0) {
            topicStartIndex = i;
            break;
          }
          messagesForHistory[i].ignored = true;
          summaryPosition--;
        }

        if (message.role === 'user' && !continuationCommands.includes(message.command)) {
          // Found a message that starts a new topic
          topicStartIndex = i;
          break;
        }
      }

      // Get messages after the topicStartIndex (either summary or topic start)
      const messagesToInclude = messagesForHistory
        .slice(topicStartIndex)
        .filter(message => !message.ignored)
        .slice(-maxMessages);

      const result: ConversationHistoryMessage[] = [];

      for (const message of messagesToInclude) {
        if (message.type === 'tool-invocation') {
          const toolInvocations = await this.deserializeToolInvocations({
            message,
            conversationTitle,
          });

          if (toolInvocations && toolInvocations.length > 0) {
            result.push({
              id: message.id,
              content: '',
              role: 'assistant',
              handlerId: message.handlerId,
              parts: toolInvocations.map(toolInvocation => ({
                type: 'tool-invocation',
                toolInvocation: {
                  ...toolInvocation,
                  state: 'result',
                },
              })),
            });
            continue;
          }
        }
        result.push({
          id: message.id,
          role: message.role,
          content: message.content,
          handlerId: message.handlerId,
        });
      }

      return result;
    } catch (error) {
      logger.error('Error extracting conversation history:', error);
      return [];
    }
  }

  /**
   * Gets a property from the conversation's YAML frontmatter
   * @param conversationTitle The title of the conversation
   * @param property The property name to retrieve
   * @returns The property value or undefined if not found
   */
  public async getConversationProperty(
    conversationTitle: string,
    property: string
  ): Promise<unknown | undefined> {
    try {
      // Get the conversation file
      const folderPath = `${this.plugin.settings.stewardFolder}/Conversations`;
      const notePath = `${folderPath}/${conversationTitle}.md`;
      const file = this.plugin.app.vault.getFileByPath(notePath);

      if (!file) {
        throw new Error(`Note not found: ${notePath}`);
      }

      // Get the file's metadata cache
      const fileCache = this.plugin.app.metadataCache.getFileCache(file);

      // Check if the file has frontmatter
      if (!fileCache || !fileCache.frontmatter) {
        return undefined;
      }

      return fileCache.frontmatter[property];
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
    properties: Array<{ name: string; value: string }>
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

      // Read the current content
      const content = await this.plugin.app.vault.read(file);

      // Use the pure function to get content after deletion
      const newContent = this.getContentAfterDeletion(content, messageId);
      if (newContent === null) {
        logger.error(`Message with ID ${messageId} not found in ${notePath}`);
        return false;
      }

      // Update the file
      await this.plugin.app.vault.modify(file, newContent);

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

      // Read the current content
      const content = await this.plugin.app.vault.read(file);

      // Sanitize the content
      const sanitizedContent = this.sanitizeConversationContent(content);

      // If the content hasn't changed, no need to update
      if (sanitizedContent === content) {
        return true;
      }

      // Update the file
      await this.plugin.app.vault.modify(file, sanitizedContent);

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
