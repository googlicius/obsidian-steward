import { ToolName } from '../ToolRegistry';
import * as handlers from './handlers';
import { getActivateToolsTool } from '../tools/activateTools';
import { createAskUserTool } from '../tools/askUser';
import type { Tool } from 'ai';

/** Subagent tool names (sync list for validation before the tools map is loaded). */
const SUBAGENT_TOOL_NAME_LIST = [
  ToolName.LIST,
  ToolName.CREATE,
  ToolName.DELETE,
  ToolName.COPY,
  ToolName.RENAME,
  ToolName.MOVE,
  ToolName.UPDATE_FRONTMATTER,
  ToolName.GREP,
  ToolName.EXISTS,
  ToolName.REVERT,
  ToolName.CONTENT_READING,
  ToolName.EDIT,
  ToolName.HELP,
  ToolName.STOP,
  ToolName.THANK_YOU,
  ToolName.BUILD_SEARCH_INDEX,
  ToolName.SEARCH,
  ToolName.SEARCH_MORE,
  ToolName.GET_MOST_RECENT_ARTIFACT,
  ToolName.GET_ARTIFACT_BY_ID,
  ToolName.ACTIVATE,
  ToolName.SPEECH,
  ToolName.IMAGE,
  ToolName.TODO_LIST,
  ToolName.TODO_LIST_UPDATE,
  ToolName.CONCLUDE,
  ToolName.RECALL_COMPACTED_CONTEXT,
] as const;

const SUPER_ONLY_TOOL_NAMES = [
  ToolName.CONFIRMATION,
  ToolName.ASK_USER,
  ToolName.USER_CONFIRM,
  ToolName.SPAWN_SUBAGENT,
  ToolName.SWITCH_AGENT_CAPACITY,
] as const;

export const SUBAGENT_TOOL_NAMES: ReadonlySet<ToolName> = new Set(SUBAGENT_TOOL_NAME_LIST);

export const SUPER_AGENT_TOOL_NAMES: ReadonlySet<ToolName> = new Set([
  ...SUBAGENT_TOOL_NAME_LIST,
  ...SUPER_ONLY_TOOL_NAMES,
]);

export type AgentToolsRecord = Record<string, Tool> & { [s: string]: unknown };

