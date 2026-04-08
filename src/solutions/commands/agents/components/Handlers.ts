import { ToolName } from '../../ToolRegistry';
import * as handlers from '../handlers';
import type { AgentHandlerContext } from '../AgentHandlerContext';
import type { AgentHandlerParams, AgentResult } from '../../types';
import type { ToolCallPart } from '../../tools/types';

export interface StandardToolHandler {
  handle(
    params: AgentHandlerParams,
    options: {
      toolCall: ToolCallPart<unknown>;
      continueFromNextTool?: () => Promise<AgentResult>;
      toolContentStreamInfo?: unknown;
    }
  ): Promise<AgentResult>;
  extractPathsForGuardrails?(input: unknown): string[];
}

/**
 * Tool names that have path extraction for guardrails
 */
const GUARDRAILS_TOOL_NAMES: Set<ToolName> = new Set([
  ToolName.LIST,
  ToolName.SEARCH,
  ToolName.CREATE,
  ToolName.DELETE,
  ToolName.CONTENT_READING,
  ToolName.EDIT,
  ToolName.GREP,
  ToolName.EXISTS,
  ToolName.MOVE,
  ToolName.RENAME,
  ToolName.COPY,
  ToolName.UPDATE_FRONTMATTER,
]);

/**
 * All handlers are lazily declared in this class.
 * Agent-agnostic mixin that can be applied to any agent implementing AgentHandlerContext.
 */
export class Handlers {
  private _vaultCreate: handlers.VaultCreate;
  private _vaultMove: handlers.VaultMove;
  private _vaultCopy: handlers.VaultCopy;
  private _vaultDelete: handlers.VaultDelete;
  private _vaultList: handlers.VaultList;
  private _vaultRename: handlers.VaultRename;
  private _vaultUpdateFrontmatter: handlers.VaultUpdateFrontmatter;
  private _vaultGrep: handlers.VaultGrep;
  private _vaultExists: handlers.VaultExists;
  private _activateToolHandler: handlers.ActivateToolHandler;
  private _revertLatestQuery: handlers.RevertLatestQuery;
  private _readContent: handlers.ReadContent;
  private _editHandler: handlers.EditHandler;
  private _userConfirm: handlers.UserConfirm;
  private _help: handlers.Help;
  private _stop: handlers.Stop;
  private _thankYou: handlers.ThankYou;
  private _buildSearchIndex: handlers.BuildSearchIndex;
  private _search: handlers.Search;
  private _searchMore: handlers.SearchMore;
  private _speech: handlers.Speech;
  private _image: handlers.Image;
  private _todoList: handlers.TodoList;
  private _dynamic: handlers.Dynamic;
  private _spawnSubagent: handlers.SpawnSubagent;
  private _switchAgentCapacity: handlers.SwitchAgentCapacity;
  private _conclude: handlers.Conclude;
  private _getMostRecentArtifact: handlers.GetMostRecentArtifact;
  private _getArtifactById: handlers.GetArtifactById;
  private _recallCompactedContext: handlers.RecallCompactedContext;
  private _mcpToolHandler: handlers.McpToolHandler;

  protected getAgent(): AgentHandlerContext {
    return this as unknown as AgentHandlerContext;
  }

  public get vaultMove(): handlers.VaultMove {
    if (!this._vaultMove) this._vaultMove = new handlers.VaultMove(this.getAgent());
    return this._vaultMove;
  }

  public get vaultCopy(): handlers.VaultCopy {
    if (!this._vaultCopy) this._vaultCopy = new handlers.VaultCopy(this.getAgent());
    return this._vaultCopy;
  }

  public get vaultDelete(): handlers.VaultDelete {
    if (!this._vaultDelete) this._vaultDelete = new handlers.VaultDelete(this.getAgent());
    return this._vaultDelete;
  }

  public get vaultCreate(): handlers.VaultCreate {
    if (!this._vaultCreate) this._vaultCreate = new handlers.VaultCreate(this.getAgent());
    return this._vaultCreate;
  }

  public get vaultList(): handlers.VaultList {
    if (!this._vaultList) this._vaultList = new handlers.VaultList(this.getAgent());
    return this._vaultList;
  }

  public get vaultRename(): handlers.VaultRename {
    if (!this._vaultRename) this._vaultRename = new handlers.VaultRename(this.getAgent());
    return this._vaultRename;
  }

