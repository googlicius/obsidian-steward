import { TFile, normalizePath } from 'obsidian';
import { z } from 'zod/v3';
import type StewardPlugin from 'src/main';
import { MarkdownDefinitionService } from '../MarkdownDefinitionService';
import type { ParsedYamlFenceBlock } from '../MarkdownDefinitionService/types';
import { getBundledInternal } from 'src/utils/bundledInternals';
import { logger } from 'src/utils/logger';
import {
  widgetActionsSchema,
  widgetActorsSchema,
  widgetAgentSchema,
  widgetManifestSchema,
  widgetQueriesSchema,
  type WidgetAgent,
  type WidgetDefinition,
  type WidgetIframeActorsConfig,
} from './types';

const EMPTY_WIDGET_DEFINITION: WidgetDefinition = {
  manifest: null,
  actions: null,
  queries: null,
  actors: null,
  agents: {},
};

const { i18next } = getBundledInternal('i18n');

interface CollectedDefinitionBlocks {
  manifestBlocks: ParsedYamlFenceBlock[];
  actionsBlocks: ParsedYamlFenceBlock[];
  queriesBlocks: ParsedYamlFenceBlock[];
  actorsBlocks: ParsedYamlFenceBlock[];
  agentBlocks: ParsedYamlFenceBlock[];
  parseErrors: string[];
}

interface WidgetDefinitionValidationResult {
  valid: boolean;
  errors: string[];
  statusMessage: string;
}

/**
 * All logic for the widget project definition note (`Definition.md`): read blocks, validate, frontmatter status.
 */
export class WidgetDefinitionService {
  private static instance: WidgetDefinitionService | null = null;
  private initialized = false;

  private constructor(private readonly plugin: StewardPlugin) {}

  public static getInstance(plugin: StewardPlugin): WidgetDefinitionService {
    if (!WidgetDefinitionService.instance) {
      WidgetDefinitionService.instance = new WidgetDefinitionService(plugin);
    }
    return WidgetDefinitionService.instance;
  }

  /** Registers metadata cache listeners for Definition.md validation. */
  public initialize(): void {
    if (this.initialized) {
      return;
    }

    this.initialized = true;

    this.plugin.registerEvent(
      this.plugin.app.metadataCache.on('changed', file => {
        if (!(file instanceof TFile)) {
          return;
        }
        if (!this.isWidgetDefinitionPath(file.path)) {
          return;
        }

        void this.validateAndUpdateFrontmatter(file);
      })
    );
  }

  public buildStatusMessage(valid: boolean, errors?: string[]): string {
    if (valid) {
      return i18next.t('common.statusValid');
    }

    const combinedErrors = (errors ?? []).join('; ');
    return i18next.t('common.statusInvalid', { errors: combinedErrors });
  }

  /** Whether a vault path is the Definition.md definition file inside a widget project. */
  private isWidgetDefinitionPath(filePath: string): boolean {
    const normalized = normalizePath(filePath);
    if (!normalized.endsWith('/Definition.md')) {
      return false;
    }

    const root = this.getWidgetsRootPath();
    return normalized.startsWith(`${root}/`);
  }

  private readStatusFromFrontmatter(file: TFile): string | undefined {
    const fileCache = this.plugin.app.metadataCache.getFileCache(file);
    const statusRaw = fileCache?.frontmatter?.status;
    return typeof statusRaw === 'string' ? statusRaw : undefined;
  }

  /**
   * Reads frontmatter validation status for edited Definition.md paths (no validation trigger).
   * May be stale if the metadata cache handler has not run yet.
   */
  public readEditedDefinitionStatusFromFrontmatter(filePaths: string[]): string | undefined {
    const validStatus = this.buildStatusMessage(true);
    const messages: string[] = [];

    for (let i = 0; i < filePaths.length; i++) {
      const filePath = filePaths[i];
      if (!this.isWidgetDefinitionPath(filePath)) {
        continue;
      }

      const file = this.plugin.app.vault.getFileByPath(filePath);
      if (!file) {
        continue;
      }

      const statusMessage = this.readStatusFromFrontmatter(file);
      if (!statusMessage || statusMessage === validStatus) {
        continue;
      }

      messages.push(`${filePath}: ${statusMessage}`);
    }

    if (messages.length === 0) {
      return undefined;
    }

    return messages.join('\n');
  }