async function buildBaseAgentTools(): Promise<AgentToolsRecord> {
  const [
    listTool,
    createTool,
    deleteTool,
    copyTool,
    renameTool,
    moveTool,
    updateFrontmatterTool,
    grepTool,
    existsTool,
    revertTool,
    contentReadingTool,
    editTool,
    helpTool,
    stopTool,
    thankYouTool,
    buildSearchIndexTool,
    searchTool,
    searchMoreTool,
    getMostRecentArtifactTool,
    getArtifactByIdTool,
    speechTool,
    imageTool,
    todoListTool,
    todoListUpdateTool,
    concludeTool,
    recallCompactedContextTool,
    activateToolsTool,
  ] = await Promise.all([
    handlers.VaultList.getListTool(),
    handlers.VaultCreate.getCreateTool(),
    handlers.VaultDelete.getDeleteTool(),
    handlers.VaultCopy.getCopyTool(),
    handlers.VaultRename.getRenameTool(),
    handlers.VaultMove.getMoveTool(),
    handlers.VaultUpdateFrontmatter.getUpdateFrontmatterTool(),
    handlers.VaultGrep.getGrepTool(),
    handlers.VaultExists.getExistsTool(),
    handlers.RevertLatestQuery.getRevertTool(),
    handlers.ReadContent.getContentReadingTool(),
    handlers.EditHandler.getEditTool('in_the_note'),
    handlers.Help.getHelpTool(),
    handlers.Stop.getStopTool(),
    handlers.ThankYou.getThankYouTool(),
    handlers.BuildSearchIndex.getBuildSearchIndexTool(),
    handlers.Search.getSearchTool(),
    handlers.SearchMore.getSearchMoreTool(),
    handlers.GetMostRecentArtifact.getGetMostRecentArtifactTool(),
    handlers.GetArtifactById.getGetArtifactByIdTool(),
    handlers.Speech.getSpeechTool(),
    handlers.Image.getImageTool(),
    handlers.TodoList.getTodoListTool(),
    handlers.TodoList.getTodoListUpdateTool(),
    handlers.Conclude.getConcludeTool(),
    handlers.RecallCompactedContext.getRecallCompactedContextTool(),
    getActivateToolsTool(),
  ]);

  return {
    [ToolName.LIST]: listTool,
    [ToolName.CREATE]: createTool,
    [ToolName.DELETE]: deleteTool,
    [ToolName.COPY]: copyTool,
    [ToolName.RENAME]: renameTool,
    [ToolName.MOVE]: moveTool,
    [ToolName.UPDATE_FRONTMATTER]: updateFrontmatterTool,
    [ToolName.GREP]: grepTool,
    [ToolName.EXISTS]: existsTool,
    [ToolName.REVERT]: revertTool,
    [ToolName.CONTENT_READING]: contentReadingTool,
    [ToolName.EDIT]: editTool,
    [ToolName.HELP]: helpTool,
    [ToolName.STOP]: stopTool,
    [ToolName.THANK_YOU]: thankYouTool,
    [ToolName.BUILD_SEARCH_INDEX]: buildSearchIndexTool,
    [ToolName.SEARCH]: searchTool,
    [ToolName.SEARCH_MORE]: searchMoreTool,
    [ToolName.GET_MOST_RECENT_ARTIFACT]: getMostRecentArtifactTool,
    [ToolName.GET_ARTIFACT_BY_ID]: getArtifactByIdTool,
    [ToolName.ACTIVATE]: activateToolsTool,
    [ToolName.SPEECH]: speechTool,
    [ToolName.IMAGE]: imageTool,
    [ToolName.TODO_LIST]: todoListTool,
    [ToolName.TODO_LIST_UPDATE]: todoListUpdateTool,
    [ToolName.CONCLUDE]: concludeTool,
    [ToolName.RECALL_COMPACTED_CONTEXT]: recallCompactedContextTool,
  } as AgentToolsRecord;
}

let baseAgentToolsPromise: Promise<AgentToolsRecord> | null = null;
let superAgentOnlyToolsPromise: Promise<AgentToolsRecord> | null = null;

/** Cached subagent (shared) tool implementations without MCP. */
export function loadSubagentToolsBase(): Promise<AgentToolsRecord> {
  if (!baseAgentToolsPromise) {
    baseAgentToolsPromise = buildBaseAgentTools();
  }
  return baseAgentToolsPromise;
}

/** Cached super-agent tool implementations without MCP. */
export function loadSuperAgentToolsBase(): Promise<AgentToolsRecord> {
  if (!superAgentOnlyToolsPromise) {
    superAgentOnlyToolsPromise = loadSubagentToolsBase().then(async base => {
      const [
        confirmationBundle,
        askBundle,
        userConfirmTool,
        spawnSubagentTool,
        switchAgentCapacityTool,
      ] = await Promise.all([
        createAskUserTool('confirmation'),
        createAskUserTool('ask'),
        handlers.UserConfirm.getUserConfirmTool(),
        handlers.SpawnSubagent.getSpawnSubagentTool(),
        handlers.SwitchAgentCapacity.getSwitchAgentCapacityTool(),
      ]);
      return {
        ...base,
        [ToolName.CONFIRMATION]: confirmationBundle.askUserTool,
        [ToolName.ASK_USER]: askBundle.askUserTool,
        [ToolName.USER_CONFIRM]: userConfirmTool,
        [ToolName.SPAWN_SUBAGENT]: spawnSubagentTool,
        [ToolName.SWITCH_AGENT_CAPACITY]: switchAgentCapacityTool,
      } as AgentToolsRecord;
    });
  }
  return superAgentOnlyToolsPromise;
}
