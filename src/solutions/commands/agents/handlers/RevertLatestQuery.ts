import { z } from 'zod/v3';
import { getBundledLib } from 'src/utils/bundledLibs';
import { getTranslation } from 'src/i18n';
import { Artifact, ArtifactType, Change } from 'src/solutions/artifact';
import type { AgentHandlerContext } from '../AgentHandlerContext';
import { logger } from 'src/utils/logger';
import { ToolCallPart } from '../../tools/types';
import { AgentHandlerParams, AgentResult, IntentResultStatus } from '../../types';
import { SysError } from 'src/utils/errors';

const revertSchema = z.object({
  explanation: z
    .string()
    .min(1)
    .optional()
    .describe('A short explanation of why the latest user query should be reverted.'),
});

export type RevertToolArgs = z.infer<typeof revertSchema>;

type RevertCandidate = {
  noteTitle: string;
  artifact: Artifact;
  sequence: number;
  source: 'parent' | 'subagent';
};

type RevertExecutionResult = {
  revertedFiles: string[];
  failedFiles: string[];
};

type FailedArtifactSummary = {
  artifactType: ArtifactType;
  artifactId?: string;
  noteTitle: string;
};

export class RevertLatestQuery {
  constructor(private readonly agent: AgentHandlerContext) {}

  public static async getRevertTool() {
    const { tool } = await getBundledLib('ai');
    return tool({
      inputSchema: revertSchema,
    });
  }

  public async handle(
    params: AgentHandlerParams,
    options: { toolCall: ToolCallPart<RevertToolArgs> }
  ): Promise<AgentResult> {
    const { title, lang, handlerId } = params;
    const { toolCall } = options;
    const t = getTranslation(lang);

    if (!handlerId) {
      throw new SysError('RevertLatestQuery.handle invoked without handlerId');
    }

    if (toolCall.input.explanation) {
      await this.agent.renderer.updateConversationNote({
        path: title,
        newContent: toolCall.input.explanation,
        command: 'revert',
        includeHistory: false,
        lang,
        handlerId,
      });
    }

    const candidates = await this.collectRevertCandidates({ title });
    if (candidates.length === 0) {
      const noOpsMessage = t('revert.noOperationsInLatestQuery');
      const messageId = await this.agent.renderer.updateConversationNote({
        path: title,
        newContent: noOpsMessage,
        command: 'revert',
        includeHistory: false,
        lang,
        handlerId,
      });
      await this.agent.serializeInvocation({
        command: 'revert',
        title,
        handlerId,
        toolCall,
        result: {
          type: 'error-text',
          value: messageId ? `messageRef:${messageId}` : noOpsMessage,
        },
      });
      return {
        status: IntentResultStatus.ERROR,
        error: new Error(noOpsMessage),
      };
    }

    const sortedCandidates = this.sortCandidatesNewestFirst({ candidates });
    const summary = await this.executeCandidates({
      candidates: sortedCandidates,
      explanation: toolCall.input.explanation ?? t('revert.revertingLatestQuery'),
    });

    const response = this.buildResultMessage({
      lang,
      summary,
      totalArtifacts: sortedCandidates.length,
    });

    const messageId = await this.agent.renderer.updateConversationNote({
      path: title,
      newContent: response,
      command: 'revert',
      includeHistory: false,
      lang,
      handlerId,
    });

    await this.agent.serializeInvocation({
      command: 'revert',
      title,
      handlerId,
      toolCall,
      result: {
        type: 'text',
        value: messageId ? `messageRef:${messageId}` : response,
      },
    });

    return {
      status: IntentResultStatus.SUCCESS,
    };
  }

