import { ToolName } from './toolNames';

/**
 * Describes how a CLI flag maps to a schema field.
 */
export interface ArgMapping {
  /** The target schema field name */
  field: string;
  /**
   * Value type hint for coercion.
   * - 'string': keep as-is
   * - 'number': parseFloat
   * - 'boolean': 'true'/'false'
   * - 'string[]': split on comma
   * - 'json': JSON.parse (for complex objects like property arrays)
   */
  type: 'string' | 'number' | 'boolean' | 'string[]' | 'json';
}

export interface ToolSyntaxMapping {
  toolName: ToolName;
  /** Maps CLI flag name (without --) to the schema field and its type */
  argMap: Record<string, ArgMapping>;
  /** Default values merged into the input before arg overrides */
  defaults?: Record<string, unknown>;
}

/**
 * Registry of tool aliases to their ToolName, argument mappings, and defaults.
 *
 * Only tools suitable for direct invocation are included.
 * Internal tools (CONFIRMATION, STOP, THANK_YOU, revert tools, etc.) are excluded.
 */
export const COMMAND_SYNTAX_MAPPINGS: Record<string, ToolSyntaxMapping> = {
  read: {
    toolName: ToolName.CONTENT_READING,
    argMap: {
      type: { field: 'readType', type: 'string' },
      files: { field: 'fileNames', type: 'string[]' },
      element: { field: 'elementType', type: 'string' },
      blocks: { field: 'blocksToRead', type: 'number' },
      pattern: { field: 'pattern', type: 'string' },
      placeholder: { field: 'foundPlaceholder', type: 'string' },
    },
    defaults: {
      readType: 'above',
      blocksToRead: 1,
      fileNames: [],
      elementType: null,
      confidence: 1,
    },
  },

  edit: {
    toolName: ToolName.EDIT,
    argMap: {
      mode: { field: 'mode', type: 'string' },
      path: { field: 'path', type: 'string' },
      content: { field: 'content', type: 'string' },
      from: { field: 'fromLine', type: 'number' },
      to: { field: 'toLine', type: 'number' },
      line: { field: 'line', type: 'number' },
      pattern: { field: 'searchPattern', type: 'string' },
      replace: { field: 'replacement', type: 'string' },
      artifact: { field: 'artifactId', type: 'string' },
    },
    defaults: {
      explanation: 'Command syntax edit',
    },
  },

  search: {
    toolName: ToolName.SEARCH,
    argMap: {
      keywords: { field: 'keywords', type: 'string[]' },
      filenames: { field: 'filenames', type: 'string[]' },
      folders: { field: 'folders', type: 'string[]' },
      properties: { field: 'properties', type: 'json' },
    },
    defaults: {
      confidence: 1,
    },
  },

  delete: {
    toolName: ToolName.DELETE,
    argMap: {
      artifact: { field: 'artifactId', type: 'string' },
      files: { field: 'files', type: 'string[]' },
    },
  },

  list: {
    toolName: ToolName.LIST,
    argMap: {
      folder: { field: 'folderPath', type: 'string' },
      pattern: { field: 'filePattern', type: 'string' },
    },
  },

  move: {
    toolName: ToolName.MOVE,
    argMap: {
      artifact: { field: 'artifactId', type: 'string' },
      files: { field: 'files', type: 'string[]' },
      destination: { field: 'destinationFolder', type: 'string' },
    },
  },

  rename: {
    toolName: ToolName.RENAME,
    argMap: {
      artifact: { field: 'artifactId', type: 'string' },
      pattern: { field: 'query', type: 'string' },
      replace: { field: 'query', type: 'string' },
    },
  },

  grep: {
    toolName: ToolName.GREP,
    argMap: {
      pattern: { field: 'contentPattern', type: 'string' },
      paths: { field: 'paths', type: 'string[]' },
    },
  },

  speech: {
    toolName: ToolName.SPEECH,
    argMap: {
      text: { field: 'text', type: 'string' },
    },
    defaults: {
      explanation: 'Command syntax speech',
      confidence: 1,
    },
  },

  image: {
    toolName: ToolName.IMAGE,
    argMap: {
      prompt: { field: 'text', type: 'string' },
    },
    defaults: {
      explanation: 'Command syntax image',
      confidence: 1,
    },
  },

  conclude: {
    toolName: ToolName.CONCLUDE,
    argMap: {
      text: { field: 'conclusion', type: 'string' },
      parallel: { field: 'parallelToolName', type: 'string' },
      artifact: { field: 'expectedArtifactType', type: 'string' },
    },
    defaults: {
      conclusion: 'Done.',
      parallelToolName: '',
      validation: {},
    },
  },
};

/**
 * Get a mapping by tool alias, or undefined if not found.
 */
export function getToolSyntaxMapping(alias: string): ToolSyntaxMapping | undefined {
  return COMMAND_SYNTAX_MAPPINGS[alias.toLowerCase()];
}

/**
 * Get all available tool alias names for documentation / validation.
 */
export function getToolAliases(): string[] {
  return Object.keys(COMMAND_SYNTAX_MAPPINGS);
}