  private validateContent(params: {
    content: string;
    file: TFile;
  }): WidgetDefinitionValidationResult {
    const collected = this.collectDefinitionBlocks(params);
    return this.validateCollectedBlocks({ collected, file: params.file });
  }

  private async validateAndUpdateFrontmatter(
    file: TFile
  ): Promise<WidgetDefinitionValidationResult> {
    const content = await this.plugin.app.vault.read(file);
    const validation = this.validateContent({ content, file });
    await this.applyValidationFrontmatter(file, validation);
    return validation;
  }

  /** Reads manifest, actions, actors, and agent blocks from Definition.md in one vault read. */
  public async getWidgetDefinition(projectPath: string): Promise<WidgetDefinition> {
    const file = this.getDefinitionFile(projectPath);
    if (!file) {
      return EMPTY_WIDGET_DEFINITION;
    }

    try {
      const content = await this.plugin.app.vault.read(file);
      const collected = this.collectDefinitionBlocks({ content, file });
      return this.parseDefinitionForRead({ collected, file });
    } catch (error) {
      logger.error('Failed to read widget definition:', error);
      return EMPTY_WIDGET_DEFINITION;
    }
  }

  /** Read-only actors roster from Definition.md for iframe injection via window.stw.getActors(). */
  public async getIframeActorsConfig(
    projectPath: string
  ): Promise<WidgetIframeActorsConfig | null> {
    const definition = await this.getWidgetDefinition(projectPath);
    const actors = definition.actors;
    if (!actors) {
      return null;
    }

    const turnOrder: string[] = [];
    for (let i = 0; i < actors.turnOrder.length; i += 1) {
      turnOrder.push(actors.turnOrder[i]);
    }

    return {
      mode: actors.mode,
      turnOrder,
      actors: actors.actors,
    };
  }

  private get markdownDefinitionService(): MarkdownDefinitionService {
    return this.plugin.markdownDefinitionService;
  }

  private getWidgetsRootPath(): string {
    return normalizePath(`${this.plugin.settings.stewardFolder}/Widgets`);
  }

  private getDefinitionFile(projectPath: string): TFile | null {
    const definitionPath = normalizePath(`${projectPath}/Definition.md`);
    return this.plugin.app.vault.getFileByPath(definitionPath);
  }

  private collectDefinitionBlocks(params: {
    content: string;
    file: TFile;
  }): CollectedDefinitionBlocks {
    const collected: CollectedDefinitionBlocks = {
      manifestBlocks: [],
      actionsBlocks: [],
      queriesBlocks: [],
      actorsBlocks: [],
      agentBlocks: [],
      parseErrors: [],
    };

    const { blocks, parseErrors } = this.markdownDefinitionService.collectAllYamlBlocks({
      file: params.file,
      content: params.content,
    });

    for (let i = 0; i < parseErrors.length; i++) {
      const parseError = parseErrors[i];
      collected.parseErrors.push(`yaml fence at line ${parseError.line}: ${parseError.message}`);
    }

    for (let i = 0; i < blocks.length; i++) {
      this.routeBlockByName(blocks[i], collected);
    }

    return collected;
  }

