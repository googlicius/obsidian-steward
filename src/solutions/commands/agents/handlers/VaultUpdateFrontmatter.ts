import { tool } from 'ai';
import { z } from 'zod/v3';
import { TFile, TFolder } from 'obsidian';
import { getTranslation } from 'src/i18n';
import { ArtifactType } from 'src/solutions/artifact';
import { logger } from 'src/utils/logger';
import { type SuperAgent } from '../SuperAgent';
import { ToolCallPart } from '../../tools/types';
import { AgentHandlerParams, AgentResult, IntentResultStatus } from '../../types';
import {
  createArtifactIdSchema,
  createFilesSchemaString,
  createFilePatternsSchema,
} from './vaultOperationSchemas';

const frontmatterPropertySchema = z
  .object({
    name: z.string().min(1).describe('The name of the frontmatter property.'),
    value: z
      .union([z.string(), z.number(), z.boolean(), z.array(z.string()), z.null()])
      .optional()
      .describe('The value to set for the property. Omit or set null to delete the property.'),
  })
  .describe(
    'A frontmatter property operation (add/update if value is provided, delete if omitted).'
  );

const updateFrontmatterToolSchema = z
  .object({
    artifactId: createArtifactIdSchema({
      description: 'The artifact identifier containing files to update frontmatter for.',
    }),
    files: createFilesSchemaString({
      description: 'The list of file paths (including extension) to update frontmatter for.',
    }),
    folders: z
      .object({
        paths: z
          .array(z.string().min(1))
          .min(1)
          .describe(
            'The list of folder paths to update frontmatter for all markdown files within.'
          ),
        recursive: z
          .boolean()
          .default(false)
          .describe(
            'Whether to recursively process subfolders. Use only when the user EXPLICITLY requests it. Defaults to false.'
          ),
      })
      .optional()
      .describe(
        'Folder-based file selection. Processes all markdown files within the specified folders.'
      ),
    filePatterns: createFilePatternsSchema({
      description:
        'Pattern-based file selection for large file sets. Prefer this over the files array to avoid token limits.',
      patternsDescription: 'Array of RegExp patterns to match files for updating frontmatter.',
    }),
    properties: z
      .array(frontmatterPropertySchema)
      .min(1)
      .describe(
        'The list of frontmatter properties to add, update, or delete for all specified files.'
      ),
  })
  .refine(
    data =>
      Boolean(data.artifactId) ||
      Boolean(data.files && data.files.length > 0) ||
      Boolean(data.folders && data.folders.paths && data.folders.paths.length > 0) ||
      Boolean(
        data.filePatterns && data.filePatterns.patterns && data.filePatterns.patterns.length > 0
      ),
    {
      message: 'Provide either artifactId, files, folders, or filePatterns.',
    }
  )
  .refine(
    data =>
      !(
        data.files &&
        data.files.length > 0 &&
        data.filePatterns &&
        data.filePatterns.patterns &&
        data.filePatterns.patterns.length > 0
      ),
    {
      message: 'Provide either files or filePatterns, not both.',
    }
  );

export type UpdateFrontmatterToolArgs = z.infer<typeof updateFrontmatterToolSchema>;

type FileWithProperties = {
  path: string;
  properties: Array<{
    name: string;
    value?: string | number | boolean | string[] | null;
  }>;
};

export class VaultUpdateFrontmatter {
  private static readonly updateFrontmatterTool = tool({
    inputSchema: updateFrontmatterToolSchema,
  });

  constructor(private readonly agent: SuperAgent) {}

  public static getUpdateFrontmatterTool() {
    return VaultUpdateFrontmatter.updateFrontmatterTool;
  }

