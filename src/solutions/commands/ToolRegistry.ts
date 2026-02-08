import { ToolName } from './toolNames';
import { joinWithConjunction } from 'src/utils/arrayUtils';
import { revertAbleArtifactTypes } from '../artifact';
import { EditMode } from './tools/editContent';

export interface ToolDefinition {
  name: ToolName;
  tool: unknown;
  description: string;
  guidelines: string[];
  required?: boolean;
  category?: string;
}

export interface ToolMetaDefinition {
  name: ToolName;
  description: string;
  guidelines: string[];
  category?: string;
}

/**
 * Centralized tool definition. Handlers can build registries from actual tool instances
 * and this definition will provide consistent prompt text across the app.
 */
export const TOOL_DEFINITIONS: Record<ToolName, ToolMetaDefinition> = {
  // ReadAgent tool
  [ToolName.CONTENT_READING]: {
    name: ToolName.CONTENT_READING,
    description:
      'Read content from a note, including text, images, audios, videos, etc. Or image files (png, jpg, jpeg, etc.).',
    category: 'content-access',
    guidelines: [
      `Use ${ToolName.CONTENT_READING} to read any type of content, including text, image, audio, video, etc.`,
      `When reading notes:
  - Specify the number of blocks to read (blocksToRead) carefully from the user's query, Do NOT set -1 unless the user explicitly requests to read the entire content.
  - Specify the direction to read (readType) carefully from the user's query, Do NOT set "entire" unless the user explicitly requests to read the entire content.`,
      `When reading multiple files, you MUST make multiple parallel tool calls in the same request (one ${ToolName.CONTENT_READING} call per file). Do NOT read files sequentially one by one. EXCEPT when the user explicitly requests sequential reading.`,
      `After reading, respond a short conclusion of your task. DO NOT respond the elements of the reading result in your final response: Tables, lists, code, blockquote, images, headings, etc.`,
    ],
  },

  // User interaction tools
  [ToolName.CONFIRMATION]: {
    name: ToolName.CONFIRMATION,
    description: 'Get confirmation from the user before performing an action.',
    guidelines: [
      `You MUST use ${ToolName.CONFIRMATION} BEFORE reading the entire content of any note (markdown files). (When readType is "entire"). EXCEPT reading images.`,
      `Use ${ToolName.CONFIRMATION} once for all note(s) to be read.`,
    ],
    category: 'user-interaction',
  },

  [ToolName.ASK_USER]: {
    name: ToolName.ASK_USER,
    description: 'Ask the user for additional information or clarification when needed.',
    guidelines: [
      `Use ${ToolName.ASK_USER} when you need clarification or additional information from the user to fulfill their request.`,
    ],
    category: 'user-interaction',
  },

  [ToolName.USER_CONFIRM]: {
    name: ToolName.USER_CONFIRM,
    description: 'Handle user confirmation responses (yes/no) for pending operations.',
    guidelines: [
      `Use ${ToolName.USER_CONFIRM} when the user provides a confirmation response to a pending operation.`,
    ],
    category: 'user-interaction',
  },

  [ToolName.HELP]: {
    name: ToolName.HELP,
    description: 'Display help information listing all available commands.',
    guidelines: [
      `Use ${ToolName.HELP} when the user requests help or wants to see available commands.`,
    ],
    category: 'user-interaction',
  },

  [ToolName.STOP]: {
    name: ToolName.STOP,
    description: 'Stop all active operations and abort any ongoing processes.',
    guidelines: [
      `Use ${ToolName.STOP} when the user requests to stop or cancel ongoing operations.`,
    ],
    category: 'user-interaction',
  },

  [ToolName.THANK_YOU]: {
    name: ToolName.THANK_YOU,
    description: 'Respond to user expressions of gratitude.',
    guidelines: [`Use ${ToolName.THANK_YOU} when the user expresses thanks or gratitude.`],
    category: 'user-interaction',
  },

  [ToolName.BUILD_SEARCH_INDEX]: {
    name: ToolName.BUILD_SEARCH_INDEX,
    description:
      'Build or rebuild the search index for the vault to enable fast content searching.',
    guidelines: [
      `Use ${ToolName.BUILD_SEARCH_INDEX} when the user requests to build or rebuild the search index.`,
    ],
    category: 'vault-access',
  },

  [ToolName.SEARCH]: {
    name: ToolName.SEARCH,
    description:
      'Comprehensive search for notes and files in the vault using keywords, tags, filenames, folders, and properties.',
    guidelines: [
      `Use ${ToolName.SEARCH} tool when the user wants to find files in the vault.
  - If the query lacks search intention, search with two operations: 1. Search by keywords; 2. Search by filenames.
  - If there are any typos in the query, extract both the original and your corrected version
  - If the query includes or mentions "note", include the property {name: "file_type", value: "md"}.
  - Folders and filenames, use regex to represent user-specified: Exact match: ^<query>$, start with: ^<query>, or contain: <query>.`,
      `The search query can include keywords, file names, folder paths, tags, and other properties.`,
      `NOTE: ${ToolName.SEARCH} tool cannot access the Steward folder. Use ${ToolName.LIST} instead.`,
    ],
    category: 'vault-access',
  },

  [ToolName.SEARCH_MORE]: {
    name: ToolName.SEARCH_MORE,
    description: 'Display additional pages of search results from the most recent search.',
    guidelines: [
      `Use ${ToolName.SEARCH_MORE} when the user requests to see more results from a previous search.`,
    ],
    category: 'vault-access',
  },

  [ToolName.GREP]: {
    name: ToolName.GREP,
    description:
      'Check if files or folders exist, or search for specific text patterns in note content.',
    guidelines: [
      `Use ${ToolName.GREP} to check if one or many given file or folder paths exist in the vault. If a folder.`,
      `Use ${ToolName.GREP} to search for specific text patterns in note content when a pattern is provided with a single file path.`,
      `The ${ToolName.GREP} tool will NOT return the files inside the folder. Use ${ToolName.LIST} to list files instead.`,
    ],
    category: 'vault-access',
  },

  [ToolName.EDIT]: {
    name: ToolName.EDIT,
    description: 'Update content by multiple edit modes.',
    guidelines: [
      `Use the ${ToolName.EDIT} tool if you need to update existing content.
  - When updating content, return ONLY the specific changed content, not the entire surrounding context.
  - Use ${ToolName.EDIT} to make the actual content changes. (NOTE: You cannot use this tool if a note does not exist.)
  - Use the right edit mode to ensure good performance and efficient token usage.`,
      `Here are available edit modes:
  - ${EditMode.ADD_TABLE_COLUMN}: Add a column to a table.
  - ${EditMode.UPDATE_TABLE_COLUMN}: Update a column in a table - Use to update the header, values, or both.
  - ${EditMode.DELETE_TABLE_COLUMN}: Delete a column from a table.
  - ${EditMode.REPLACE_BY_LINES}: Replace content within a specific line range, or replace the entire file if both fromLine and toLine are omitted.
  - ${EditMode.REPLACE_BY_PATTERN}: Replace content matching a pattern across multiple notes from an artifact. Use this when editing multiple files at once.
  - ${EditMode.INSERT}: Insert content at a specific line number.
NOTE: 
  - Use table modes to edit tables, especially large tables (More than 20 rows).
  - Use one or multiple operations. DO NOT use multiple tool calls or multiple requests.`,
    ],
    category: 'content-edit',
  },

  [ToolName.CREATE]: {
    name: ToolName.CREATE,
    description:
      'Create new files (notes, canvases, CSS snippets, etc.) and optionally populate them with content.',
    guidelines: [
      `Use ${ToolName.CREATE} to create every file requested by the user.
  - Provide the exact content that should be written to the file when available.
  - Ensure each file name includes the appropriate extension (e.g. .md, .canvas, .base) and points to the correct folder.`,
    ],
    category: 'content-create',
  },

  [ToolName.DELETE]: {
    name: ToolName.DELETE,
    description: 'Delete files from the vault using the configured trash behavior.',
    guidelines: [
      `Use the ${ToolName.DELETE} tool to remove files or notes from the vault.
  - List every file using the list tool (not grep tool) you plan to delete and ensure the paths are accurate.`,
    ],
    category: 'vault-access',
  },

  [ToolName.COPY]: {
    name: ToolName.COPY,
    description: 'Copy files to another folder.',
    guidelines: [
      `Use ${ToolName.COPY} to duplicate files into another folder.
  - Always provide the destination folder path for the copy operation.
  - Specify the files or artifactId for the copy operation.`,
    ],
    category: 'vault-access',
  },

  [ToolName.RENAME]: {
    name: ToolName.RENAME,
    description: 'Rename files to a new path or filename.',
    guidelines: [
      `Use ${ToolName.RENAME} to change the name or location of files.`,
      `Always provide both the current path and the new path for each file.`,
    ],
    category: 'vault-access',
  },

  [ToolName.MOVE]: {
    name: ToolName.MOVE,
    description: 'Move files to another folder.',
    guidelines: [
      `Use ${ToolName.MOVE} to relocate files to another folder.,
  - Always provide the destination folder path for the move operation.,
  - Specify the files or artifactId for the move operation.`,
    ],
    category: 'vault-access',
  },

  [ToolName.LIST]: {
    name: ToolName.LIST,
    description: 'List files in the vault or a specific folder.',
    guidelines: [`Use ${ToolName.LIST} to list files in the vault or a specific folder.`],
    category: 'vault-access',
  },

  [ToolName.UPDATE_FRONTMATTER]: {
    name: ToolName.UPDATE_FRONTMATTER,
    description: 'Update frontmatter properties in notes (add, update, or delete properties).',
    guidelines: [`Use ${ToolName.UPDATE_FRONTMATTER} to modify frontmatter properties in notes.`],
    category: 'vault-access',
  },

  [ToolName.ACTIVATE]: {
    name: ToolName.ACTIVATE,
    description: 'Request additional tools to be activated for the current session.',
    guidelines: [
      `Use ${ToolName.ACTIVATE} when you need other tools currently inactive to complete the task. It will return the schemas and guidelines of the requested tools.
  - Activate ONLY tools that are needed for the current task.
  - If you need multiple tools, activate them at once (in the same request) that are needed to fulfill the user's query.`,
    ],
    category: 'tool-management',
  },

  [ToolName.REVERT_DELETE]: {
    name: ToolName.REVERT_DELETE,
    description:
      'Revert deleted files by restoring them from the trash folder to their original locations.',
    guidelines: [
      `Use ${ToolName.REVERT_DELETE} to restore files that were previously deleted.`,
      `Specify the artifactId containing deleted files to restore, or provide specific trash file paths.`,
      `Files will be restored to their original paths as recorded in the trash metadata.`,
    ],
    category: 'vault-access',
  },

  [ToolName.REVERT_MOVE]: {
    name: ToolName.REVERT_MOVE,
    description: 'Revert move operations by moving files back to their original locations.',
    guidelines: [`Use ${ToolName.REVERT_MOVE} to undo file move operations.`],
    category: 'vault-access',
  },

  [ToolName.REVERT_FRONTMATTER]: {
    name: ToolName.REVERT_FRONTMATTER,
    description: 'Revert frontmatter updates by restoring original frontmatter properties.',
    guidelines: [`Use ${ToolName.REVERT_FRONTMATTER} to undo frontmatter property changes.`],
    category: 'vault-access',
  },

  [ToolName.REVERT_RENAME]: {
    name: ToolName.REVERT_RENAME,
    description: 'Revert rename operations by renaming files back to their original names.',
    guidelines: [`Use ${ToolName.REVERT_RENAME} to undo file rename operations.`],
    category: 'vault-access',
  },

  [ToolName.REVERT_CREATE]: {
    name: ToolName.REVERT_CREATE,
    description: 'Revert create operations by deleting files that were previously created.',
    guidelines: [`Use ${ToolName.REVERT_CREATE} to undo file creation operations.`],
    category: 'vault-access',
  },

  [ToolName.REVERT_EDIT_RESULTS]: {
    name: ToolName.REVERT_EDIT_RESULTS,
    description:
      'Revert edit operations by restoring original content that was previously modified.',
    guidelines: [`Use ${ToolName.REVERT_EDIT_RESULTS} to undo content edit operations.`],
    category: 'vault-access',
  },

  [ToolName.GET_MOST_RECENT_ARTIFACT]: {
    name: ToolName.GET_MOST_RECENT_ARTIFACT,
    description:
      'Get the most recent artifact from the conversation (searches for artifacts created by vault operations).',
    guidelines: [
      `Use ${ToolName.GET_MOST_RECENT_ARTIFACT} to retrieve the most recent artifact that can be reverted.`,
      `The ${ToolName.GET_MOST_RECENT_ARTIFACT} tool will only retrieve revert-able artifacts: ${joinWithConjunction(revertAbleArtifactTypes, 'or')}.`,
    ],
    category: 'artifact-access',
  },

  [ToolName.GET_ARTIFACT_BY_ID]: {
    name: ToolName.GET_ARTIFACT_BY_ID,
    description: 'Get a specific artifact by its ID from the conversation.',
    guidelines: [
      `Use ${ToolName.GET_ARTIFACT_BY_ID} to retrieve a specific artifact when you know its ID.
  - This is useful when you have an artifact ID from previous operations or user input.`,
    ],
    category: 'artifact-access',
  },

  [ToolName.SPEECH]: {
    name: ToolName.SPEECH,
    description: 'Generate text content for speech/audio generation.',
    guidelines: [
      `Use ${ToolName.SPEECH} when the user wants to generate audio or speech from text.`,
    ],
    category: 'content-generation',
  },

  [ToolName.IMAGE]: {
    name: ToolName.IMAGE,
    description: 'Generate image content for image generation.',
    guidelines: [
      `Use ${ToolName.IMAGE} when the user wants to generate image from text.`,
      `NOTE: The ${ToolName.IMAGE} tool is NOT for reading images, the tool cannot read. Use ${ToolName.CONTENT_READING} for reading images.`,
    ],
    category: 'content-generation',
  },

  [ToolName.TODO_LIST]: {
    name: ToolName.TODO_LIST,
    description:
      'Create a to-do list for complex tasks. Each step includes a task that will be executed sequentially.',
    guidelines: [
      `Use ${ToolName.TODO_LIST} to break down complex tasks into manageable steps.
  - When creating a to-do list, provide an array of steps, each with a task. The task is the only required field for each step.
  - After creating a to-do list, you should execute the first step's task.`,
    ],
    category: 'task-management',
  },

  [ToolName.TODO_LIST_UPDATE]: {
    name: ToolName.TODO_LIST_UPDATE,
    description: 'Update the current step index of an existing to-do list.',
    guidelines: [
      `Use ${ToolName.TODO_LIST_UPDATE} to update the current step index when moving to the next step in a to-do list.
  - When moving to the next step, you SHOULD call ${ToolName.TODO_LIST_UPDATE} tool in parallel (in the same request) with the tool that performs the next task.`,
    ],
    category: 'task-management',
  },

  [ToolName.USE_SKILLS]: {
    name: ToolName.USE_SKILLS,
    description:
      'Activate one or more skills to gain domain-specific knowledge for the current task.',
    guidelines: [
      `Use ${ToolName.USE_SKILLS} only when performing tasks that require specific skill knowledge (e.g., creating or editing files in a specialized format).
  - For answering questions, the skill name and description in the catalog is sufficient — do NOT activate skills just to answer.
  - Activate skills BEFORE attempting the task that requires that knowledge.
  - Once activated, skills persist for the entire conversation.`,
    ],
    category: 'skill',
  },
};

