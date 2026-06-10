import { ToolName } from './toolNames';
import { joinWithConjunction } from 'src/utils/arrayUtils';
import { MarkdownBuilder } from 'src/utils/MarkdownBuilder';
import { revertAbleArtifactTypes } from '../artifact';
import { EditMode } from './tools/editContent';
import { getShowWidgetThemeGuideline } from './agents/handlers/ShowWidget';

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
  /** Whether to show the description when inactive, default to false */
  showDescriptionWhenInactive?: boolean;
  /** Tools auto-activated alongside this tool when it becomes active */
  companionTools?: readonly ToolName[];
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
    companionTools: [ToolName.CONFIRMATION, ToolName.ASK_USER],
    guidelines: [
      `When reading notes:
  - Specify the number of blocks to read (blocksToRead) carefully from the user's query, Do NOT set -1 unless the user explicitly requests to read the entire content.
  - Specify the direction to read (readType) carefully from the user's query, Do NOT set "entire" unless the user explicitly requests to read the entire content.`,
      `When reading multiple files, you MUST make multiple parallel tool calls in the same request (one ${ToolName.CONTENT_READING} call per file). Do NOT read files sequentially one by one. EXCEPT when the user explicitly requests it.`,
      `To read or inspect hidden (dot-prefixed) files or paths under a hidden folder, use the ${ToolName.SHELL} tool (e.g. cat, type, or Get-Content) from the vault root; the read tool cannot use the editor for those paths.`,
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

  [ToolName.NEW_SESSION]: {
    name: ToolName.NEW_SESSION,
    description: 'Close the current conversation embed and start a fresh chat session.',
    guidelines: [],
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
    companionTools: [ToolName.SEARCH_MORE],
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
      `When updating content, return ONLY the specific changed content, not the entire surrounding context.
  - Use ${ToolName.EDIT} to make the actual content changes. (NOTE: You cannot use this tool if a note does not exist.)
  - Use the right edit mode to ensure good performance and efficient token usage.`,
      `Choose edit mode by purpose:
  - **Tables**: Read the "edit-table" skill first. It covers ${EditMode.ADD_TABLE_COLUMN}, ${EditMode.UPDATE_TABLE_COLUMN}, and ${EditMode.DELETE_TABLE_COLUMN}.
  - **Replace by line range**: Use ${EditMode.REPLACE_BY_LINES} to replace content within fromLine–toLine, or omit both to replace the entire file.
  - **Pattern replacement**: Use ${EditMode.REPLACE_BY_PATTERN} to replace matches by RegExp in one note (path) or many notes (artifactId). Requires artifactId or path.
  - **Insert**: Use ${EditMode.INSERT} to insert content at a specific line number.
  - Use one or multiple operations in a single call. DO NOT use multiple tool calls or multiple requests.`,
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
    ],
    category: 'content-create',
  },

  [ToolName.DELETE]: {
    name: ToolName.DELETE,
    description: 'Delete files from the vault using the configured trash behavior.',
    guidelines: [
      `- List every file using the ${ToolName.LIST} tool (NOT ${ToolName.GREP}) you plan to delete and ensure the paths are accurate.`,
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
    guidelines: [`Always provide both the current path and the new path for each file.`],
    category: 'vault-access',
  },

  [ToolName.MOVE]: {
    name: ToolName.MOVE,
    description: 'Move files to another folder.',
    guidelines: [
      'Always provide the destination folder path for the move operation.',
      'Specify the files or artifactId for the move operation.',
    ],
    category: 'vault-access',
  },

  [ToolName.LIST]: {
    name: ToolName.LIST,
    description:
      'List direct files and subfolders in a folder (non-recursive) and optionally filter names with filePattern.',
    guidelines: [],
    category: 'vault-access',
    showDescriptionWhenInactive: true,
  },

  [ToolName.UPDATE_FRONTMATTER]: {
    name: ToolName.UPDATE_FRONTMATTER,
    description: 'Update frontmatter properties in notes (add, update, or delete properties).',
    guidelines: [`Use ${ToolName.UPDATE_FRONTMATTER} to modify frontmatter properties in notes.`],
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
    companionTools: [ToolName.GET_MOST_RECENT_ARTIFACT, ToolName.GET_ARTIFACT_BY_ID],
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
    showDescriptionWhenInactive: true,
  },

  [ToolName.SHOW_WIDGET]: {
    name: ToolName.SHOW_WIDGET,
    description:
      'Render a self-contained HTML or SVG widget inline in the conversation. Supports static animations, interactive demos with click/keyboard handlers, and visual diagrams. Use when the user asks for an animation, demo, making a game, or dynamic visualization',
    companionTools: [ToolName.GET_ARTIFACT_BY_ID, ToolName.EDIT, ToolName.CONTENT_READING],
    guidelines: [
      'Set type to "html" for full HTML widgets, or "svg" for vector graphics.',
      'For HTML widgets, use project mode: files as [{ name, content }, ...] — split index.html, style.css, main.js, etc. instead of one inline HTML blob. Link them from index.html (<link href="style.css">, <script src="main.js">); they are bundled into one document at render. Always provide widgetName (natural language); for project mode it builds widgetId and the vault folder under Steward/Widgets/{widgetId}/. Widgets are conversation-independent; reference widgetId across conversations.',
      'For interactive project widgets (games, counters, forms) that must remember user actions, read the "stateful-widget" skill (via content_reading) before generating widget code.',
      'For turn-based widgets where humans and models take turns (games vs AI, poker, chess, etc.), read the "interactive-widget" skill after stateful-widget — it covers registerAction, Widget.md (actions, actors, agent blocks), and validation.',
      'For SVG, use non-project mode (code). Code must be self-contained, no external CDN.',
      'When the user provides files (images, SVGs, etc.), MUST add their original paths to assets (e.g. Images/photo.png) and reference them in HTML with the "asset:" prefix (e.g. src="asset:Images/photo.png", href, or CSS url()). Files are read from the vault and bundled as base64 data URLs at render time.',
      `After rendering a project widget, if the user ask for update, use ${ToolName.EDIT} and ${ToolName.CONTENT_READING} on the projectPath returned in the tool result.`,
    ],
    category: 'content-generation',
    showDescriptionWhenInactive: true,
  },

  [ToolName.WIDGET_ACTION]: {
    name: ToolName.WIDGET_ACTION,
    description:
      'Apply one allowed widget action during a widget session turn. Used by model actors in turn-based interactive widgets.',
    guidelines: [],
    category: 'content-generation',
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
    description: `Run a host/OS shell command or open an interactive terminal in the current conversation. Use only when the user EXPLICITLY wants a command (Linux, Windows, etc.). For example: cd, cat, pwd, ls, etc. Or TUI apps: vim, htop, etc. If you are unsure whether the action is a shell command or a user-defined command, activate ${ToolName.RUN_COMMAND} to check the USER-DEFINED COMMANDS section below.`,
    guidelines: [
      'When deciding to run a shell command, no need to ask the user for consent, the system will do that.',
      `Put the exact shell line in argsLine when the user explicitly wants it executed on the host.`,
    ],
    category: 'cli',
    showDescriptionWhenInactive: true,
  },

  [ToolName.RUN_COMMAND]: {
    name: ToolName.RUN_COMMAND,
    description:
      'Run an user-defined command by its command name (see USER-DEFINED COMMANDS section). Use when the workflow needs to execute a command',
    guidelines: [
      `No need  to read the command definition note, the command body (instructions, tools, agents, etc.) is loaded automatically when calling this tool.`,
    ],
    category: 'orchestration',
    showDescriptionWhenInactive: true,
  },
};

