import { TFile } from 'obsidian';
import { uniqueID } from '../utils/uniqueID';
import { getTranslation } from '../i18n';
import { ConversationHistoryMessage, ConversationRole } from '../types/types';

import type StewardPlugin from '../main';
import { ArtifactType } from './ConversationArtifactManager';
import { logger } from 'src/utils/logger';

export class ConversationRenderer {
  private readonly plugin: StewardPlugin;

  constructor(plugin: StewardPlugin) {
    this.plugin = plugin;
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
      const file = this.plugin.app.vault.getAbstractFileByPath(notePath) as TFile;

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
      console.error('Error updating comment block:', error);
      // Don't throw, as this is not a critical operation
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
     * The role of the message.
     * If not provided, the role will be Steward by default, but not displayed in the conversation
     */
    role?: 'User' | 'Steward' | 'System';
    /**
     * The history will be included in conversation context.
     * If not provided, the history will be included by default.
     */
    includeHistory?: boolean;
  }): Promise<string | undefined> {
    try {
      const folderPath = `${this.plugin.settings.stewardFolder}/Conversations`;
      const notePath = `${folderPath}/${params.path}.md`;

      // Get the current content of the note
      const file = this.plugin.app.vault.getAbstractFileByPath(notePath) as TFile;
      if (!file) {
        throw new Error(`Note not found: ${notePath}`);
      }

      let currentContent = await this.plugin.app.vault.read(file);

      // Remove the generating indicator and any trailing newlines
      currentContent = this.removeGeneratingIndicator(currentContent);
      let heading = '';

      // Add a separator line if the role is User
      if (params.role === 'User') {
        currentContent = `${currentContent}\n\n---`;
        heading = '##### ';
      }

      const { messageId, comment } = await this.buildMessageMetadata(params.path, {
        role: params.role ?? 'Steward',
        command: params.command,
        includeHistory: params.includeHistory ?? true,
      });

      // Update the note
      const roleText = params.role ? `**${params.role}:** ` : '';
      await this.plugin.app.vault.modify(
        file,
        `${currentContent}\n\n${comment}\n${heading}${roleText}${params.newContent}`
      );

      // Return the message ID for referencing
      return messageId;
    } catch (error) {
      console.error('Error updating conversation note:', error);
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
  }): Promise<string | undefined> {
    const folderPath = params.folderPath || `${this.plugin.settings.stewardFolder}/Conversations`;

    try {
      const path = params.path.endsWith('.md') ? params.path : `${params.path}.md`;
      const notePath = `${folderPath}/${path}`;

      // Get the current content of the note
      const file = this.plugin.app.vault.getAbstractFileByPath(notePath) as TFile;
      if (!file) {
        throw new Error(`Note not found: ${notePath}`);
      }

      let currentContent = await this.plugin.app.vault.read(file);

      // Remove the generating indicator and any trailing newlines
      currentContent = this.removeGeneratingIndicator(currentContent);

      const { messageId, comment } = await this.buildMessageMetadata(path, {
        role: 'Steward',
        command: params.command,
      });

      const roleText = params.role ? `**${params.role}:** ` : '';

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
      this.streamFile(file, params.stream, contentToModify);

      // Return the message ID for referencing
      return messageId;
    } catch (error) {
      console.error('Error streaming to conversation note:', error);
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

  private async buildMessageMetadata(
    title: string,
    {
      role = 'Steward',
      command,
      includeHistory,
    }: { role?: string; command?: string; includeHistory?: boolean } = {}
  ) {
    const messageId = uniqueID();
    const metadata: { [x: string]: string | number } = {
      ID: messageId,
      ROLE: role.toLowerCase(),
      ...(command && {
        COMMAND: command,
      }),
      ...(includeHistory === false && {
        HISTORY: 'false',
      }),
    };

    if (role === 'System') {
      switch (command) {
        case 'search':
          metadata.ARTIFACT_TYPE = ArtifactType.SEARCH_RESULTS;
          break;
        case 'read':
          metadata.ARTIFACT_TYPE = ArtifactType.READ_CONTENT;
          break;
        case 'create':
          metadata.ARTIFACT_TYPE = ArtifactType.CREATED_NOTES;
          break;
        case 'move':
          metadata.ARTIFACT_TYPE = ArtifactType.MOVE_RESULTS;
          break;
      }
    }

    if (command === 'more') {
      const prevMoreMetadata = await this.findMostRecentMessageMetadata(title, command, 'steward');
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
  public async findMostRecentMessageMetadata(
    conversationTitle: string,
    command: string,
    role: string
  ): Promise<Record<string, string> | null> {
    try {
      // Get the conversation file
      const folderPath = `${this.plugin.settings.stewardFolder}/Conversations`;
      const notePath = `${folderPath}/${conversationTitle}.md`;
      const file = this.plugin.app.vault.getAbstractFileByPath(notePath);

      if (!file) {
        throw new Error(`Note not found: ${notePath}`);
      }

      // Read the content
      const content = await this.plugin.app.vault.cachedRead(file as TFile);

      // Prepare the regular expression pattern
      const rolePattern = `,ROLE:${role.toLowerCase()}`;
      const commandPattern = `,COMMAND:${command}`;

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

        console.log('metadataObject', metadataObject);

        return metadataObject;
      }

      return null;
    } catch (error) {
      console.error('Error finding message:', error);
      return null;
    }
  }

  /**
   * Adds a generating indicator to a conversation note
   */
  public async addGeneratingIndicator(path: string, indicatorText: string): Promise<void> {
    const folderPath = `${this.plugin.settings.stewardFolder}/Conversations`;
    const notePath = `${folderPath}/${path}.md`;
    const file = this.plugin.app.vault.getAbstractFileByPath(notePath) as TFile;
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
    const file = this.plugin.app.vault.getAbstractFileByPath(notePath) as TFile;
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
      const folderExists = this.plugin.app.vault.getAbstractFileByPath(folderPath);
      if (!folderExists) {
        await this.plugin.app.vault.createFolder(folderPath);
      }

      // Generate a message ID
      const messageId = uniqueID();

      // Get translation function with the appropriate language
      const t = getTranslation(language);

      // Build initial content based on command type
      let initialContent = `<!--STW ID:${messageId},ROLE:user,COMMAND:${commandType}-->\n##### **User:** /${commandType.trim()} ${content}\n\n`;

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
          initialContent += `*${t('conversation.generating')}*`;
          break;
      }

      // Create the conversation note
      await this.plugin.app.vault.create(notePath, initialContent);
    } catch (error) {
      console.error('Error creating conversation note:', error);
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
      const file = this.plugin.app.vault.getAbstractFileByPath(notePath);

      if (!file) {
        throw new Error(`Note not found: ${notePath}`);
      }

      // Read the content
      const content = await this.plugin.app.vault.cachedRead(file as TFile);

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
      console.error('Error finding message metadata by ID:', error);
      return null;
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
      const file = this.plugin.app.vault.getAbstractFileByPath(notePath) as TFile;

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
      console.error('Error updating message metadata:', error);
      return false;
    }
  }

  /**
   * Formats content as a callout block with the specified type and optional metadata
   * @param content The content to format in a callout
   * @param type The callout type (e.g., 'note', 'warning', 'info', 'search-result')
   * @param metadata Optional metadata to include in the callout header
   * @returns The formatted callout block
   */
  public formatCallout(
    content: string,
    type = 'search-result',
    metadata?: { [key: string]: unknown }
  ): string {
    let metadataStr = '';

    if (metadata && Object.keys(metadata).length > 0) {
      metadataStr =
        ' ' +
        Object.entries(metadata)
          .map(([key, value]) => `${key}:${value}`)
          .join(',');
    }

    return `\n>[!${type}]${metadataStr}\n${content
      .split('\n')
      .map(item => '>' + item)
      .join('\n')}\n\n`;
  }

  /**
   * Extracts conversation history from a conversation markdown file
   * @param conversationTitle The title of the conversation
   * @param maxMessages Maximum number of messages to include (default: 10)
   * @returns Array of conversation history messages
   */
  public async extractConversationHistory(
    conversationTitle: string,
    maxMessages = 10
  ): Promise<ConversationHistoryMessage[]> {
    try {
      // Get the conversation file
      const folderPath = `${this.plugin.settings.stewardFolder}/Conversations`;
      const notePath = `${folderPath}/${conversationTitle}.md`;
      const file = this.plugin.app.vault.getAbstractFileByPath(notePath) as TFile;

      if (!file) {
        throw new Error(`Note not found: ${notePath}`);
      }

      // Read the content
      const content = await this.plugin.app.vault.read(file);

      // Find all metadata blocks
      const metadataRegex = /<!--STW (.*?)-->/gi;
      const matches = Array.from(content.matchAll(metadataRegex));

      const messages: Array<ConversationHistoryMessage & { command: string }> = [];

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

        // Skip messages where HISTORY is explicitly set to 'false'
        if (metadata.HISTORY === 'false') {
          continue;
        }

        // Clean up the content based on role
        if (metadata.ROLE === 'user') {
          // Remove user role prefix and formatting, but keep command prefix
          messageContent = messageContent.replace(/^##### \*\*User:\*\* /m, '');
          messageContent = messageContent.replace(/\*\*User:\*\* /g, '');
        } else if (metadata.ROLE === 'steward') {
          // Remove steward role prefix and formatting
          messageContent = messageContent.replace(/^##### \*\*Steward:\*\* /m, '');
          messageContent = messageContent.replace(/\*\*Steward:\*\* /g, '');

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

        // Remove separator lines
        messageContent = messageContent.replace(/^---$/gm, '');

        // Remove loading indicators
        messageContent = messageContent.replace(/\*.*?\.\.\.\*$/gm, '');

        // Convert role from 'steward' to 'assistant'
        const role = metadata.ROLE === 'steward' ? 'assistant' : metadata.ROLE;

        messages.push({
          role: role as ConversationRole,
          content: messageContent.trim(),
          command: metadata.COMMAND || '',
        });
      }

      // Find the index of the most recent topic change
      const continuationCommands = [' ', 'confirm', 'thank_you'];
      let topicStartIndex = 0;

      for (let i = messages.length - 1; i >= 0; i--) {
        const message = messages[i];

        if (message.role === 'user' && !continuationCommands.includes(message.command)) {
          // Found a message that starts a new topic
          topicStartIndex = i;
          break;
        }
      }

      // Get messages from the latest topic
      const topicMessages = messages.slice(topicStartIndex);

      // Return the messages without the command property
      return topicMessages.slice(-maxMessages).map(({ role, content }) => ({
        role,
        content,
      }));
    } catch (error) {
      logger.error('Error extracting conversation history:', error);
      return [];
    }
  }
}