  private parseDefinitionForRead(params: {
    collected: CollectedDefinitionBlocks;
    file: TFile;
  }): WidgetDefinition {
    const definition: WidgetDefinition = {
      manifest: null,
      actions: null,
      queries: null,
      actors: null,
      agents: {},
    };

    if (params.collected.manifestBlocks.length === 0) {
      logger.warn(`Widget manifest block not found in ${params.file.path}`);
    } else {
      const parsed = widgetManifestSchema.safeParse(params.collected.manifestBlocks[0].data);
      if (!parsed.success) {
        logger.warn('Invalid widget manifest YAML:', params.file.path, parsed.error.flatten());
      } else {
        definition.manifest = parsed.data;
      }
    }

    if (params.collected.actionsBlocks.length > 0) {
      const parsed = widgetActionsSchema.safeParse(params.collected.actionsBlocks[0].data);
      if (!parsed.success) {
        logger.warn('Invalid widget actions YAML:', params.file.path, parsed.error.flatten());
      } else {
        definition.actions = parsed.data;
      }
    }

    if (params.collected.queriesBlocks.length > 0) {
      const parsed = widgetQueriesSchema.safeParse(params.collected.queriesBlocks[0].data);
      if (!parsed.success) {
        logger.warn('Invalid widget queries YAML:', params.file.path, parsed.error.flatten());
      } else {
        definition.queries = parsed.data;
      }
    }

    if (params.collected.actorsBlocks.length > 0) {
      const parsed = widgetActorsSchema.safeParse(params.collected.actorsBlocks[0].data);
      if (!parsed.success) {
        logger.warn('Invalid widget actors YAML:', params.file.path, parsed.error.flatten());
      } else {
        definition.actors = parsed.data;
      }
    }

    for (let i = 0; i < params.collected.agentBlocks.length; i++) {
      const parsed = widgetAgentSchema.safeParse(params.collected.agentBlocks[i].data);
      if (!parsed.success) {
        logger.warn('Invalid widget agent YAML:', params.file.path, parsed.error.flatten());
        continue;
      }
      definition.agents[parsed.data.id] = parsed.data;
    }

    return definition;
  }

  private routeBlockByName(
    block: ParsedYamlFenceBlock,
    collected: CollectedDefinitionBlocks
  ): void {
    const nameRaw = block.data.name;
    if (typeof nameRaw !== 'string') {
      return;
    }

    if (nameRaw === 'manifest') {
      collected.manifestBlocks.push(block);
      return;
    }

    if (nameRaw === 'actions') {
      collected.actionsBlocks.push(block);
      return;
    }

    if (nameRaw === 'queries') {
      collected.queriesBlocks.push(block);
      return;
    }

    if (nameRaw === 'actors') {
      collected.actorsBlocks.push(block);
      return;
    }

    if (nameRaw === 'agent') {
      collected.agentBlocks.push(block);
    }
  }

  private validateCollectedBlocks(params: {
    collected: CollectedDefinitionBlocks;
    file?: TFile;
  }): WidgetDefinitionValidationResult {
    const errors: string[] = [...params.collected.parseErrors];

    const manifestResults = this.parseManifestBlocks(params.collected.manifestBlocks, errors);
    const actionsResults = this.parseActionsBlocks(params.collected.actionsBlocks, errors);
    const queriesResults = this.parseQueriesBlocks(params.collected.queriesBlocks, errors);
    const actorsResult = this.parseActorsBlock(params.collected.actorsBlocks, errors);
    const agentResults = this.parseAgentBlocks(params.collected.agentBlocks, errors);

    if (manifestResults.length === 0) {
      errors.push('manifest: required block is missing or invalid');
    } else if (manifestResults.length > 1) {
      errors.push('manifest: only one manifest block is allowed');
    }

    if (actionsResults.length > 1) {
      errors.push('actions: only one actions block is allowed');
    }

    if (queriesResults.length > 1) {
      errors.push('queries: only one queries block is allowed');
    }

    if (actorsResult.duplicate) {
      errors.push('actors: only one actors block is allowed');
    }

    const actions = actionsResults.length === 1 ? actionsResults[0] : null;
    const queries = queriesResults.length === 1 ? queriesResults[0] : null;
    const actors = actorsResult.actors;

    if (agentResults.agents.length > 0) {
      if (!actors) {
        errors.push('actors: required when agent blocks are present');
      }
      if (!actions) {
        errors.push('actions: required when agent blocks are present');
      }
    }

    this.validateCrossReferences({
      errors,
      actors,
      actions,
      queries,
      agents: agentResults.agents,
    });

    const valid = errors.length === 0;
    const statusMessage = this.buildStatusMessage(valid, valid ? undefined : errors);

    if (!valid && params.file) {
      logger.warn(`Invalid Definition.md definition at ${params.file.path}:`, errors);
    }

    return {
      valid,
      errors,
      statusMessage,
    };
  }

