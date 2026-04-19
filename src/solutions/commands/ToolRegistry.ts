import { ToolName } from './toolNames';
import { joinWithConjunction } from 'src/utils/arrayUtils';
import { ArtifactType, revertAbleArtifactTypes } from '../artifact';
import { EditMode } from './tools/editContent';

export interface ToolDefinition {
  name: string;
  tool: unknown;
  description: string;
  guidelines: string[];
  required?: boolean;
  category?: string;
  showDescriptionWhenInactive?: boolean;
}

export interface ToolMetaDefinition {
  name: ToolName;
  description: string;
  guidelines: string[];
  category?: string;
  showDescriptionWhenInactive?: boolean;
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
      `When reading notes:
  - Specify the number of blocks to read (blocksToRead) carefully from the user's query, Do NOT set -1 unless the user explicitly requests to read the entire content.
  - Specify the direction to read (readType) carefully from the user's query, Do NOT set "entire" unless the user explicitly requests to read the entire content.`,
      `When reading multiple files, you MUST make multiple parallel tool calls in the same request (one ${ToolName.CONTENT_READING} call per file). Do NOT read files sequentially one by one. EXCEPT when the user explicitly requests it.`,
      `On success, creates artifact: ${ArtifactType.READ_CONTENT}.`,
    ],
    showDescriptionWhenInactive: true,
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
    guidelines: [],
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
    guidelines: [],
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
      `On success, creates artifact: ${ArtifactType.SEARCH_RESULTS}.`,
    ],
    category: 'vault-access',
    showDescriptionWhenInactive: true,
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
      'Locate matching CONTENT across files, folders, or glob patterns using literal or regex search.',
    guidelines: [
      `Use caseSensitive, isRegex, contextLines, and maxResults to control matching behavior and output size.`,
      `If you need to find file/folder names by pattern, use ${ToolName.LIST}, the ${ToolName.GREP} cannot do that.`,
      `The ${ToolName.GREP} tool does NOT validate path existence. Use ${ToolName.EXISTS} when you need existence validation.`,
    ],
    category: 'vault-access',
    showDescriptionWhenInactive: true,
  },

  [ToolName.EXISTS]: {
    name: ToolName.EXISTS,
    description: 'Check whether files or folders exist and identify their type.',
    guidelines: [`The result includes path, exists, and type (file, folder, or null).`],
    category: 'vault-access',
    showDescriptionWhenInactive: true,
  },

  [ToolName.EDIT]: {
    name: ToolName.EDIT,
    description:
      'Update content by multiple edit modes, Use if you need to update existing content.',
    guidelines: [
      `- When updating content, return ONLY the specific changed content, not the entire surrounding context.
  - Use ${ToolName.EDIT} to make the actual content changes. (NOTE: You cannot use this tool if a note does not exist.)
  - Use the right edit mode to ensure good performance and efficient token usage.`,
      `Here are available edit modes:
  - ${EditMode.ADD_TABLE_COLUMN}: Add a column to a table.
  - ${EditMode.UPDATE_TABLE_COLUMN}: Update a column in a table - Use to update the header, values, or both.
  - ${EditMode.DELETE_TABLE_COLUMN}: Delete a column from a table.
  - ${EditMode.REPLACE_BY_LINES}: Replace content within a specific line range, or replace the entire file if both fromLine and toLine are omitted.
  - ${EditMode.REPLACE_BY_PATTERN}: Replace content matching a pattern in a single note by path, or across multiple notes from an artifact. Requires either artifactId or path.
  - ${EditMode.INSERT}: Insert content at a specific line number.
NOTE:
  - Use table modes to edit tables, especially large tables (More than 20 rows).
  - Use one or multiple operations. DO NOT use multiple tool calls or multiple requests.`,
      `On success, creates artifact: ${ArtifactType.EDIT_RESULTS}.`,
    ],
    category: 'content-edit',
  },

  [ToolName.CREATE]: {
    name: ToolName.CREATE,
    description:
      'Create new folders and files (notes, canvases, bases, etc.) and optionally populate file content.',
    guidelines: [
      `Use newFolders for folder paths.`,
      'Use newFiles with filePath (not fileName) for file creation.',
      'Ensure each filePath includes the appropriate extension (e.g. .md, .canvas, .base).',
      'Provide the exact content that should be written to a file when available.',
      `On success, creates artifact: ${ArtifactType.CREATED_PATHS}.`,
    ],
    category: 'content-create',
  },

  [ToolName.DELETE]: {
    name: ToolName.DELETE,
    description: 'Delete files from the vault using the configured trash behavior.',
    guidelines: [
      `- List every file using the ${ToolName.LIST} tool (NOT ${ToolName.GREP}) you plan to delete and ensure the paths are accurate.`,
      `On success, creates artifact: ${ArtifactType.DELETED_FILES}.`,
    ],
    category: 'vault-access',
  },

  [ToolName.COPY]: {
    name: ToolName.COPY,
    description: 'Copy files to another folder.',
    guidelines: [
      `- Always provide the destination folder path for the copy operation.
  - Specify the files or artifactId for the copy operation.`,
    ],
    category: 'vault-access',
  },

  [ToolName.RENAME]: {
    name: ToolName.RENAME,
    description: 'Rename files to a new path or filename.',
    guidelines: [
      `Always provide both the current path and the new path for each file.`,
      `On success, creates artifact: ${ArtifactType.RENAME_RESULTS}.`,
    ],
    category: 'vault-access',
  },

  [ToolName.MOVE]: {
    name: ToolName.MOVE,
    description: 'Move files to another folder.',
    guidelines: [
      'Always provide the destination folder path for the move operation.',
      'Specify the files or artifactId for the move operation.',
      `On success, creates artifact: ${ArtifactType.MOVE_RESULTS}.`,
    ],
    category: 'vault-access',
  },

  [ToolName.LIST]: {
    name: ToolName.LIST,
    description:
      'List direct files and subfolders in a folder (non-recursive) and optionally filter names with filePattern.',
    guidelines: [`On success, creates artifact: ${ArtifactType.LIST_RESULTS}.`],
    category: 'vault-access',
    showDescriptionWhenInactive: true,
  },

  [ToolName.UPDATE_FRONTMATTER]: {
    name: ToolName.UPDATE_FRONTMATTER,
    description: 'Update frontmatter properties in notes (add, update, or delete properties).',
    guidelines: [
      `Use ${ToolName.UPDATE_FRONTMATTER} to modify frontmatter properties in notes.`,
      `On success, creates artifact: ${ArtifactType.UPDATE_FRONTMATTER_RESULTS}.`,
    ],
    category: 'vault-access',
  },

  [ToolName.ACTIVATE]: {
    name: ToolName.ACTIVATE,
    description:
      'Request additional tools to be activated for the current session. Use when you need other tools currently inactive to complete the task. It will return the schemas and guidelines of the requested tools.',
    guidelines: [
      `Activate ONLY tools that are needed for the current task.`,
      `If you need multiple tools, activate them at once (in the same request) that are needed to fulfill the user's query.`,
    ],
    category: 'tool-management',
  },

  [ToolName.REVERT]: {
    name: ToolName.REVERT,
    description:
      'Revert all revertable operations produced by the latest user query, including subagents.',
    guidelines: [
      `Use ${ToolName.REVERT} to undo the latest user query end-to-end in reverse chronological order.`,
    ],
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
      `On success, creates artifact: ${ArtifactType.MEDIA_RESULTS}.`,
    ],
    category: 'content-generation',
  },

  [ToolName.IMAGE]: {
    name: ToolName.IMAGE,
    description: 'Generate image content for image generation.',
    guidelines: [
      `Use ${ToolName.IMAGE} when the user wants to generate image from text.`,
      `NOTE: The ${ToolName.IMAGE} tool is NOT for reading images, the tool cannot read. Use ${ToolName.CONTENT_READING} for reading images.`,
      `On success, creates artifact: ${ArtifactType.MEDIA_RESULTS}.`,
    ],
    category: 'content-generation',
    showDescriptionWhenInactive: true,
  },

  [ToolName.TODO_WRITE]: {
    name: ToolName.TODO_WRITE,
    description:
      'Create or update a to-do list for complex tasks. Pass a single-item operations array: one object with operation "create" and steps, or operation "update" with currentStepStatus and optional nextStep.',
    guidelines: [
      `Always use { "operations": [ { ... } ] } with exactly one element (create or update).`,
      `When creating a list, use operations: [{ operation: "create", steps: [...] }]. Each step needs a task. After creating, execute the first step.`,
      `When you complete or skip the current step, use operations: [{ operation: "update", currentStepStatus, nextStep? }]. currentStepStatus is for the current step only (not the step you move to via nextStep).`,
      `When moving to the next step, you SHOULD call ${ToolName.TODO_WRITE} in parallel (in the same request) with the tool that performs the next task.`,
      `Read the latest tool result from ${ToolName.TODO_WRITE} for current steps, statuses, and any step-specific instructions. If all tasks are completed or skipped, stop the plan.`,
    ],
    category: 'task-management',
    showDescriptionWhenInactive: true,
  },

  [ToolName.SPAWN_SUBAGENT]: {
    name: ToolName.SPAWN_SUBAGENT,
    description:
      'Use when a task can be split into independent jobs, especially to keep each job focused and reduce token usage when token limits might be hit.',
    guidelines: [
      `Provide clear job queries for each subagent job. Use tools for immediately required actions and inactiveTools for optional verification/pre-check tools the subagent may activate later.`,
      `For jobs that create, edit, move, or delete content, include enough inactiveTools to verify results before concluding (for example: ${ToolName.CONTENT_READING}, ${ToolName.GREP}, ${ToolName.SEARCH}, ${ToolName.LIST}).`,
      `Subagents run in parallel, so ensure jobs do not depend on each other.`,
      `Subagents can activate only when needed; keep tools minimal but include a verification path via inactiveTools.`,
      `After ${ToolName.SPAWN_SUBAGENT} returns, use its summarized results to continue or finalize in the conversation.`,
    ],
    category: 'orchestration',
    showDescriptionWhenInactive: true,
  },

  [ToolName.SWITCH_AGENT_CAPACITY]: {
    name: ToolName.SWITCH_AGENT_CAPACITY,
    description:
      'Switch the current conversation from direct response mode to tool and skill mode.',
    guidelines: [
      `When this tool is available alongside a small tool set, the user may still be in a limited mode: call ${ToolName.SWITCH_AGENT_CAPACITY} when they need the full agent so they can confirm. After confirmation, continue with vault and content tools as needed. This tool is not offered when the conversation already has the full Super Agent tool surface.`,
    ],
    category: 'tool-management',
  },

  [ToolName.CONCLUDE]: {
    name: ToolName.CONCLUDE,
    description: 'Signal task completion. The client stops sending another request.',
    guidelines: [
      `When you determine this is the last step of your work, call ${ToolName.CONCLUDE} in parallel (in the same request) with the tool that performs the final task.`,
      `Do NOT call ${ToolName.CONCLUDE} alone — it must always be paired with another tool call in the same request.`,
      `When using ${ToolName.CONCLUDE}, include a brief summary in your text response describing what you have accomplished.`,
    ],
    category: 'task-management',
  },

  [ToolName.RECALL_COMPACTED_CONTEXT]: {
    name: ToolName.RECALL_COMPACTED_CONTEXT,
    description:
      'Recall (retrieve) full content of earlier compacted messages by their messageIds.',
    guidelines: [
      `Use ${ToolName.RECALL_COMPACTED_CONTEXT} when you need full content from earlier messages that have been compacted.`,
      `Provide messageIds from the compacted conversation index (format: <id>, e.g. msg-abc123).`,
    ],
    category: 'context-retrieval',
  },

  [ToolName.SHELL]: {
    name: ToolName.SHELL,
    description:
      'Internal: start or continue a local shell transcript for the conversation. Not available to the model.',
    guidelines: ['Used only for client-side manual tool calls. Do not reference in prompts.'],
    category: 'internal',
    showDescriptionWhenInactive: false,
  },
};