export class ToolRegistry<T> {
  private readonly tools: Map<ToolName, ToolDefinition> = new Map();
  private readonly excluded: Set<ToolName> = new Set();
  private activeTools: Set<ToolName> | null = null;

  public register(def: ToolDefinition): this {
    this.tools.set(def.name, def);
    return this;
  }

  public exclude(names: ToolName[]): this {
    for (const name of names) {
      this.excluded.add(name);
    }
    return this;
  }

  public setActive(names?: readonly ToolName[]): this {
    if (typeof names === 'undefined') {
      this.activeTools = null;
      return this;
    }

    this.activeTools = new Set(names);
    return this;
  }

  private isActive(name: ToolName): boolean {
    if (this.excluded.has(name)) {
      return false;
    }

    if (this.activeTools === null) {
      return true;
    }

    return this.activeTools.has(name);
  }

  public getToolsObject(): T {
    const obj: Record<string, unknown> = {};
    for (const [name, def] of this.tools) {
      if (!this.isActive(name)) continue;
      obj[name] = def.tool;
    }
    return obj as T;
  }

  public generateToolsSection(): string {
    const lines: string[] = [];
    for (const [, def] of this.tools) {
      if (!this.isActive(def.name)) continue;
      lines.push(`- ${def.name} - ${def.description}`);
    }
    return lines.join('\n');
  }

