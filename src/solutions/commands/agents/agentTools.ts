import { ToolName } from '../ToolRegistry';
import * as handlers from './handlers';
import { activateTools } from '../tools/activateTools';
import { getMostRecentArtifact, getArtifactById } from '../tools/getArtifact';
import { createAskUserTool } from '../tools/askUser';

const { askUserTool: confirmationTool } = createAskUserTool('confirmation');
const { askUserTool } = createAskUserTool('ask');

const BASE_AGENT_TOOLS = {
  [ToolName.LIST]: handlers.VaultList.getListTool(),
  [ToolName.CREATE]: handlers.VaultCreate.getCreateTool(),
  [ToolName.DELETE]: handlers.VaultDelete.getDeleteTool(),
  [ToolName.COPY]: handlers.VaultCopy.getCopyTool(),
  [ToolName.RENAME]: handlers.VaultRename.getRenameTool(),
  [ToolName.MOVE]: handlers.VaultMove.getMoveTool(),
  [ToolName.UPDATE_FRONTMATTER]: handlers.VaultUpdateFrontmatter.getUpdateFrontmatterTool(),
  [ToolName.GREP]: handlers.VaultGrep.getGrepTool(),
  [ToolName.REVERT_DELETE]: handlers.RevertDelete.getRevertDeleteTool(),
  [ToolName.REVERT_MOVE]: handlers.RevertMove.getRevertMoveTool(),
  [ToolName.REVERT_FRONTMATTER]: handlers.RevertFrontmatter.getRevertFrontmatterTool(),
  [ToolName.REVERT_RENAME]: handlers.RevertRename.getRevertRenameTool(),
  [ToolName.REVERT_CREATE]: handlers.RevertCreate.getRevertCreateTool(),
  [ToolName.REVERT_EDIT_RESULTS]: handlers.RevertEditResults.getRevertEditResultsTool(),
  [ToolName.CONTENT_READING]: handlers.ReadContent.getContentReadingTool(),
  [ToolName.EDIT]: handlers.EditHandler.getEditTool('in_the_note'),
  [ToolName.HELP]: handlers.Help.getHelpTool(),
  [ToolName.STOP]: handlers.Stop.getStopTool(),
  [ToolName.THANK_YOU]: handlers.ThankYou.getThankYouTool(),
  [ToolName.BUILD_SEARCH_INDEX]: handlers.BuildSearchIndex.getBuildSearchIndexTool(),
  [ToolName.SEARCH]: handlers.Search.getSearchTool(),
  [ToolName.SEARCH_MORE]: handlers.SearchMore.getSearchMoreTool(),
  [ToolName.GET_MOST_RECENT_ARTIFACT]: getMostRecentArtifact,
  [ToolName.GET_ARTIFACT_BY_ID]: getArtifactById,
  [ToolName.ACTIVATE]: activateTools,
  [ToolName.SPEECH]: handlers.Speech.getSpeechTool(),
  [ToolName.IMAGE]: handlers.Image.getImageTool(),
  [ToolName.TODO_LIST]: handlers.TodoList.getTodoListTool(),
  [ToolName.TODO_LIST_UPDATE]: handlers.TodoList.getTodoListUpdateTool(),
  [ToolName.USE_SKILLS]: handlers.UseSkills.getUseSkillsTool(),
  [ToolName.CONCLUDE]: handlers.Conclude.getConcludeTool(),
  [ToolName.RECALL_COMPACTED_CONTEXT]:
    handlers.RecallCompactedContext.getRecallCompactedContextTool(),
} as const;

export const SUBAGENT_TOOLS = {
  ...BASE_AGENT_TOOLS,
} as const;

export const SUPER_AGENT_TOOLS = {
  ...BASE_AGENT_TOOLS,
  [ToolName.CONFIRMATION]: confirmationTool,
  [ToolName.ASK_USER]: askUserTool,
  [ToolName.USER_CONFIRM]: handlers.UserConfirm.getUserConfirmTool(),
  [ToolName.SPAWN_SUBAGENT]: handlers.SpawnSubagent.getSpawnSubagentTool(),
  [ToolName.SWITCH_AGENT_CAPACITY]: handlers.SwitchAgentCapacity.getSwitchAgentCapacityTool(),
} as const;
