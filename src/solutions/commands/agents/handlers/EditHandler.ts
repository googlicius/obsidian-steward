import { normalizePath, TFile } from 'obsidian';
import type { AgentHandlerContext } from '../AgentHandlerContext';
import type { HandlerInvocationContext } from '../HandlerInvocationContext';
import { type ToolContentStreamInfo } from '../components';
import { ToolCallPart } from '../../tools/types';
import { AgentResult, IntentResultStatus } from '../../types';
import { createEditTool, EditArgs } from '../../tools/editContent';
import { ArtifactType, Change, FileChangeSet } from 'src/solutions/artifact';
import { EditOperation } from 'src/solutions/commands/tools/editContent';
import { getBundledInternal } from 'src/utils/bundledInternals';
import { logger } from 'src/utils/logger';

const { getTranslation } = getBundledInternal('i18n');

export class EditHandler {
  constructor(private readonly agent: AgentHandlerContext) {}

  public static async getEditTool(contentType: 'in_the_note' | 'in_the_chat') {
    const { editTool } = await createEditTool({ contentType });
    return editTool;
  }

  public extractPathsForGuardrails(input: EditArgs): string[] {
    const paths: string[] = [];
    for (const op of input.operations) {
      if ('path' in op && typeof op.path === 'string' && op.path) {
        paths.push(normalizePath(op.path));
      }
    }
    return paths;
  }

