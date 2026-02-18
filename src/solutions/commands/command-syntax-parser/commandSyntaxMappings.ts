import { ToolName } from '../toolNames';
import { createArgMap } from './createArgMap';

import { contentReadingSchema } from '../agents/handlers/ReadContent';
import { searchOperationSchema } from '../agents/handlers/Search';
import { listToolSchema } from '../agents/handlers/VaultList';
import { grepSchema } from '../tools/grep';
import { speechSchema } from '../agents/handlers/Speech';
import { imageSchema } from '../agents/handlers/Image';
import { concludeSchema } from '../agents/handlers/Conclude';
import {
  artifactModeSchema,
  filesModeSchema,
  moveToolSchema,
} from '../agents/handlers/VaultMove';
import { renameDelegateSchema } from '../agents/handlers/VaultRename';
import {
  replaceByLinesSchema,
  insertSchema,
  replaceByPatternSchema,
  addTableColumnSchema,
  updateTableColumnSchema,
} from '../tools/editContent';

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
      // Command-syntax-only flag — not in the Zod schema.
      // ReadContentInputNormalizer embeds it into fileNames as "artifact:<value>".
      artifact: { field: 'artifact', type: 'string' },
      ...createArgMap(contentReadingSchema, {
        type: 'readType',
        files: 'fileNames',
        element: 'elementType',
        blocks: 'blocksToRead',
        pattern: 'pattern',
        placeholder: 'foundPlaceholder',
      }),
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
      // replace_by_lines
      ...createArgMap(replaceByLinesSchema, {
        path: 'path',
        content: 'content',
        from: 'fromLine',
        to: 'toLine',
      }),
      // insert
      ...createArgMap(insertSchema, {
        line: 'line',
      }),
      // replace_by_pattern
      ...createArgMap(replaceByPatternSchema, {
        artifact: 'artifactId',
        pattern: 'searchPattern',
        replace: 'replacement',
      }),
      // add_table_column / update_table_column share fromLine, toLine, path, content
      // already covered above — unique fields:
      ...createArgMap(addTableColumnSchema, {
        insertafter: 'insertAfter',
        insertbefore: 'insertBefore',
      }),
      // update_table_column
      ...createArgMap(updateTableColumnSchema, {
        position: 'position',
      }),
      // delete_table_column shares position, fromLine, toLine, path — all covered
    },
    defaults: {
      explanation: 'Command syntax edit',
    },
  },

  search: {
    toolName: ToolName.SEARCH,
    argMap: createArgMap(searchOperationSchema, {
      keywords: 'keywords',
      filenames: 'filenames',
      folders: 'folders',
      properties: 'properties',
    }),
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
    argMap: createArgMap(listToolSchema, {
      folder: 'folderPath',
      pattern: 'filePattern',
    }),
  },

  move: {
    toolName: ToolName.MOVE,
    argMap: {
      ...createArgMap(artifactModeSchema, {
        artifact: 'artifactId',
      }),
      ...createArgMap(filesModeSchema, {
        files: 'files',
      }),
      ...createArgMap(moveToolSchema, {
        destination: 'destinationFolder',
      }),
    },
  },

  rename: {
    toolName: ToolName.RENAME,
    argMap: createArgMap(renameDelegateSchema, {
      artifact: 'artifactId',
      query: 'query',
    }),
  },

  grep: {
    toolName: ToolName.GREP,
    argMap: createArgMap(grepSchema, {
      pattern: 'contentPattern',
      paths: 'paths',
    }),
  },

  speech: {
    toolName: ToolName.SPEECH,
    argMap: createArgMap(speechSchema, {
      text: 'text',
    }),
    defaults: {
      explanation: 'Command syntax speech',
      confidence: 1,
    },
  },

  image: {
    toolName: ToolName.IMAGE,
    argMap: createArgMap(imageSchema, {
      prompt: 'text',
    }),
    defaults: {
      explanation: 'Command syntax image',
      confidence: 1,
    },
  },

  conclude: {
    toolName: ToolName.CONCLUDE,
    argMap: createArgMap(concludeSchema, {
      text: 'conclusion',
      parallel: 'parallelToolName',
    }),
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
