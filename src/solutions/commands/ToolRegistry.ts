export enum ToolName {
  CONTENT_READING = 'contentReading',
  CONFIRMATION = 'confirmation',
  ASK_USER = 'askUser',
  EDIT = 'edit',
  GREP = 'grep',
  REQUEST_READ_CONTENT = 'requestReadContent',
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
    description: 'Search for specific text patterns in notes.',
    guidelines: [`Use ${ToolName.GREP} to find specific text patterns that need to be updated.`],
    category: 'content-search',
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
};

export class ToolRegistry<T> {
  private readonly tools: Map<ToolName, ToolDefinition> = new Map();
  private readonly excluded: Set<string> = new Set();

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

  public getToolsObject(): T {
    const obj: Record<string, unknown> = {};
    for (const [name, def] of this.tools) {
      if (this.excluded.has(name)) continue;
      obj[name] = def.tool;
    }
    return obj as T;
  }

  public generateToolsSection(): string {
    const lines: string[] = [];
    for (const [, def] of this.tools) {
      if (this.excluded.has(def.name)) continue;
      lines.push(`- ${def.name} - ${def.description}`);
    }
    return lines.join('\n');
  }

  public generateGuidelinesSection(): string {
    const lines: string[] = [];
    for (const [, def] of this.tools) {
      if (this.excluded.has(def.name)) continue;
      for (const g of def.guidelines) {
        lines.push(`- ${g}`);
      }
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