  public async handle(
    params: AgentHandlerParams,
    options: { toolCall: ToolCallPart<UpdateFrontmatterToolArgs> }
  ): Promise<AgentResult> {
    const { toolCall } = options;
    const t = getTranslation(params.lang);

    if (!params.handlerId) {
      throw new Error('VaultUpdateFrontmatter.handle invoked without handlerId');
    }

    const resolveResult = await this.resolveFiles({
      title: params.title,
      toolCall,
      lang: params.lang,
      handlerId: params.handlerId,
    });

    if (resolveResult.errorMessage) {
      return {
        status: IntentResultStatus.ERROR,
        error: new Error(resolveResult.errorMessage),
      };
    }

    const filesToUpdate = resolveResult.files;

    if (filesToUpdate.length === 0) {
      return {
        status: IntentResultStatus.ERROR,
        error: new Error(t('common.noFilesFound')),
      };
    }

    const updateResult = await this.executeFrontmatterUpdates({
      title: params.title,
      files: filesToUpdate,
    });

    const formattedMessage = this.formatUpdateResult({
      result: updateResult,
      lang: params.lang,
    });

    await this.agent.renderer.updateConversationNote({
      path: params.title,
      newContent: formattedMessage,
      command: 'vault_update_frontmatter',
      lang: params.lang,
      handlerId: params.handlerId,
      step: params.invocationCount,
      includeHistory: false,
    });

    // Store frontmatter update results as an artifact
    const artifactId = `frontmatter_update_${Date.now()}`;
    await this.agent.plugin.artifactManagerV2.withTitle(params.title).storeArtifact({
      artifact: {
        artifactType: ArtifactType.UPDATE_FRONTMATTER_RESULTS,
        updates: updateResult.updates,
        id: artifactId,
        createdAt: Date.now(),
      },
    });

    await this.agent.serializeInvocation({
      command: 'vault_update_frontmatter',
      title: params.title,
      handlerId: params.handlerId,
      step: params.invocationCount,
      toolCall,
      result: {
        type: 'text',
        value: formattedMessage,
      },
    });

    return {
      status: IntentResultStatus.SUCCESS,
    };
  }

  /**
   * Get all markdown files from a folder, optionally recursively
   */
  private getMarkdownFilesFromFolder(folder: TFolder, recursive = false): TFile[] {
    const markdownFiles: TFile[] = [];

    for (const child of folder.children) {
      if (child instanceof TFile && child.extension === 'md') {
        markdownFiles.push(child);
      } else if (child instanceof TFolder && recursive) {
        // Recursively process subfolders only if recursive is true
        markdownFiles.push(...this.getMarkdownFilesFromFolder(child, recursive));
      }
    }

    return markdownFiles;
  }

  private async resolveFiles(params: {
    title: string;
    toolCall: ToolCallPart<UpdateFrontmatterToolArgs>;
    lang?: string | null;
    handlerId: string;
    step?: number;
  }): Promise<{ files: FileWithProperties[]; errorMessage?: string }> {
    const t = getTranslation(params.lang);

    const noFilesMessage = t('common.noFilesFound');

    // Determine which files to update
    let filePathsToUpdate: string[] = [];

    if (params.toolCall.input.artifactId) {
      const artifactManager = this.agent.plugin.artifactManagerV2.withTitle(params.title);
      const resolvedFiles = await artifactManager.resolveFilesFromArtifact(
        params.toolCall.input.artifactId
      );

      if (resolvedFiles.length > 0) {
        // Extract paths from DocWithPath objects
        filePathsToUpdate.push(...resolvedFiles.map(file => file.path));
      }
    }

    // Collect files from files array
    if (params.toolCall.input.files) {
      for (const filePath of params.toolCall.input.files) {
        const trimmedPath = filePath.trim();
        if (trimmedPath) {
          filePathsToUpdate.push(trimmedPath);
        }
      }
    }

    // Collect files from folders
    if (params.toolCall.input.folders) {
      const recursive = params.toolCall.input.folders.recursive ?? false;
      for (const folderPath of params.toolCall.input.folders.paths) {
        const trimmedPath = folderPath.trim();
        if (!trimmedPath) {
          continue;
        }

        const folder = this.agent.app.vault.getFolderByPath(trimmedPath);
        if (!folder) {
          logger.warn(`Folder not found: ${trimmedPath}`);
          continue;
        }

        const markdownFiles = this.getMarkdownFilesFromFolder(folder, recursive);
        for (const file of markdownFiles) {
          filePathsToUpdate.push(file.path);
        }
      }
    }

    // Collect files from filePatterns
    if (params.toolCall.input.filePatterns) {
      const patternMatchedPaths = this.agent.obsidianAPITools.resolveFilePatterns(
        params.toolCall.input.filePatterns.patterns,
        params.toolCall.input.filePatterns.folder
      );
      // Only include markdown files from patterns
      for (const path of patternMatchedPaths) {
        const file = this.agent.app.vault.getFileByPath(path);
        if (file && file.extension === 'md') {
          filePathsToUpdate.push(path);
        }
      }
    }

    // Remove duplicates
    filePathsToUpdate = [...new Set(filePathsToUpdate)];

    // Combine files with properties
    const filesToUpdate: FileWithProperties[] = filePathsToUpdate.map(path => ({
      path,
      properties: params.toolCall.input.properties,
    }));

    if (filesToUpdate.length === 0) {
      const noFilesMessageId = await this.agent.renderer.updateConversationNote({
        path: params.title,
        newContent: noFilesMessage,
        command: 'vault_update_frontmatter',
        lang: params.lang,
        handlerId: params.handlerId,
        step: params.step,
        includeHistory: false,
      });

      await this.agent.serializeInvocation({
        command: 'vault_update_frontmatter',
        title: params.title,
        handlerId: params.handlerId,
        toolCall: params.toolCall,
        step: params.step,
        result: {
          type: 'error-text',
          value: noFilesMessageId ? `messageRef:${noFilesMessageId}` : noFilesMessage,
        },
      });

      return { files: [], errorMessage: noFilesMessage };
    }

    return { files: filesToUpdate };
  }