  private async collectRevertCandidates(params: { title: string }): Promise<RevertCandidate[]> {
    const { title } = params;
    const allMessages = await this.agent.renderer.extractAllConversationMessages(title);
    // Assume the latest 2 messages are noise for revert collection
    // (typically: latest user "revert" + assistant acknowledgement).
    const endExclusive = Math.max(0, allMessages.length - 2);
    if (endExclusive <= 0) {
      return [];
    }

    const candidates: RevertCandidate[] = [];
    let sequence = 0;
    const parentArtifactMap = await this.loadRevertableArtifactsByMessageId({ title });
    const parentArtifactIds: string[] = [];
    const childTitlesSet = new Set<string>();

    // One pass: collect parent artifact IDs and subagent child titles.
    for (let i = 0; i < endExclusive; i += 1) {
      const message = allMessages[i];
      if (message?.id && message.type === 'artifact') {
        parentArtifactIds.push(message.id);
      }

      if (!message?.content) {
        continue;
      }
      const childTitles = this.extractChildTitles({ content: message.content });
      for (const childTitle of childTitles) {
        childTitlesSet.add(childTitle);
      }
    }

    for (const artifactId of parentArtifactIds) {
      const artifact = parentArtifactMap.get(artifactId);
      if (!artifact || artifact.deleteReason) {
        continue;
      }
      sequence += 1;
      candidates.push({
        noteTitle: title,
        artifact,
        source: 'parent',
        sequence,
      });
    }

    for (const childTitle of childTitlesSet) {
      const childMessages = await this.agent.renderer.extractAllConversationMessages(childTitle);
      if (childMessages.length === 0) {
        continue;
      }
      const childArtifactMap = await this.loadRevertableArtifactsByMessageId({ title: childTitle });
      for (const childMessage of childMessages) {
        if (!childMessage?.id || childMessage.type !== 'artifact') {
          continue;
        }
        const childArtifact = childArtifactMap.get(childMessage.id);
        if (!childArtifact || childArtifact.deleteReason) {
          continue;
        }
        sequence += 1;
        candidates.push({
          noteTitle: childTitle,
          artifact: childArtifact,
          source: 'subagent',
          sequence,
        });
      }
    }

    return candidates;
  }

  private async loadRevertableArtifactsByMessageId(params: {
    title: string;
  }): Promise<Map<string, Artifact>> {
    const artifacts = await this.agent.plugin.artifactManagerV2
      .withTitle(params.title)
      .getAllRevertableArtifacts();

    const artifactMap = new Map<string, Artifact>();
    for (const artifact of artifacts) {
      if (!artifact.messageId) {
        continue;
      }
      artifactMap.set(artifact.messageId, artifact);
    }
    return artifactMap;
  }