  public async handle(
    ctx: HandlerInvocationContext,
    options: {
      toolCall: ToolCallPart<EditArgs>;
      toolContentStreamInfo?: ToolContentStreamInfo;
      continueFromNextTool?: () => Promise<AgentResult>;
    }
  ): Promise<AgentResult> {
    const { title, intent, lang } = ctx.agentHandlerParams;
    const { toolCall, toolContentStreamInfo, continueFromNextTool } = options;
    const t = getTranslation(lang);

    // Render explanation
    if (toolCall.input.explanation) {
      await ctx.updateConversationNote({
        newContent: toolCall.input.explanation,
        command: 'edit',
      });
    }

    // Get the most recent artifact of type read_content or search_results
    const artifact = await this.agent.plugin.artifactManagerV2
      .withTitle(title)
      .getMostRecentArtifactOfTypes([ArtifactType.READ_CONTENT, ArtifactType.SEARCH_RESULTS]);

    // Determine contentType based on artifact type
    const contentType =
      artifact?.artifactType === ArtifactType.GENERATED_CONTENT ? 'in_the_chat' : 'in_the_note';

    const { execute: editToolExecute } = await createEditTool({ contentType });
    const operations = editToolExecute(toolCall.input);

    // Group operations by file - resolve all files that will be edited
    const filesToOperations = await this.groupOperationsByFile(title, operations);

    if (filesToOperations.size === 0) {
      // Clean up temp file if streaming was active
      if (toolContentStreamInfo) {
        await this.agent.deleteTempStreamFile(toolContentStreamInfo.tempFilePath);
      }
      throw new Error('No files found to edit');
    }

    // If streaming was active, replace the temp embed callout with the final computed preview.
    // Otherwise, render preview normally.
    if (toolContentStreamInfo) {
      await this.replaceStreamedPreview(ctx, {
        filesToOperations,
        toolContentStreamInfo,
      });
    } else {
      await this.renderPreview(ctx, { filesToOperations });
    }

    // Skip confirmation if no_confirm
    if (intent.no_confirm) {
      return this.performUpdate({
        title,
        filesToOperations,
        lang,
        handlerId: ctx.handlerId,
        step: ctx.step,
        toolCall,
      });
    }

    await ctx.updateConversationNote({
      newContent: t('update.applyChangesConfirm'),
      command: 'edit',
      includeHistory: false,
    });

    const handlerId = ctx.handlerId;

    return {
      status: IntentResultStatus.NEEDS_CONFIRMATION,
      confirmationMessage: t('update.applyChangesConfirm'),
      toolCall: options.toolCall,
      onConfirmation: () => {
        return this.performUpdate({
          title,
          filesToOperations,
          lang,
          handlerId,
          step: ctx.step,
          toolCall,
          continueFromNextTool,
        });
      },
      onRejection: async () => {
        await this.agent.renderer.serializeToolInvocation({
          path: title,
          command: 'edit',
          handlerId,
          step: ctx.step,
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

        if (continueFromNextTool) {
          return continueFromNextTool();
        }

        return {
          status: IntentResultStatus.SUCCESS,
        };
      },
    };
  }

  /**
   * Group operations by file path
   * Handles both single-file operations (with path) and multi-file operations (replace_by_pattern)
   */
  private async groupOperationsByFile(
    title: string,
    operations: EditOperation[]
  ): Promise<Map<string, EditOperation[]>> {
    const filesToOperations = new Map<string, EditOperation[]>();

    const addIfResolvedFile = async (pathStr: string, operation: EditOperation) => {
      const normalized = normalizePath(pathStr);
      const resolved = await this.agent.plugin.vaultService.resolvePathExistence(normalized);
      if (resolved.exists && resolved.type === 'file') {
        const ops = filesToOperations.get(resolved.path) || [];
        ops.push(operation);
        filesToOperations.set(resolved.path, ops);
      }
    };

    for (const operation of operations) {
      if (operation.mode === 'replace_by_pattern') {
        if (operation.path) {
          await addIfResolvedFile(operation.path, operation);
        } else if (operation.artifactId) {
          const artifactManager = this.agent.plugin.artifactManagerV2.withTitle(title);
          const resolvedFiles = await artifactManager.resolveFilesFromArtifact(
            operation.artifactId
          );

          for (const doc of resolvedFiles) {
            await addIfResolvedFile(doc.path, operation);
          }
        }
      } else if ('path' in operation) {
        await addIfResolvedFile(operation.path, operation);
      }
    }

    return filesToOperations;
  }

  /**
   * Perform the actual update operation for multiple files
   */
  private async performUpdate(params: {
    title: string;
    filesToOperations: Map<string, EditOperation[]>;
    lang?: string | null;
    handlerId: string;
    step?: number;
    toolCall: ToolCallPart<EditArgs>;
    continueFromNextTool?: () => Promise<AgentResult>;
  }): Promise<AgentResult> {
    const { title, filesToOperations, lang, continueFromNextTool } = params;
    const t = getTranslation(lang);

    const updatedFiles: string[] = [];
    const skippedFiles: string[] = [];
    const failedFiles: Array<{ path: string; error: string }> = [];
    const allFileChangeSets: FileChangeSet[] = [];

    // Process each file
    for (const [filePath, fileOperations] of filesToOperations.entries()) {
      try {
        const resolvedFile = await this.agent.plugin.vaultService.resolvePathExistence(filePath);
        if (!resolvedFile.exists) {
          failedFiles.push({ path: filePath, error: 'File not found' });
          continue;
        }

        // Track changes and apply updates atomically
        let fileChangeSet: FileChangeSet | null = null;

        if (resolvedFile.abstractFile && resolvedFile.abstractFile instanceof TFile) {
          const file = resolvedFile.abstractFile;

          await this.agent.app.vault.process(file, currentContent => {
            // Compute changes based on current file content
            const { modifiedContent, changes } =
              this.agent.plugin.noteContentService.computeChanges(currentContent, fileOperations);

            // Check if content actually changed
            const normalizedOriginal = this.normalizeContent(currentContent);
            const normalizedModified = this.normalizeContent(modifiedContent);
            const contentChanged = normalizedOriginal !== normalizedModified;

            if (!contentChanged) {
              // Return original content if no changes
              return currentContent;
            }

            // Store changes for artifact creation
            if (changes.length > 0) {
              fileChangeSet = {
                path: filePath,
                changes,
              };
            }

            // Return the modified content
            return normalizedModified;
          });
        } else if (resolvedFile.type === 'file') {
          const adapter = this.agent.app.vault.adapter;
          const currentContent = await adapter.read(filePath);
          const { modifiedContent, changes } = this.agent.plugin.noteContentService.computeChanges(
            currentContent,
            fileOperations
          );
          const normalizedOriginal = this.normalizeContent(currentContent);
          const normalizedModified = this.normalizeContent(modifiedContent);
          const contentChanged = normalizedOriginal !== normalizedModified;

          if (contentChanged && changes.length > 0) {
            fileChangeSet = {
              path: filePath,
              changes,
            };
            await adapter.write(filePath, normalizedModified);
          }
        } else {
          failedFiles.push({
            path: filePath,
            error:
              resolvedFile.type === 'folder'
                ? 'Path is a folder, not a file'
                : 'Cannot edit this path',
          });
          continue;
        }

        if (fileChangeSet) {
          updatedFiles.push(filePath);
          allFileChangeSets.push(fileChangeSet);
        } else {
          skippedFiles.push(filePath);
          logger.log(`Skipping ${filePath} because it didn't change`);
        }
      } catch (error) {
        failedFiles.push({
          path: filePath,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    const jsErrors = await this.agent.plugin.widgetService.validateWrittenJsFiles(updatedFiles);
    const lintError =
      jsErrors.length > 0
        ? this.agent.plugin.widgetService.jsValidator.formatErrors(jsErrors)
        : undefined;

    const widgetValidationError =
      this.agent.plugin.widgetService.definitionService.readEditedDefinitionStatusFromFrontmatter(
        updatedFiles
      );

    const hasToolWarnings = lintError || widgetValidationError;

    // Store edit results as an artifact for revert capability (if any files were updated)
    if (allFileChangeSets.length > 0) {
      await this.agent.plugin.artifactManagerV2.withTitle(title).storeArtifact({
        artifact: {
          artifactType: ArtifactType.EDIT_RESULTS,
          files: allFileChangeSets,
          createdAt: Date.now(),
        },
      });
    }

    // Build response message
    let response = '';

    if (updatedFiles.length > 0) {
      response += `**${t('update.successfullyUpdated', { count: updatedFiles.length })}**`;
      for (const path of updatedFiles) {
        response += `\n- [[${path}]]`;
      }
    }

    if (skippedFiles.length > 0) {
      if (response) response += '\n\n';
      response += t('update.skipped', { count: skippedFiles.length });
    }

    if (failedFiles.length > 0) {
      if (response) response += '\n\n';
      response += `**${t('update.failed', { count: failedFiles.length })}**`;
      for (const { path, error } of failedFiles) {
        response += `\n- [[${path}]]: ${error}`;
      }
    }

    const messageId = await this.agent.renderer.updateConversationNote({
      path: title,
      newContent: response,
      command: 'edit',
      handlerId: params.handlerId,
      includeHistory: false,
    });

    // Serialize the tool invocation
    const resultMessage = messageId ? `messageRef:${messageId}` : response;
    await this.agent.renderer.serializeToolInvocation({
      path: title,
      command: 'edit',
      handlerId: params.handlerId,
      step: params.step,
      toolInvocations: [
        {
          ...params.toolCall,
          type: 'tool-result',
          output: hasToolWarnings
            ? {
                type: 'error-json',
                value: {
                  lintError,
                  widgetValidationError,
                  message: resultMessage,
                },
              }
            : {
                type: 'text',
                value: resultMessage,
              },
        },
      ],
    });

    if (continueFromNextTool) {
      return continueFromNextTool();
    }

    if (lintError || widgetValidationError) {
      return {
        status: IntentResultStatus.SUCCESS,
      };
    }

    return {
      status: failedFiles.length > 0 ? IntentResultStatus.ERROR : IntentResultStatus.SUCCESS,
      error:
        failedFiles.length > 0
          ? new Error(`Failed to update ${failedFiles.length} files`)
          : undefined,
    };
  }

  /**
   * Read plaintext for edit preview / apply. Uses the vault TFile when indexed; otherwise the adapter (hidden paths).
   */
  private async readFileTextForEdit(filePath: string): Promise<string | null> {
    const resolved = await this.agent.plugin.vaultService.resolvePathExistence(filePath);
    if (!resolved.exists || resolved.type !== 'file') {
      return null;
    }
    if (resolved.abstractFile instanceof TFile) {
      return this.agent.app.vault.cachedRead(resolved.abstractFile);
    }
    return this.agent.app.vault.adapter.read(filePath);
  }

  /**
   * Render preview for all files (non-streaming path)
   */
  private async renderPreview(
    ctx: HandlerInvocationContext,
    params: {
      filesToOperations: Map<string, EditOperation[]>;
    }
  ): Promise<void> {
    const { filesToOperations } = params;
    const { lang } = ctx.agentHandlerParams;

    for (const [filePath, fileOperations] of filesToOperations.entries()) {
      const fileContent = await this.readFileTextForEdit(filePath);
      if (fileContent === null) continue;

      const { changes } = this.agent.plugin.noteContentService.computeChanges(
        fileContent,
        fileOperations
      );

      if (changes.length > 0) {
        const previewContent = this.renderChangesPreview(filePath, changes);
        await ctx.agent.renderer.updateConversationNote({
          path: ctx.title,
          newContent: previewContent,
          includeHistory: false,
          lang,
          handlerId: ctx.handlerId,
        });
      }
    }
  }

  /**
   * Replace the streamed temp file embed with the final computed preview.
   * The callout with `![[temp_file]]` was already rendered during streaming.
   */
  private async replaceStreamedPreview(
    ctx: HandlerInvocationContext,
    params: {
      filesToOperations: Map<string, EditOperation[]>;
      toolContentStreamInfo: ToolContentStreamInfo;
    }
  ): Promise<void> {
    const { filesToOperations, toolContentStreamInfo } = params;

    // Build the final preview content for all files
    const callouts: string[] = [];
    for (const [filePath, fileOperations] of filesToOperations.entries()) {
      const fileContent = await this.readFileTextForEdit(filePath);
      if (fileContent === null) continue;

      const { changes } = this.agent.plugin.noteContentService.computeChanges(
        fileContent,
        fileOperations
      );

      if (changes.length > 0) {
        callouts.push(this.renderChangesPreview(filePath, changes));
      }
    }

    const finalPreview = callouts.join('\n\n');

    // Replace the temp embed callout with the final preview in the conversation note
    const tempEmbed = this.agent.plugin.noteContentService.formatCallout(
      `![[${toolContentStreamInfo.tempFilePath}]]`,
      'stw-review',
      { streaming: 'true' }
    );

    if (finalPreview) {
      await ctx.updateConversationNote({
        newContent: finalPreview,
        replacePlaceHolder: tempEmbed,
        includeHistory: false,
      });
    }

    // Delete the temp file
    await this.agent.deleteTempStreamFile(toolContentStreamInfo.tempFilePath);
  }

  /**
   * Render changes preview for display
   */
  private renderChangesPreview(filePath: string, changes: Change[]): string {
    const language = this.getCodeFenceLanguage(filePath);
    let preview = `**File:** [[${filePath}]]\n\n`;

    for (let i = 0; i < changes.length; i++) {
      const change = changes[i];
      const lineRange =
        change.startLine === change.endLine
          ? `Line ${change.startLine + 1}`
          : `Lines ${change.startLine + 1}-${change.endLine + 1}`;

      preview += `**Change ${i + 1}** (${lineRange}, ${change.mode}):\n\n`;

      if (change.newContent) {
        preview += `${this.wrapInCodeFence(change.newContent, language)}\n\n`;
      }
    }

    return this.agent.plugin.noteContentService.formatCallout(preview.trim(), 'stw-review');
  }

  private getCodeFenceLanguage(filePath: string): string {
    const fileName = filePath.split('/').pop() ?? filePath;
    const dotIndex = fileName.lastIndexOf('.');
    if (dotIndex <= 0) {
      return 'text';
    }
    return fileName.slice(dotIndex + 1).toLowerCase();
  }

  /**
   * Wrap in a 4-backtick fence that allows nested fences.
   */
  private wrapInCodeFence(content: string, language: string): string {
    return `\`\`\`\`${language}\n${content}\n\`\`\`\``;
  }

  /**
   * Normalize content similar to previous applyUpdateInstruction behavior:
   * - trim
   * - drop leading/trailing empty lines
   * - ensure trailing newline
   */
  private normalizeContent(content: string): string {
    const lines = content.trim().split('\n');
    while (lines[0]?.trim() === '') {
      lines.shift();
    }
    while (lines[lines.length - 1]?.trim() === '') {
      lines.pop();
    }
    return lines.join('\n') + '\n';
  }
}