  private async executeFrontmatterUpdates(params: {
    title: string;
    files: FileWithProperties[];
  }): Promise<{
    updated: string[];
    failed: Array<{ path: string; error: string }>;
    updates: Array<{
      path: string;
      original: Record<string, unknown>;
      updated: Record<string, unknown>;
    }>;
  }> {
    const { files } = params;
    const updated: string[] = [];
    const failed: Array<{ path: string; error: string }> = [];
    const updates: Array<{
      path: string;
      original: Record<string, unknown>;
      updated: Record<string, unknown>;
    }> = [];

    for (const fileToUpdate of files) {
      const file = this.agent.app.vault.getFileByPath(fileToUpdate.path);

      if (!file) {
        failed.push({
          path: fileToUpdate.path,
          error: 'File not found',
        });
        continue;
      }

      try {
        // Process the updates to actually modify the file
        await this.agent.app.fileManager.processFrontMatter(
          file,
          (frontmatter: Record<string, unknown>) => {
            // Capture the original frontmatter before updating
            const original = { ...frontmatter };

            // Apply the updates
            for (const property of fileToUpdate.properties) {
              if (property.value === undefined || property.value === null) {
                delete frontmatter[property.name];
              } else {
                frontmatter[property.name] = property.value;
              }
            }

            updates.push({
              path: fileToUpdate.path,
              original,
              updated: frontmatter,
            });
          }
        );

        updated.push(fileToUpdate.path);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        logger.error(`Error updating frontmatter for ${fileToUpdate.path}:`, error);
        failed.push({
          path: fileToUpdate.path,
          error: errorMessage,
        });
      }
    }

    return { updated, failed, updates };
  }

  private formatUpdateResult(params: {
    result: { updated: string[]; failed: Array<{ path: string; error: string }> };
    lang?: string | null;
  }): string {
    const { result, lang } = params;
    const { updated, failed } = result;
    const t = getTranslation(lang);

    const totalCount = updated.length + failed.length;
    let response = t('update.foundFiles', { count: totalCount });

    if (updated.length > 0) {
      response += `\n\n**${t('update.successfullyUpdated', { count: updated.length })}**`;
      response += `\n<!--stw-tool-hidden-start-->`;
      for (const filePath of updated) {
        response += `\n- [[${filePath}]]`;
      }
      response += `\n<!--stw-tool-hidden-end-->`;
    }

    if (failed.length > 0) {
      response += `\n\n**${t('update.failed', { count: failed.length })}**`;
      for (const failure of failed) {
        response += `\n- [[${failure.path}]]: ${failure.error}`;
      }
    }

    return response;
  }
}