  public get vaultUpdateFrontmatter(): handlers.VaultUpdateFrontmatter {
    if (!this._vaultUpdateFrontmatter) {
      this._vaultUpdateFrontmatter = new handlers.VaultUpdateFrontmatter(this.getAgent());
    }
    return this._vaultUpdateFrontmatter;
  }

  public get vaultGrep(): handlers.VaultGrep {
    if (!this._vaultGrep) this._vaultGrep = new handlers.VaultGrep(this.getAgent());
    return this._vaultGrep;
  }

  public get vaultExists(): handlers.VaultExists {
    if (!this._vaultExists) this._vaultExists = new handlers.VaultExists(this.getAgent());
    return this._vaultExists;
  }

  public get activateToolHandler(): handlers.ActivateToolHandler {
    if (!this._activateToolHandler) {
      this._activateToolHandler = new handlers.ActivateToolHandler(this.getAgent().renderer);
    }
    return this._activateToolHandler;
  }

  public get revertLatestQuery(): handlers.RevertLatestQuery {
    if (!this._revertLatestQuery) {
      this._revertLatestQuery = new handlers.RevertLatestQuery(this.getAgent());
    }
    return this._revertLatestQuery;
  }

  public get readContent(): handlers.ReadContent {
    if (!this._readContent) this._readContent = new handlers.ReadContent(this.getAgent());
    return this._readContent;
  }

  public get editHandler(): handlers.EditHandler {
    if (!this._editHandler) this._editHandler = new handlers.EditHandler(this.getAgent());
    return this._editHandler;
  }

  public get userConfirm(): handlers.UserConfirm {
    if (!this._userConfirm) this._userConfirm = new handlers.UserConfirm(this.getAgent());
    return this._userConfirm;
  }

  public get help(): handlers.Help {
    if (!this._help) this._help = new handlers.Help(this.getAgent());
    return this._help;
  }

  public get stop(): handlers.Stop {
    if (!this._stop) this._stop = new handlers.Stop(this.getAgent());
    return this._stop;
  }

  public get thankYou(): handlers.ThankYou {
    if (!this._thankYou) this._thankYou = new handlers.ThankYou(this.getAgent());
    return this._thankYou;
  }

  public get buildSearchIndex(): handlers.BuildSearchIndex {
    if (!this._buildSearchIndex) {
      this._buildSearchIndex = new handlers.BuildSearchIndex(this.getAgent());
    }
    return this._buildSearchIndex;
  }

  public get search(): handlers.Search {
    if (!this._search) this._search = new handlers.Search(this.getAgent());
    return this._search;
  }

  public get searchMore(): handlers.SearchMore {
    if (!this._searchMore) this._searchMore = new handlers.SearchMore(this.getAgent(), this.search);
    return this._searchMore;
  }

  public get speech(): handlers.Speech {
    if (!this._speech) this._speech = new handlers.Speech(this.getAgent());
    return this._speech;
  }

  public get image(): handlers.Image {
    if (!this._image) this._image = new handlers.Image(this.getAgent());
    return this._image;
  }

  public get todoList(): handlers.TodoList {
    if (!this._todoList) this._todoList = new handlers.TodoList(this.getAgent());
    return this._todoList;
  }

  public get dynamic(): handlers.Dynamic {
    if (!this._dynamic) this._dynamic = new handlers.Dynamic(this.getAgent().renderer);
    return this._dynamic;
  }

  public get spawnSubagent(): handlers.SpawnSubagent {
    if (!this._spawnSubagent) this._spawnSubagent = new handlers.SpawnSubagent(this.getAgent());
    return this._spawnSubagent;
  }

  public get switchAgentCapacity(): handlers.SwitchAgentCapacity {
    if (!this._switchAgentCapacity) {
      this._switchAgentCapacity = new handlers.SwitchAgentCapacity(this.getAgent());
    }
    return this._switchAgentCapacity;
  }

  public get conclude(): handlers.Conclude {
    if (!this._conclude) this._conclude = new handlers.Conclude(this.getAgent());
    return this._conclude;
  }

  public get getMostRecentArtifact(): handlers.GetMostRecentArtifact {
    if (!this._getMostRecentArtifact) {
      this._getMostRecentArtifact = new handlers.GetMostRecentArtifact(this.getAgent());
    }
    return this._getMostRecentArtifact;
  }