  private async applyValidationFrontmatter(
    file: TFile,
    validation: WidgetDefinitionValidationResult
  ): Promise<void> {
    const fileCache = this.plugin.app.metadataCache.getFileCache(file);
    const frontmatter = fileCache?.frontmatter ?? {};
    const currentStatusRaw = frontmatter.status;
    const currentStatus = typeof currentStatusRaw === 'string' ? currentStatusRaw : undefined;
    const enabledKeyMissing = !Object.prototype.hasOwnProperty.call(frontmatter, 'enabled');
    const needsStatusUpdate = currentStatus !== validation.statusMessage;
    const needsEnabledDefault = enabledKeyMissing;

    if (!needsStatusUpdate && !needsEnabledDefault) {
      return;
    }

    try {
      await this.plugin.app.fileManager.processFrontMatter(file, fm => {
        if (needsStatusUpdate) {
          fm.status = validation.statusMessage;
        }
        if (needsEnabledDefault) {
          fm.enabled = true;
        }
      });
    } catch (error) {
      logger.error(`Failed to update Definition.md frontmatter for ${file.path}`, error);
    }
  }

  private parseManifestBlocks(
    blocks: ParsedYamlFenceBlock[],
    errors: string[]
  ): Array<z.infer<typeof widgetManifestSchema>> {
    const results: Array<z.infer<typeof widgetManifestSchema>> = [];

    for (let i = 0; i < blocks.length; i++) {
      const parsed = widgetManifestSchema.safeParse(blocks[i].data);
      if (!parsed.success) {
        errors.push(...this.formatSchemaErrors('manifest', parsed.error));
        continue;
      }
      results.push(parsed.data);
    }

    return results;
  }

  private parseActionsBlocks(
    blocks: ParsedYamlFenceBlock[],
    errors: string[]
  ): Array<z.infer<typeof widgetActionsSchema>> {
    const results: Array<z.infer<typeof widgetActionsSchema>> = [];

    for (let i = 0; i < blocks.length; i++) {
      const parsed = widgetActionsSchema.safeParse(blocks[i].data);
      if (!parsed.success) {
        errors.push(...this.formatSchemaErrors('actions', parsed.error));
        continue;
      }
      results.push(parsed.data);
    }

    return results;
  }

  private parseQueriesBlocks(
    blocks: ParsedYamlFenceBlock[],
    errors: string[]
  ): Array<z.infer<typeof widgetQueriesSchema>> {
    const results: Array<z.infer<typeof widgetQueriesSchema>> = [];

    for (let i = 0; i < blocks.length; i++) {
      const parsed = widgetQueriesSchema.safeParse(blocks[i].data);
      if (!parsed.success) {
        errors.push(...this.formatSchemaErrors('queries', parsed.error));
        continue;
      }
      results.push(parsed.data);
    }

    return results;
  }

  private parseActorsBlock(
    blocks: ParsedYamlFenceBlock[],
    errors: string[]
  ): { actors: z.infer<typeof widgetActorsSchema> | null; duplicate: boolean } {
    if (blocks.length === 0) {
      return { actors: null, duplicate: false };
    }

    if (blocks.length > 1) {
      for (let i = 0; i < blocks.length; i++) {
        const parsed = widgetActorsSchema.safeParse(blocks[i].data);
        if (!parsed.success) {
          errors.push(...this.formatSchemaErrors('actors', parsed.error));
        }
      }
      return { actors: null, duplicate: true };
    }

    const parsed = widgetActorsSchema.safeParse(blocks[0].data);
    if (!parsed.success) {
      errors.push(...this.formatSchemaErrors('actors', parsed.error));
      return { actors: null, duplicate: false };
    }

    return { actors: parsed.data, duplicate: false };
  }

  private parseAgentBlocks(
    blocks: ParsedYamlFenceBlock[],
    errors: string[]
  ): { agents: WidgetAgent[] } {
    const agents: WidgetAgent[] = [];

    for (let i = 0; i < blocks.length; i++) {
      const parsed = widgetAgentSchema.safeParse(blocks[i].data);
      if (!parsed.success) {
        errors.push(...this.formatSchemaErrors(`agent[${i}]`, parsed.error));
        continue;
      }
      agents.push(parsed.data);
    }

    return { agents };
  }