export class ToolRegistry<T> {
  private readonly tools: Map<string, ToolDefinition> = new Map();
  private readonly excluded: Set<string> = new Set();
  private activeTools: Set<string> | null = null;
  private additionalGuidelines: Map<string, string[]> = new Map();

  public setAdditionalGuidelines(guidelines: Map<string, string[]>): this {
    this.additionalGuidelines = guidelines;
    return this;
  }

  public register(def: ToolDefinition): this {
    this.tools.set(def.name, def);
    return this;
  }

  public exclude(names: readonly string[]): this {
    for (const name of names) {
      this.excluded.add(name);
    }
    return this;
  }

  public setActive(names?: readonly string[]): this {
    if (typeof names === 'undefined') {
      this.activeTools = null;
      return this;
    }

    this.activeTools = new Set(names);
    return this;
  }

  private isActive(name: string): boolean {
    if (this.excluded.has(name)) {
      return false;
    }

    if (this.activeTools === null) {
      return true;
    }

    return this.activeTools.has(name);
  }

  /**
   * Tool names that are active (exposed to the model) in this registry.
   */
  public listActiveToolNames(): string[] {
    const names: string[] = [];
    for (const [name] of this.tools) {
      if (this.isActive(name)) {
        names.push(name);
      }
    }
    return names;
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
      const extra = this.additionalGuidelines.get(def.name);
      if (extra && extra.length > 0) {
        for (const g of extra) {
          guidelines.push(`- ${g}`);
        }
      }
      if (guidelines.length > 0) {
        sections.push(`**${def.name}**\n${guidelines.join('\n')}`);
      }
    }
    return sections.join('\n\n');
  }

  public generateOtherToolsSection(emptyLabel = '', exclude?: Set<string>): string {
    const lines: string[] = [];
    for (const [, def] of this.tools) {
      if (this.isActive(def.name)) continue;
      if (exclude?.has(def.name)) continue;
      const line = def.showDescriptionWhenInactive
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
        name,
        tool,
        description: meta?.description ?? ToolRegistry.extractFallbackDescription(tool),
        guidelines: meta?.guidelines ?? [],
        category: meta?.category,
        showDescriptionWhenInactive: meta?.showDescriptionWhenInactive ?? true,
      });
    }
    return registry;
  }

  private static extractFallbackDescription(tool: unknown): string {
    if (!tool || typeof tool !== 'object') {
      return '';
    }
    if (!('description' in tool)) {
      return '';
    }
    const description = (tool as { description?: unknown }).description;
    if (typeof description !== 'string') {
      return '';
    }
    return description;
  }
}

export { ToolName } from './toolNames';