  public generateGuidelinesSection(): string {
    const sections: string[] = [];
    for (const [, def] of this.tools) {
      if (!this.isActive(def.name)) continue;
      const guidelines: string[] = [];
      for (const g of def.guidelines) {
        guidelines.push(`- ${g}`);
      }
      if (guidelines.length > 0) {
        sections.push(`**${def.name}**\n${guidelines.join('\n')}`);
      }
    }
    return sections.join('\n\n');
  }

  public generateOtherToolsSection(
    emptyLabel = '',
    includeDescription?: Set<ToolName>,
    exclude?: Set<ToolName>
  ): string {
    const lines: string[] = [];
    for (const [, def] of this.tools) {
      if (this.isActive(def.name)) continue;
      if (exclude?.has(def.name)) continue;
      const line = includeDescription?.has(def.name)
        ? `- ${def.name} - ${def.description}`
        : `- ${def.name}`;
      lines.push(line);
    }

    if (lines.length === 0) {
      return emptyLabel;
    }

    return lines.join('\n');
  }

  /**
   * Build a registry from a tools object using centralized metadata.
   * Any missing metadata will default to empty description/guidelines.
   */
  public static buildFromTools<T extends { [s: string]: unknown }>(tools: T) {
    const registry = new ToolRegistry<typeof tools>();
    for (const [name, tool] of Object.entries(tools)) {
      const meta = TOOL_DEFINITIONS[name as ToolName];
      registry.register({
        name: name as ToolName,
        tool,
        description: meta.description,
        guidelines: meta.guidelines,
        category: meta.category,
      });
    }
    return registry;
  }
}

export { ToolName } from './toolNames';