  private extractChildTitles(params: { content: string }): string[] {
    const titles: string[] = [];
    const embedRegex = /!\[\[([^\]]*__subagent_[^\]]+)\]\]/g;
    const matches = Array.from(params.content.matchAll(embedRegex));

    for (const match of matches) {
      const title = match[1]?.trim();
      if (!title) {
        continue;
      }
      titles.push(title);
    }

    return titles;
  }

  private sortCandidatesNewestFirst(params: { candidates: RevertCandidate[] }): RevertCandidate[] {
    const sorted = [...params.candidates];
    sorted.sort((left, right) => {
      const leftCreatedAt = left.artifact.createdAt;
      const rightCreatedAt = right.artifact.createdAt;
      if (typeof leftCreatedAt === 'number' && typeof rightCreatedAt === 'number') {
        if (leftCreatedAt !== rightCreatedAt) {
          return rightCreatedAt - leftCreatedAt;
        }
      } else if (typeof leftCreatedAt === 'number') {
        return -1;
      } else if (typeof rightCreatedAt === 'number') {
        return 1;
      }
      return right.sequence - left.sequence;
    });
    return sorted;
  }

  private async executeCandidates(params: {
    candidates: RevertCandidate[];
    explanation: string;
  }): Promise<{
    revertedFiles: string[];
    failedFiles: string[];
    revertedArtifacts: number;
    failedArtifacts: FailedArtifactSummary[];
  }> {
    const revertedFiles: string[] = [];
    const failedFiles: string[] = [];
    let revertedArtifacts = 0;
    const failedArtifacts: FailedArtifactSummary[] = [];

    for (const candidate of params.candidates) {
      const execution = await this.revertArtifact({ candidate });
      if (execution.revertedFiles.length > 0) {
        revertedArtifacts += 1;
        revertedFiles.push(...execution.revertedFiles);
      }
      if (execution.failedFiles.length > 0) {
        failedFiles.push(...execution.failedFiles);
        failedArtifacts.push({
          artifactType: candidate.artifact.artifactType,
          artifactId: candidate.artifact.id,
          noteTitle: candidate.noteTitle,
        });
      }

      const removableArtifactId = candidate.artifact.messageId || candidate.artifact.id;
      if (removableArtifactId && execution.revertedFiles.length > 0) {
        await this.agent.plugin.artifactManagerV2
          .withTitle(candidate.noteTitle)
          .removeArtifact(removableArtifactId, params.explanation);
      }
    }

    return {
      revertedFiles,
      failedFiles,
      revertedArtifacts,
      failedArtifacts,
    };
  }

  private buildResultMessage(params: {
    lang?: string | null;
    summary: {
      revertedFiles: string[];
      failedFiles: string[];
      revertedArtifacts: number;
      failedArtifacts: FailedArtifactSummary[];
    };
    totalArtifacts: number;
  }): string {
    const t = getTranslation(params.lang);
    const lines: string[] = [];
    lines.push(
      `**${t('revert.latestQuerySummary', {
        revertedArtifacts: params.summary.revertedArtifacts,
        totalArtifacts: params.totalArtifacts,
      })}**`
    );

    if (params.summary.revertedFiles.length > 0) {
      lines.push(
        `\n**${t('revert.successfullyReverted', { count: params.summary.revertedFiles.length })}**`
      );
    }

    if (params.summary.failedFiles.length > 0) {
      lines.push(`\n**${t('revert.failed', { count: params.summary.failedFiles.length })}**`);
      for (const failedFile of params.summary.failedFiles) {
        lines.push(`- \`${failedFile}\``);
      }
    }

    if (params.summary.failedArtifacts.length > 0) {
      lines.push(`\n**${t('revert.failedArtifactsHeader')}**`);
      for (const failedArtifact of params.summary.failedArtifacts) {
        const id = failedArtifact.artifactId || 'unknown';
        lines.push(`- \`${failedArtifact.artifactType}\` (${failedArtifact.noteTitle}) [${id}]`);
      }
    }

    return lines.join('\n');
  }

  private async revertArtifact(params: {
    candidate: RevertCandidate;
  }): Promise<RevertExecutionResult> {
    const { candidate } = params;
    switch (candidate.artifact.artifactType) {
      case ArtifactType.CREATED_PATHS:
        return this.revertCreatedPathsArtifact({ artifact: candidate.artifact });
      case ArtifactType.RENAME_RESULTS:
        return this.revertRenameArtifact({ artifact: candidate.artifact });
      case ArtifactType.MOVE_RESULTS:
        return this.revertMoveArtifact({ artifact: candidate.artifact });
      case ArtifactType.UPDATE_FRONTMATTER_RESULTS:
        return this.revertFrontmatterArtifact({ artifact: candidate.artifact });
      case ArtifactType.EDIT_RESULTS:
        return this.revertEditArtifact({ artifact: candidate.artifact });
      case ArtifactType.DELETED_FILES:
        return this.revertDeletedFilesArtifact({ artifact: candidate.artifact });
      default:
        return { revertedFiles: [], failedFiles: [] };
    }
  }

  private async revertCreatedPathsArtifact(params: {
    artifact: Artifact;
  }): Promise<RevertExecutionResult> {
    if (params.artifact.artifactType !== ArtifactType.CREATED_PATHS) {
      return { revertedFiles: [], failedFiles: [] };
    }

    const revertedFiles: string[] = [];
    const failedFiles: string[] = [];
    const sortedPaths = [...params.artifact.paths].sort(
      (left, right) => right.length - left.length
    );

    for (const filePath of sortedPaths) {
      const resolved = await this.agent.plugin.vaultService.resolvePathExistence(filePath);
      if (!resolved.exists) {
        revertedFiles.push(filePath);
        continue;
      }
      try {
        await this.agent.plugin.vaultService.delete(filePath);
        revertedFiles.push(filePath);
      } catch (error) {
        logger.error(`Error reverting created path ${filePath}:`, error);
        failedFiles.push(filePath);
      }
    }

    return { revertedFiles, failedFiles };
  }

  private async revertRenameArtifact(params: {
    artifact: Artifact;
  }): Promise<RevertExecutionResult> {
    if (params.artifact.artifactType !== ArtifactType.RENAME_RESULTS) {
      return { revertedFiles: [], failedFiles: [] };
    }

    const revertedFiles: string[] = [];
    const failedFiles: string[] = [];

    for (const [originalPath, renamedPath] of params.artifact.renames) {
      const source = await this.agent.plugin.vaultService.resolvePathExistence(renamedPath);
      if (!source.exists || source.type !== 'file') {
        failedFiles.push(renamedPath);
        continue;
      }
      const dest = await this.agent.plugin.vaultService.resolvePathExistence(originalPath);
      if (dest.exists) {
        failedFiles.push(originalPath);
        continue;
      }
      try {
        const originalFolder = originalPath.substring(0, originalPath.lastIndexOf('/'));
        if (originalFolder) {
          await this.agent.obsidianAPITools.ensureFolderExists(originalFolder);
        }
        await this.agent.plugin.vaultService.rename(renamedPath, originalPath);
        revertedFiles.push(originalPath);
      } catch (error) {
        logger.error(`Error reverting rename ${renamedPath} -> ${originalPath}:`, error);
        failedFiles.push(renamedPath);
      }
    }

    return { revertedFiles, failedFiles };
  }

  private async revertMoveArtifact(params: { artifact: Artifact }): Promise<RevertExecutionResult> {
    if (params.artifact.artifactType !== ArtifactType.MOVE_RESULTS) {
      return { revertedFiles: [], failedFiles: [] };
    }

    const revertedFiles: string[] = [];
    const failedFiles: string[] = [];

    for (const [originalPath, movedPath] of params.artifact.moves) {
      const file = this.agent.app.vault.getFileByPath(movedPath);
      const folder = this.agent.app.vault.getFolderByPath(movedPath);
      if (!file && !folder) {
        failedFiles.push(movedPath);
        continue;
      }
      if (
        this.agent.app.vault.getFileByPath(originalPath) ||
        this.agent.app.vault.getFolderByPath(originalPath)
      ) {
        failedFiles.push(originalPath);
        continue;
      }
      try {
        const originalFolder = originalPath.substring(0, originalPath.lastIndexOf('/'));
        if (originalFolder) {
          await this.agent.obsidianAPITools.ensureFolderExists(originalFolder);
        }
        const itemToMove = file || folder;
        if (!itemToMove) {
          failedFiles.push(movedPath);
          continue;
        }
        await this.agent.app.fileManager.renameFile(itemToMove, originalPath);
        revertedFiles.push(originalPath);
      } catch (error) {
        logger.error(`Error reverting move ${movedPath} -> ${originalPath}:`, error);
        failedFiles.push(movedPath);
      }
    }

    return { revertedFiles, failedFiles };
  }

  private async revertFrontmatterArtifact(params: {
    artifact: Artifact;
  }): Promise<RevertExecutionResult> {
    if (params.artifact.artifactType !== ArtifactType.UPDATE_FRONTMATTER_RESULTS) {
      return { revertedFiles: [], failedFiles: [] };
    }

    const revertedFiles: string[] = [];
    const failedFiles: string[] = [];

    for (const update of params.artifact.updates) {
      const file = this.agent.app.vault.getFileByPath(update.path);
      if (!file) {
        failedFiles.push(update.path);
        continue;
      }
      try {
        await this.agent.app.fileManager.processFrontMatter(file, frontmatter => {
          const currentKeys = Object.keys(frontmatter);
          for (const key of currentKeys) {
            delete frontmatter[key];
          }
          Object.assign(frontmatter, update.original);
        });
        revertedFiles.push(update.path);
      } catch (error) {
        logger.error(`Error reverting frontmatter for ${update.path}:`, error);
        failedFiles.push(update.path);
      }
    }

    return { revertedFiles, failedFiles };
  }

  private async revertDeletedFilesArtifact(params: {
    artifact: Artifact;
  }): Promise<RevertExecutionResult> {
    if (params.artifact.artifactType !== ArtifactType.DELETED_FILES || !params.artifact.id) {
      return { revertedFiles: [], failedFiles: [] };
    }

    const metadata = await this.agent.plugin.trashCleanupService.getAllMetadata();
    const revertedFiles: string[] = [];
    const failedFiles: string[] = [];
    const trashPaths: string[] = [];

    for (const [trashPath, info] of Object.entries(metadata.files)) {
      if (info.artifactId !== params.artifact.id) {
        continue;
      }
      trashPaths.push(trashPath);
    }

    for (const trashPath of trashPaths) {
      const fileMetadata = await this.agent.plugin.trashCleanupService.getFileMetadata(trashPath);
      if (!fileMetadata) {
        failedFiles.push(trashPath);
        continue;
      }
      const inTrash = await this.agent.plugin.vaultService.resolvePathExistence(trashPath);
      if (!inTrash.exists || inTrash.type !== 'file') {
        failedFiles.push(trashPath);
        continue;
      }
      const originalOccupied = await this.agent.plugin.vaultService.resolvePathExistence(
        fileMetadata.originalPath
      );
      if (originalOccupied.exists) {
        failedFiles.push(fileMetadata.originalPath);
        continue;
      }
      try {
        const folderPath = fileMetadata.originalPath.substring(
          0,
          fileMetadata.originalPath.lastIndexOf('/')
        );
        if (folderPath) {
          await this.agent.obsidianAPITools.ensureFolderExists(folderPath);
        }
        await this.agent.plugin.vaultService.rename(trashPath, fileMetadata.originalPath);
        await this.agent.plugin.trashCleanupService.removeFileFromTrash(trashPath);
        revertedFiles.push(fileMetadata.originalPath);
      } catch (error) {
        logger.error(`Error reverting deleted file ${trashPath}:`, error);
        failedFiles.push(trashPath);
      }
    }

    return { revertedFiles, failedFiles };
  }

  private async revertEditArtifact(params: { artifact: Artifact }): Promise<RevertExecutionResult> {
    if (params.artifact.artifactType !== ArtifactType.EDIT_RESULTS) {
      return { revertedFiles: [], failedFiles: [] };
    }

    const revertedFiles: string[] = [];
    const failedFiles: string[] = [];

    for (const fileChangeSet of params.artifact.files) {
      const file = this.agent.app.vault.getFileByPath(fileChangeSet.path);
      if (!file) {
        failedFiles.push(fileChangeSet.path);
        continue;
      }

      try {
        await this.agent.app.vault.process(file, currentContent => {
          let revertedContent = currentContent;
          const reversedChanges = [...fileChangeSet.changes].reverse();
          for (const change of reversedChanges) {
            revertedContent = this.applyRevertChange({
              content: revertedContent,
              change,
            });
          }
          return revertedContent;
        });
        revertedFiles.push(fileChangeSet.path);
      } catch (error) {
        logger.error(`Error reverting edits for ${fileChangeSet.path}:`, error);
        failedFiles.push(fileChangeSet.path);
      }
    }

    return { revertedFiles, failedFiles };
  }

  private applyRevertChange(params: { content: string; change: Change }): string {
    const { content, change } = params;
    if (!change.newContent) {
      if (!change.originalContent) {
        return content;
      }
      return this.insertContentAtPosition({ content, change });
    }
    if (!change.originalContent) {
      return this.removeContent({ content, change });
    }
    return this.replaceContent({ content, change });
  }

  private insertContentAtPosition(params: { content: string; change: Change }): string {
    const { content, change } = params;
    if (!change.originalContent) {
      return content;
    }

    const lines = content.split('\n');
    const originalLines = change.originalContent.split('\n');

    if (change.contextBefore) {
      const beforeLines = change.contextBefore.trim().split('\n');
      const lastBeforeLine = beforeLines[beforeLines.length - 1];
      for (let i = 0; i < lines.length; i += 1) {
        if (!lines[i].includes(lastBeforeLine)) {
          continue;
        }
        lines.splice(i + 1, 0, ...originalLines);
        return lines.join('\n');
      }
    }

    const insertPosition = Math.min(Math.max(0, change.startLine), lines.length);
    lines.splice(insertPosition, 0, ...originalLines);
    return lines.join('\n');
  }

  private removeContent(params: { content: string; change: Change }): string {
    const { change } = params;
    const escapedContent = this.escapeRegex({ value: change.newContent });
    const pattern = new RegExp(`(\\n?)${escapedContent}(\\n?)`);
    return params.content.replace(pattern, (_match, before, after) => {
      if (before && after) {
        return '\n';
      }
      return '';
    });
  }

  private replaceContent(params: { content: string; change: Change }): string {
    const { change } = params;
    if (change.contextBefore || change.contextAfter) {
      const beforeContext = (change.contextBefore || '').trim();
      const afterContext = (change.contextAfter || '').trim();
      const newContent = change.newContent.trim();
      const originalContent = change.originalContent.trim();

      let pattern = this.escapeRegex({ value: newContent });
      if (beforeContext && afterContext) {
        pattern = `${this.escapeRegex({ value: beforeContext })}\\s*${this.escapeRegex({ value: newContent })}\\s*${this.escapeRegex({ value: afterContext })}`;
      } else if (beforeContext) {
        pattern = `${this.escapeRegex({ value: beforeContext })}\\s*${this.escapeRegex({ value: newContent })}`;
      } else if (afterContext) {
        pattern = `${this.escapeRegex({ value: newContent })}\\s*${this.escapeRegex({ value: afterContext })}`;
      }

      const regex = new RegExp(pattern, 's');
      if (regex.test(params.content)) {
        if (beforeContext && afterContext) {
          return params.content.replace(
            regex,
            `${beforeContext}\n${originalContent}\n${afterContext}`
          );
        }
        if (beforeContext) {
          return params.content.replace(regex, `${beforeContext}\n${originalContent}`);
        }
        if (afterContext) {
          return params.content.replace(regex, `${originalContent}\n${afterContext}`);
        }
      }
    }

    return params.content.replace(change.newContent, change.originalContent);
  }

  private escapeRegex(params: { value: string }): string {
    return params.value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
}