export class ToolRegistry<T> {
  private readonly tools: Map<string, ToolDefinition> = new Map();
  private readonly excluded: Set<string> = new Set();
  private activeTools: Set<string> | null = null;
  private guardrailGuidelines: Map<string, string[]> = new Map();
  private memoryGuidelines: Map<string, string[]> = new Map();

  public setSupplementalGuidelines(params: {
    guardrails: Map<string, string[]>;
    memory: Map<string, string[]>;
  }): this {
    this.guardrailGuidelines = params.guardrails;
    this.memoryGuidelines = params.memory;
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

  public generateGuidelinesSection(params?: { memorySourcePath?: string }): string {
    const sections: string[] = [];
    for (const [, def] of this.tools) {
      if (!this.isActive(def.name)) continue;

      const builtIn =
        (def.name as ToolName) === ToolName.SHOW_WIDGET
          ? [...def.guidelines, getShowWidgetThemeGuideline()]
          : def.guidelines;

      const toolSection = this.buildToolGuidelinesSection({
        toolName: def.name,
        builtIn,
        memorySourcePath: params?.memorySourcePath,
      });
      if (toolSection) {
        sections.push(toolSection);
      }
    }
    return sections.join('\n\n');
  }

  private buildGuidelinesSectionBody(memorySourcePath: string): string {
    const toolSections = this.generateGuidelinesSection({ memorySourcePath });
    if (!toolSections.trim()) {
      return '';
    }

    const parts: string[] = [];
    if (this.hasActiveMemoryGuidelines()) {
      parts.push(
        `Additional tool instructions from memory appear under the **Memory** subheading for each tool. Edit them in ${memorySourcePath}.`
      );
    }
    parts.push(toolSections);
    return parts.join('\n\n');
  }

  private hasActiveMemoryGuidelines(): boolean {
    for (const [name] of this.tools) {
      if (!this.isActive(name)) continue;
      const memory = this.memoryGuidelines.get(name);
      if (memory && memory.length > 0) {
        return true;
      }
    }
    return false;
  }

  public generateToolSectionBody(params: {
    inactiveToolCount: number;
    otherToolsExclude?: Set<string>;
    otherToolsEmptyLabel: string;
    memorySourcePath: string;
  }): string {
    const otherToolsBody = this.buildOtherToolsSectionBody({
      inactiveToolCount: params.inactiveToolCount,
      exclude: params.otherToolsExclude,
      emptyLabel: params.otherToolsEmptyLabel,
    });

    return new MarkdownBuilder()
      .addSection('### Available tools', this.generateToolsSection())
      .addSection('### Guidelines', this.buildGuidelinesSectionBody(params.memorySourcePath))
      .addSection('### Other tools', otherToolsBody)
      .build();
  }

  private buildOtherToolsSectionBody(params: {
    inactiveToolCount: number;
    exclude?: Set<string>;
    emptyLabel: string;
  }): string {
    const list = this.generateOtherToolsSection('', params.exclude);
    if (!list.trim()) {
      return params.emptyLabel;
    }
    return `${params.inactiveToolCount} inactive tools; activate before using them.\n${list}`;
  }

  private buildToolGuidelinesSection(params: {
    toolName: string;
    builtIn: string[];
    memorySourcePath?: string;
  }): string {
    const guardrails = this.guardrailGuidelines.get(params.toolName) ?? [];
    const memory = this.memoryGuidelines.get(params.toolName) ?? [];

    if (params.builtIn.length === 0 && guardrails.length === 0 && memory.length === 0) {
      return '';
    }

    const builder = new MarkdownBuilder();
    builder.addSection(
      `#### ${params.toolName}`,
      this.buildGuidelineSourceSections({
        builtIn: params.builtIn,
        guardrails,
        memory,
        memorySourcePath: params.memorySourcePath,
      })
    );
    return builder.build();
  }

  private buildGuidelineSourceSections(params: {
    builtIn: string[];
    guardrails: string[];
    memory: string[];
    memorySourcePath?: string;
  }): string {
    const parts: string[] = [];

    const builtInBullets = ToolRegistry.formatGuidelineBullets(params.builtIn);
    if (builtInBullets) {
      parts.push(builtInBullets);
    }

    const supplemental = new MarkdownBuilder()
      .addSection('##### Guardrails', ToolRegistry.formatGuidelineBullets(params.guardrails))
      .addSection(
        '##### Memory',
        ToolRegistry.formatMemoryGuidelineSection(params.memory, params.memorySourcePath)
      )
      .build();
    if (supplemental) {
      parts.push(supplemental);
    }

    return parts.join('\n\n');
  }

  private static formatGuidelineBullets(lines: string[]): string {
    if (lines.length === 0) {
      return '';
    }
    const bullets: string[] = [];
    for (let i = 0; i < lines.length; i++) {
      bullets.push(`- ${lines[i]}`);
    }
    return bullets.join('\n');
  }

  private static formatMemoryGuidelineSection(lines: string[], memorySourcePath?: string): string {
    if (lines.length === 0) {
      return '';
    }
    const bullets = ToolRegistry.formatGuidelineBullets(lines);
    if (!memorySourcePath) {
      return bullets;
    }
    return `${bullets}\n(from ${memorySourcePath})`;
  }

  /**
   * Tool names registered but not active in this registry (optional exclude list).
   */
  public listInactiveToolNames(exclude?: Set<string>): string[] {
    const names: string[] = [];
    for (const [, def] of this.tools) {
      if (this.isActive(def.name)) continue;
      if (exclude?.has(def.name)) continue;
      names.push(def.name);
    }
    return names;
  }

  public generateOtherToolsSection(emptyLabel = '', exclude?: Set<string>): string {
    const inactiveNames = this.listInactiveToolNames(exclude);
    if (inactiveNames.length === 0) {
      return emptyLabel;
    }

    const lines: string[] = [];
    for (const name of inactiveNames) {
      const def = this.tools.get(name);
      if (!def) continue;
      const line = def.showDescriptionWhenInactive
        ? `- ${def.name} - ${def.description}`
        : `- ${def.name}`;
      lines.push(line);
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
        showDescriptionWhenInactive: meta?.showDescriptionWhenInactive ?? false,
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

  /**
   * Companion tools declared for a tool in {@link TOOL_DEFINITIONS}.
   */
  public static getCompanionTools(toolName: ToolName): ToolName[] {
    const companions = TOOL_DEFINITIONS[toolName]?.companionTools;
    if (!companions || companions.length === 0) {
      return [];
    }
    return [...companions];
  }

  /**
   * Expand a tool list with companion tools from {@link TOOL_DEFINITIONS}.
   * Preserves input order; companions are appended after each primary tool.
   */
  public static expandWithCompanionTools(names: readonly ToolName[]): ToolName[] {
    const result: ToolName[] = [];
    const seen = new Set<ToolName>();

    for (const name of names) {
      if (!seen.has(name)) {
        seen.add(name);
        result.push(name);
      }

      for (const companion of ToolRegistry.getCompanionTools(name)) {
        if (seen.has(companion)) {
          continue;
        }
        seen.add(companion);
        result.push(companion);
      }
    }

    return result;
  }
}

export { ToolName } from './toolNames';
