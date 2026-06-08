/**
 * Payload for clicking "Install" / "Update" on community command rows ({@link CommandsViewBuilder}).
 * Serialized into `stw-run` `data-query` for the `update-command` handler.
 */
export type CommunityCommandUpdateGuideline = {
  commandName: string;
  files: string[];
  destinationFolder?: string;
  version: number;
  mainVAULT_FILENAME: string;
  /** Optional migration notes for this bundle version (renames, removed files, etc.). */
  updateInstruction?: string;
};
