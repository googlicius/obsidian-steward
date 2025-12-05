export enum ToolName {
  CONTENT_READING = 'contentReading',
  CONFIRMATION = 'confirmation',
  ASK_USER = 'askUser',
  EDIT = 'edit',
  GREP = 'grep',
  REQUEST_READ_CONTENT = 'requestReadContent',
  CREATE = 'create',
  DELETE = 'delete',
  COPY = 'copy',
  RENAME = 'rename',
  MOVE = 'move',
  LIST = 'list',
  UPDATE_FRONTMATTER = 'update_frontmatter',
  ACTIVATE = 'activate_tools',
  REVERT_DELETE = 'revert_delete',
  REVERT_MOVE = 'revert_move',
  REVERT_FRONTMATTER = 'revert_frontmatter',
  GET_MOST_RECENT_ARTIFACT = 'get_most_recent_artifact',
  GET_ARTIFACT_BY_ID = 'get_artifact_by_id',
}

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
  // ReadCommandHandler tool
  [ToolName.CONTENT_READING]: {
    name: ToolName.CONTENT_READING,
    description: 'Read content from a note.',
    guidelines: [
      `Use ${ToolName.CONTENT_READING} to read any type of content, including text, image, audio, video, etc.`,
      `Read ALL notes at once with multiple ${ToolName.CONTENT_READING} tool calls.`,
    ],
    category: 'content-access',
  },

  // User interaction tools
  [ToolName.CONFIRMATION]: {
    name: ToolName.CONFIRMATION,
    description: 'Get confirmation from the user before performing an action.',
    guidelines: [
      `You MUST use ${ToolName.CONFIRMATION} BEFORE reading the entire content of any note. (When readType is "entire")`,
      `Use ${ToolName.CONFIRMATION} once for all note(s) to be read.`,
      `The ${ToolName.CONFIRMATION} tool also pauses the system until the user responds.`,
    ],
    category: 'user-interaction',
  },

  [ToolName.ASK_USER]: {
    name: ToolName.ASK_USER,
    description: 'Ask the user for additional information or clarification when needed.',
    guidelines: [
      `Use ${ToolName.ASK_USER} when you need clarification or additional information from the user to fulfill their request.`,
      `The ${ToolName.ASK_USER} tool also pauses the system until the user responds.`,
    ],
    category: 'user-interaction',
  },

  // Generate/Update common tools
  [ToolName.REQUEST_READ_CONTENT]: {
    name: ToolName.REQUEST_READ_CONTENT,
    description: 'Read content from notes to gather context before generating a response.',
    guidelines: [
      `Use ${ToolName.REQUEST_READ_CONTENT} to read the content above/below the current cursor or the entire note.`,
    ],
    category: 'content-access',
  },

  [ToolName.GREP]: {
    name: ToolName.GREP,
    description:
      'Check if files or folders exist, or search for specific text patterns in note content.',
    guidelines: [
      `Use ${ToolName.GREP} to check if one or many files or folders exist in the vault.`,
      `Use ${ToolName.GREP} to search for specific text patterns in note content when a pattern is provided with a single file path.`,
    ],
    category: 'vault-access',
  },

  [ToolName.EDIT]: {
    name: ToolName.EDIT,
    description: 'Update content by replacing old content with new content.',
    guidelines: [
      `Use the ${ToolName.EDIT} tool if you need to update existing content.`,
      'When updating content, return ONLY the specific changed content, not the entire surrounding context.',
      `Use ${ToolName.EDIT} to make the actual content changes. (NOTE: You cannot use this tool if a note does not exist.)`,
    ],
    category: 'content-edit',
  },

  [ToolName.CREATE]: {
    name: ToolName.CREATE,
    description: 'Create new notes and optionally populate them with content.',
    guidelines: [
      `Use ${ToolName.CREATE} to create every note requested by the user.`,
      `Provide the exact Markdown content that should be written to the note when available.`,
      `Ensure each note path includes the .md extension and points to the correct folder.`,
    ],
    category: 'content-create',
  },

  [ToolName.DELETE]: {
    name: ToolName.DELETE,
    description: 'Delete files from the vault using the configured trash behavior.',
    guidelines: [
      `Use the ${ToolName.DELETE} tool to remove files or notes from the vault.`,
      `List every file you plan to delete and ensure the paths are accurate.`,
    ],
    category: 'vault-access',
  },

  [ToolName.COPY]: {
    name: ToolName.COPY,
    description: 'Copy files to another folder.',
    guidelines: [
      `Use ${ToolName.COPY} to duplicate files into another folder.`,
      `Always provide the destination folder path for the copy operation.`,
      `Specify the files or artifactId for the copy operation.`,
    ],
    category: 'vault-access',
  },

  [ToolName.RENAME]: {
    name: ToolName.RENAME,
    description: 'Rename files to a new path or filename.',
    guidelines: [
      `Use ${ToolName.RENAME} to change the name or location of files.`,
      `Always provide both the current path and the new path for each file.`,
      `Set createFolderIfMissing to true when new destination folders are required.`,
    ],
    category: 'vault-access',
  },

  [ToolName.MOVE]: {
    name: ToolName.MOVE,
    description: 'Move files to another folder.',
    guidelines: [
      `Use ${ToolName.MOVE} to relocate files to another folder.`,
      `Always provide the destination folder path for the move operation.`,
      `Specify the files or artifactId for the move operation.`,
    ],
    category: 'vault-access',
  },

  [ToolName.LIST]: {
    name: ToolName.LIST,
    description: 'List files in the vault or a specific folder.',
    guidelines: [
      `Use ${ToolName.LIST} to list files in the vault or a specific folder.`,
      `Only include paths that you are confident exist.`,
    ],
    category: 'vault-access',
  },

  [ToolName.UPDATE_FRONTMATTER]: {
    name: ToolName.UPDATE_FRONTMATTER,
    description: 'Update frontmatter properties in notes (add, update, or delete properties).',
    guidelines: [
      `Use ${ToolName.UPDATE_FRONTMATTER} to modify frontmatter properties in notes.`,
      `Specify the files or artifactId containing the files to update.`,
      `For each property, provide a value to add/update, or omit the value to delete the property.`,
    ],
    category: 'vault-access',
  },

  [ToolName.ACTIVATE]: {
    name: ToolName.ACTIVATE,
    description: 'Request additional tools to be activated for the current session.',
    guidelines: [
      `Use ${ToolName.ACTIVATE} when you need another tool that is currently inactive to complete the task.`,
      `The ${ToolName.ACTIVATE} tool will return the schemas and guidelines of the requested tools.`,
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

  [ToolName.GET_MOST_RECENT_ARTIFACT]: {
    name: ToolName.GET_MOST_RECENT_ARTIFACT,
    description: 'Get the most recent artifact of specified types from the conversation.',
    guidelines: [
      `Use ${ToolName.GET_MOST_RECENT_ARTIFACT} to retrieve the most recent artifact matching the specified types.`,
      `This is useful when you need to find artifacts to perform revert operations.`,
      `Specify one or more artifact types to search for.`,
    ],
    category: 'artifact-access',
  },

  [ToolName.GET_ARTIFACT_BY_ID]: {
    name: ToolName.GET_ARTIFACT_BY_ID,
    description: 'Get a specific artifact by its ID from the conversation.',
    guidelines: [
      `Use ${ToolName.GET_ARTIFACT_BY_ID} to retrieve a specific artifact when you know its ID.`,
      `This is useful when you have an artifact ID from previous operations or user input.`,
    ],
    category: 'artifact-access',
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
    const lines: string[] = [];
    for (const [, def] of this.tools) {
      if (!this.isActive(def.name)) continue;
      for (const g of def.guidelines) {
        lines.push(`- ${g}`);
      }
    }
    return lines.join('\n');
  }

  public generateOtherToolsSection(emptyLabel = ''): string {
    const lines: string[] = [];
    for (const [, def] of this.tools) {
      if (this.isActive(def.name)) continue;
      lines.push(`- ${def.name}`);
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
  public static buildFromTools<T extends { [s: string]: unknown }>(
    tools: T,
    options?: { exclude?: ToolName[] }
  ) {
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
    if (options?.exclude?.length) {
      registry.exclude(options.exclude);
    }
    return registry;
  }
}

export type ToolRegistryOptions = {
  exclude?: ToolName[];
};