  public get getArtifactById(): handlers.GetArtifactById {
    if (!this._getArtifactById)
      this._getArtifactById = new handlers.GetArtifactById(this.getAgent());
    return this._getArtifactById;
  }

  public get recallCompactedContext(): handlers.RecallCompactedContext {
    if (!this._recallCompactedContext) {
      this._recallCompactedContext = new handlers.RecallCompactedContext(this.getAgent());
    }
    return this._recallCompactedContext;
  }

  public get mcpToolHandler(): handlers.McpToolHandler {
    if (!this._mcpToolHandler) {
      this._mcpToolHandler = new handlers.McpToolHandler(this.getAgent());
    }
    return this._mcpToolHandler;
  }

  /**
   * Map of tool names to their standard handlers.
   */
  public getToolHandlerMap(): Partial<Record<ToolName, () => StandardToolHandler>> {
    return {
      [ToolName.CONTENT_READING]: () => this.readContent,
      [ToolName.LIST]: () => this.vaultList,
      [ToolName.CREATE]: () => this.vaultCreate,
      [ToolName.DELETE]: () => this.vaultDelete,
      [ToolName.COPY]: () => this.vaultCopy,
      [ToolName.RENAME]: () => this.vaultRename,
      [ToolName.MOVE]: () => this.vaultMove,
      [ToolName.UPDATE_FRONTMATTER]: () => this.vaultUpdateFrontmatter,
      [ToolName.GREP]: () => this.vaultGrep,
      [ToolName.EXISTS]: () => this.vaultExists,
      [ToolName.REVERT]: () => this.revertLatestQuery,
      [ToolName.USER_CONFIRM]: () => this.userConfirm,
      [ToolName.EDIT]: () => this.editHandler,
      [ToolName.STOP]: () => this.stop,
      [ToolName.THANK_YOU]: () => this.thankYou,
      [ToolName.BUILD_SEARCH_INDEX]: () => this.buildSearchIndex,
      [ToolName.SEARCH]: () => this.search,
      [ToolName.SEARCH_MORE]: () => this.searchMore,
      [ToolName.SPEECH]: () => this.speech,
      [ToolName.IMAGE]: () => this.image,
      [ToolName.TODO_WRITE]: () => this.todoList,
      [ToolName.HELP]: () => this.help,
      [ToolName.SPAWN_SUBAGENT]: () => this.spawnSubagent,
      [ToolName.CONCLUDE]: () => this.conclude,
      [ToolName.GET_MOST_RECENT_ARTIFACT]: () => this.getMostRecentArtifact,
      [ToolName.GET_ARTIFACT_BY_ID]: () => this.getArtifactById,
      [ToolName.RECALL_COMPACTED_CONTEXT]: () => this.recallCompactedContext,
      [ToolName.SWITCH_AGENT_CAPACITY]: () => this.switchAgentCapacity,
    };
  }

  /**
   * Extract paths from tool input for guardrails checks.
   * Uses lazy-loaded handlers; only loads the handler for the given tool.
   */
  public getPathsForGuardrails(toolName: ToolName, input: unknown): string[] {
    if (!GUARDRAILS_TOOL_NAMES.has(toolName)) return [];

    const handlerGetters: Partial<
      Record<ToolName, () => { extractPathsForGuardrails(input: unknown): string[] }>
    > = {
      [ToolName.LIST]: () => this.vaultList,
      [ToolName.SEARCH]: () => this.search,
      [ToolName.CREATE]: () => this.vaultCreate,
      [ToolName.DELETE]: () => this.vaultDelete,
      [ToolName.CONTENT_READING]: () => this.readContent,
      [ToolName.EDIT]: () => this.editHandler,
      [ToolName.GREP]: () => this.vaultGrep,
      [ToolName.EXISTS]: () => this.vaultExists,
      [ToolName.MOVE]: () => this.vaultMove,
      [ToolName.RENAME]: () => this.vaultRename,
      [ToolName.COPY]: () => this.vaultCopy,
      [ToolName.UPDATE_FRONTMATTER]: () => this.vaultUpdateFrontmatter,
    };

    const getter = handlerGetters[toolName];
    if (!getter) return [];

    const handler = getter();
    return handler.extractPathsForGuardrails(input);
  }
}
