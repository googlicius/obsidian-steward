import { type SuperAgent } from '../SuperAgent';
import { ToolCallPart } from '../../tools/types';
import { AgentHandlerParams, AgentResult, IntentResultStatus } from '../../types';
import { createEditTool, EditArgs } from '../../tools/editContent';
import { ArtifactType } from 'src/solutions/artifact';
import { EditOperation } from 'src/solutions/commands/tools/editContent';
import { MarkdownUtil } from 'src/utils/markdownUtils';
import { getTranslation } from 'src/i18n';
import { logger } from 'src/utils/logger';

export class EditHandler {
  constructor(private readonly agent: SuperAgent) {}

  public static getEditTool(contentType: 'in_the_note' | 'in_the_chat') {
    const { editTool } = createEditTool({ contentType });
    return editTool;
  }

  public async handle(
    params: AgentHandlerParams,
    options: { toolCall: ToolCallPart<EditArgs> }
  ): Promise<AgentResult> {
    const { title, intent, lang } = params;
    const { toolCall } = options;
    const t = getTranslation(lang);

    if (!params.handlerId) {
      throw new Error('EditEdit.handle invoked without handlerId');
    }

    // Render explanation
    if (toolCall.input.explanation) {
      await this.agent.renderer.updateConversationNote({
        path: title,
        newContent: toolCall.input.explanation,
        command: 'edit',
        lang,
        handlerId: params.handlerId,
      });
    }

    // Get the most recent artifact of type read_content or generated_content
    const artifact = await this.agent.plugin.artifactManagerV2
      .withTitle(title)
      .getMostRecentArtifactOfTypes([ArtifactType.READ_CONTENT, ArtifactType.GENERATED_CONTENT]);

    // Determine contentType based on artifact type
    const contentType =
      artifact?.artifactType === ArtifactType.GENERATED_CONTENT ? 'in_the_chat' : 'in_the_note';

    const { execute: editToolExecute } = createEditTool({ contentType });

    // Get the file to edit
    const file = toolCall.input.filePath
      ? await this.agent.plugin.mediaTools.findFileByNameOrPath(toolCall.input.filePath)
      : this.agent.plugin.app.workspace.getActiveFile();

    if (!file) {
      throw new Error('No file provided');
    }

    // Render what will be updated if the artifact type is read_content
    if (artifact?.artifactType === ArtifactType.READ_CONTENT) {
      // Get file content for preview
      const fileContent = await this.agent.app.vault.read(file);

      for (const operation of toolCall.input.operations) {
        // Preview by applying the instruction to the current file content
        const contentToRender = this.agent.obsidianAPITools.applyUpdateInstruction(
          fileContent,
          operation,
          this.agent.plugin.noteContentService
        );

        if (contentToRender) {
          await this.agent.renderer.updateConversationNote({
            path: title,
            newContent: this.agent.plugin.noteContentService.formatCallout(
              contentToRender,
              'stw-search-result',
              {
                mdContent: new MarkdownUtil(contentToRender)
                  .escape(true)
                  .encodeForDataset()
                  .getText(),
              }
            ),
            includeHistory: false,
            lang,
            handlerId: params.handlerId,
          });
        }
      }
    }

    const updateInstructions = editToolExecute(toolCall.input);

    // Skip confirmation if no_confirm
    if (intent.no_confirm) {
      return this.performUpdate({
        title,
        filePath: file.path,
        updateInstructions,
        lang,
        handlerId: params.handlerId,
        step: params.invocationCount,
        toolCall,
      });
    }

    await this.agent.renderer.updateConversationNote({
      path: title,
      newContent: t('update.applyChangesConfirm'),
      command: 'edit',
      handlerId: params.handlerId,
      includeHistory: false,
    });

    // HandlerID cannot be undefined here. Bypass lint error when using in the callback.
    const handlerId = params.handlerId;

    return {
      status: IntentResultStatus.NEEDS_CONFIRMATION,
      confirmationMessage: t('update.applyChangesConfirm'),
      onConfirmation: () => {
        return this.performUpdate({
          title,
          filePath: file.path,
          updateInstructions,
          lang,
          handlerId,
          step: params.invocationCount,
          toolCall,
        });
      },
      onRejection: async () => {
        await this.agent.renderer.serializeToolInvocation({
          path: title,
          command: 'edit',
          handlerId,
          step: params.invocationCount,
          toolInvocations: [
            {
              ...toolCall,
              type: 'tool-result',
              output: {
                type: 'text',
                value: t('update.changesDenied'),
              },
            },
          ],
        });
        return {
          status: IntentResultStatus.SUCCESS,
        };
      },
    };
  }

  /**
   * Perform the actual update operation
   */
  private async performUpdate(params: {
    title: string;
    filePath: string;
    updateInstructions: EditOperation[];
    lang?: string | null;
    handlerId: string;
    step?: number;
    toolCall: ToolCallPart<EditArgs>;
  }): Promise<AgentResult> {
    const { title, filePath, updateInstructions, lang } = params;
    const t = getTranslation(lang);

    try {
      const file = await this.agent.plugin.mediaTools.findFileByNameOrPath(filePath);
      if (!file) {
        throw new Error(`File not found: ${filePath}`);
      }

      let contentChanged = false;

      // Apply update instructions and write back atomically
      await this.agent.app.vault.process(file, content => {
        // Apply each update instruction in sequence
        for (const instruction of updateInstructions) {
          const result = this.agent.obsidianAPITools.applyUpdateInstruction(
            content,
            instruction,
            this.agent.plugin.noteContentService
          );

          if (result !== content) {
            content = result;
            contentChanged = true;
          }
        }

        return content;
      });

      if (!contentChanged) {
        logger.log(`Skipping ${filePath} because it didn't change`);
        await this.agent.renderer.updateConversationNote({
          path: title,
          newContent: t('update.skipped', { count: 1 }),
          command: 'edit',
          handlerId: params.handlerId,
        });
        return {
          status: IntentResultStatus.SUCCESS,
        };
      }

      // Format the success result
      const response = `**${t('update.successfullyUpdated', { count: 1 })}**\n- [[${filePath}]]`;

      const messageId = await this.agent.renderer.updateConversationNote({
        path: title,
        newContent: response,
        command: 'edit',
        handlerId: params.handlerId,
        includeHistory: false,
      });

      // Serialize the tool invocation
      await this.agent.renderer.serializeToolInvocation({
        path: title,
        command: 'edit',
        handlerId: params.handlerId,
        step: params.step,
        toolInvocations: [
          {
            ...params.toolCall,
            type: 'tool-result',
            output: {
              type: 'text',
              value: messageId ? `messageRef:${messageId}` : response,
            },
          },
        ],
      });

      return {
        status: IntentResultStatus.SUCCESS,
      };
    } catch (error) {
      await this.agent.renderer.updateConversationNote({
        path: title,
        newContent: `Error updating file: ${error instanceof Error ? error.message : String(error)}`,
        command: 'edit',
        handlerId: params.handlerId,
        step: params.step,
      });

      return {
        status: IntentResultStatus.ERROR,
        error: error instanceof Error ? error : new Error(String(error)),
      };
    }
  }
}