  private validateCrossReferences(params: {
    errors: string[];
    actors: z.infer<typeof widgetActorsSchema> | null;
    actions: z.infer<typeof widgetActionsSchema> | null;
    queries: z.infer<typeof widgetQueriesSchema> | null;
    agents: WidgetAgent[];
  }): void {
    if (params.agents.length === 0) {
      return;
    }

    const agentIdsSeen = new Set<string>();
    for (let i = 0; i < params.agents.length; i++) {
      const agent = params.agents[i];
      if (agentIdsSeen.has(agent.id)) {
        params.errors.push(`agent: duplicate id "${agent.id}"`);
      }
      agentIdsSeen.add(agent.id);
    }

    if (!params.actors) {
      return;
    }

    const actorIds = Object.keys(params.actors.actors);
    const modelActorIds: string[] = [];
    for (let i = 0; i < actorIds.length; i++) {
      const actorId = actorIds[i];
      if (params.actors.actors[actorId].kind === 'model') {
        modelActorIds.push(actorId);
      }
    }

    if (modelActorIds.length === 0) {
      params.errors.push('actors: at least one model actor is required when agent blocks exist');
    }

    for (let i = 0; i < params.actors.turnOrder.length; i++) {
      const turnActorId = params.actors.turnOrder[i];
      if (!params.actors.actors[turnActorId]) {
        params.errors.push(`actors.turnOrder: unknown actor id "${turnActorId}"`);
      }
    }

    for (let i = 0; i < params.agents.length; i++) {
      const agent = params.agents[i];
      const actorEntry = params.actors.actors[agent.id];
      if (!actorEntry) {
        params.errors.push(`agent "${agent.id}": no matching entry in actors`);
        continue;
      }
      if (actorEntry.kind !== 'model') {
        params.errors.push(`agent "${agent.id}": actor kind must be model`);
      }
    }

    for (let i = 0; i < modelActorIds.length; i++) {
      const modelActorId = modelActorIds[i];
      let hasAgent = false;
      for (let j = 0; j < params.agents.length; j++) {
        if (params.agents[j].id === modelActorId) {
          hasAgent = true;
          break;
        }
      }
      if (!hasAgent) {
        params.errors.push(`actors: model actor "${modelActorId}" has no agent block`);
      }
    }

    if (!params.actions) {
      return;
    }

    const catalogActions = Object.keys(params.actions.actions);
    for (let i = 0; i < params.agents.length; i++) {
      const agent = params.agents[i];
      for (let j = 0; j < agent.actions.length; j++) {
        const actionName = agent.actions[j];
        if (!catalogActions.includes(actionName)) {
          params.errors.push(
            `agent "${agent.id}": action "${actionName}" is not defined in actions catalog`
          );
        }
      }
    }

    if (!params.queries) {
      for (let i = 0; i < params.agents.length; i++) {
        const agentQueries = params.agents[i].queries;
        if (!agentQueries || agentQueries.length === 0) {
          continue;
        }
        params.errors.push(
          `agent "${params.agents[i].id}": queries block is required when agent lists queries`
        );
      }
      return;
    }

    const catalogQueries = Object.keys(params.queries.queries);
    for (let i = 0; i < params.agents.length; i++) {
      const agent = params.agents[i];
      const agentQueries = agent.queries ?? [];
      for (let j = 0; j < agentQueries.length; j++) {
        const queryName = agentQueries[j];
        if (!catalogQueries.includes(queryName)) {
          params.errors.push(
            `agent "${agent.id}": query "${queryName}" is not defined in queries catalog`
          );
        }
      }
    }
  }

  private formatSchemaErrors(prefix: string, error: z.ZodError): string[] {
    const messages: string[] = [];
    for (let i = 0; i < error.issues.length; i++) {
      const issue = error.issues[i];
      const path = issue.path.length > 0 ? `${issue.path.join('.')}: ` : '';
      messages.push(`${prefix}: ${path}${issue.message}`);
    }
    return messages;
  }
}
