import { ToolCallPart } from '../tools/types';
import { uniqueID } from 'src/utils/uniqueID';
import {
  getToolSyntaxMapping,
  type ArgMapping,
  type ToolSyntaxMapping,
} from './commandSyntaxMappings';
import { getInputNormalizer } from './normalizers';

const COMMAND_PREFIX = 'c:';

/**
 * Represents a single parsed command segment.
 */
export interface ParsedCommand {
  toolAlias: string;
  args: Record<string, string>;
}

export interface CommandSyntaxParseResult {
  commands: ParsedCommand[];
  errors: string[];
}

/**
 * Stateless parser that converts CLI-style command syntax into ToolCallPart objects.
 *
 * Syntax: `c:<tool> [--arg=value]... [; c:<tool> [--arg=value]...]`
 *
 * Examples:
 * - `c:read --blocks=1 --element=list`
 * - `c:edit --mode=replace_by_lines --from=5 --to=10`
 * - `c:read --blocks=1 --element=list; c:edit --mode=replace_by_lines`
 */
export class CommandSyntaxParser {
  /**
   * Check if a query string uses command syntax (starts with `c:`).
   */
  public static isCommandSyntax(query: string): boolean {
    return query.trimStart().startsWith(COMMAND_PREFIX);
  }

  /**
   * Parse a command syntax string into ParsedCommand objects.
   * Supports chaining with `;` separator.
   */
  public static parse(query: string): CommandSyntaxParseResult {
    const trimmed = query.trim();
    const segments = CommandSyntaxParser.splitChain(trimmed);
    const commands: ParsedCommand[] = [];
    const errors: string[] = [];

    for (const segment of segments) {
      const result = CommandSyntaxParser.parseSegment(segment);
      if (result.error) {
        errors.push(result.error);
      } else if (result.command) {
        commands.push(result.command);
      }
    }

    return { commands, errors };
  }

  /**
   * Convert parsed commands into ToolCallPart objects ready for handler dispatch.
   */
  public static toToolCalls(commands: ParsedCommand[]): ToolCallPart[] {
    const toolCalls: ToolCallPart[] = [];

    for (const command of commands) {
      const mapping = getToolSyntaxMapping(command.toolAlias);
      if (!mapping) {
        continue;
      }

      const input = CommandSyntaxParser.buildInput(command.args, mapping);
      toolCalls.push({
        type: 'tool-call',
        toolName: mapping.toolName,
        toolCallId: `cmd-syntax-${uniqueID()}`,
        input,
      });
    }

    return toolCalls;
  }

  /**
   * Convenience method: parse + toToolCalls in one call.
   * Returns null if parsing produces no valid tool calls.
   */
  public static parseAndConvert(query: string): ToolCallPart[] | null {
    if (!CommandSyntaxParser.isCommandSyntax(query)) {
      return null;
    }

    const { commands } = CommandSyntaxParser.parse(query);
    if (commands.length === 0) {
      return null;
    }

    const toolCalls = CommandSyntaxParser.toToolCalls(commands);
    return toolCalls.length > 0 ? toolCalls : null;
  }

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  /**
   * Split a chained command string on `;`, respecting quoted values.
   */
  private static splitChain(input: string): string[] {
    const segments: string[] = [];
    let current = '';
    let inQuote: string | null = null;

    for (let i = 0; i < input.length; i++) {
      const char = input[i];

      // Track quote state
      if ((char === '"' || char === "'") && (i === 0 || input[i - 1] !== '\\')) {
        if (inQuote === char) {
          inQuote = null;
        } else if (!inQuote) {
          inQuote = char;
        }
      }

      if (char === ';' && !inQuote) {
        const trimmed = current.trim();
        if (trimmed.length > 0) {
          segments.push(trimmed);
        }
        current = '';
      } else {
        current += char;
      }
    }

    const trimmed = current.trim();
    if (trimmed.length > 0) {
      segments.push(trimmed);
    }

    return segments;
  }

  /**
   * Parse a single `c:tool --arg=value ...` segment.
   */
  private static parseSegment(segment: string): { command?: ParsedCommand; error?: string } {
    const trimmed = segment.trim();

    if (!trimmed.startsWith(COMMAND_PREFIX)) {
      return { error: `Segment does not start with "${COMMAND_PREFIX}": ${trimmed}` };
    }

    // Extract tool alias: everything after c: until first space or end
    const afterPrefix = trimmed.slice(COMMAND_PREFIX.length);
    const spaceIndex = afterPrefix.indexOf(' ');
    const toolAlias = spaceIndex === -1 ? afterPrefix : afterPrefix.slice(0, spaceIndex);

    if (toolAlias.length === 0) {
      return { error: 'Empty tool alias after "c:"' };
    }

    // Validate that the alias is known
    const mapping = getToolSyntaxMapping(toolAlias);
    if (!mapping) {
      return { error: `Unknown tool alias: "${toolAlias}"` };
    }

    // Parse arguments from the rest of the string
    const argsString = spaceIndex === -1 ? '' : afterPrefix.slice(spaceIndex + 1).trim();
    const args = CommandSyntaxParser.parseArgs(argsString);

    return {
      command: { toolAlias, args },
    };
  }

  /**
   * Parse `--key=value` pairs from a string.
   * Supports quoted values for strings containing spaces.
   */
  private static parseArgs(input: string): Record<string, string> {
    const args: Record<string, string> = {};
    if (!input) {
      return args;
    }

    // Tokenize: split on whitespace but respect quotes
    const tokens = CommandSyntaxParser.tokenize(input);
    for (const token of tokens) {
      if (!token.startsWith('--')) {
        continue;
      }

      const withoutDashes = token.slice(2);
      const eqIndex = withoutDashes.indexOf('=');

      if (eqIndex === -1) {
        // Boolean flag: --flag means true
        args[withoutDashes] = 'true';
      } else {
        const key = withoutDashes.slice(0, eqIndex);
        let value = withoutDashes.slice(eqIndex + 1);

        // Strip surrounding quotes
        if (
          (value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))
        ) {
          value = value.slice(1, -1);
        }

        args[key] = value;
      }
    }

    return args;
  }

  /**
   * Tokenize a string by whitespace, keeping quoted substrings together.
   */
  private static tokenize(input: string): string[] {
    const tokens: string[] = [];
    let current = '';
    let inQuote: string | null = null;

    for (let i = 0; i < input.length; i++) {
      const char = input[i];

      if ((char === '"' || char === "'") && (i === 0 || input[i - 1] !== '\\')) {
        if (inQuote === char) {
          current += char;
          inQuote = null;
          continue;
        } else if (!inQuote) {
          inQuote = char;
          current += char;
          continue;
        }
      }

      if (char === ' ' && !inQuote) {
        if (current.length > 0) {
          tokens.push(current);
          current = '';
        }
      } else {
        current += char;
      }
    }

    if (current.length > 0) {
      tokens.push(current);
    }

    return tokens;
  }

  /**
   * Set a value in an object using dot notation for nested paths.
   * @example setNestedValue(obj, 'validation.expectedArtifactType', 'note')
   */
  private static setNestedValue(
    obj: Record<string, unknown>,
    path: string,
    value: unknown
  ): void {
    const segments = path.split('.');
    let current = obj;

    for (let i = 0; i < segments.length - 1; i++) {
      const segment = segments[i];
      if (!current[segment] || typeof current[segment] !== 'object') {
        current[segment] = {};
      }
      current = current[segment] as Record<string, unknown>;
    }

    current[segments[segments.length - 1]] = value;
  }

  /**
   * Build the tool input object from raw parsed args and the tool mapping.
   * Applies type coercion based on the ArgMapping type hints, then merges defaults.
   */
  private static buildInput(
    rawArgs: Record<string, string>,
    mapping: ToolSyntaxMapping
  ): Record<string, unknown> {
    const input: Record<string, unknown> = {};

    // Apply defaults first
    if (mapping.defaults) {
      for (const [key, value] of Object.entries(mapping.defaults)) {
        input[key] = value;
      }
    }

    // Map and coerce each raw arg
    for (const [flag, rawValue] of Object.entries(rawArgs)) {
      const argMapping = mapping.argMap[flag];
      if (!argMapping) {
        // Unknown flag -- skip silently (could be a typo)
        continue;
      }

      const coercedValue = CommandSyntaxParser.coerceValue(rawValue, argMapping);

      // Support nested field paths (e.g., 'validation.expectedArtifactType')
      if (argMapping.field.includes('.')) {
        CommandSyntaxParser.setNestedValue(input, argMapping.field, coercedValue);
      } else {
        input[argMapping.field] = coercedValue;
      }
    }

    // Special handling per tool to wrap args in the expected schema structure
    return CommandSyntaxParser.normalizeInput(mapping, input);
  }

  /**
   * Coerce a raw string value to the correct type based on the ArgMapping.
   */
  private static coerceValue(raw: string, mapping: ArgMapping): unknown {
    switch (mapping.type) {
      case 'number': {
        const num = parseFloat(raw);
        return isNaN(num) ? raw : num;
      }
      case 'boolean':
        return raw.toLowerCase() === 'true';
      case 'string[]':
        return raw
          .split(',')
          .map(s => s.trim())
          .filter(s => s.length > 0);
      case 'json': {
        try {
          return JSON.parse(raw);
        } catch {
          // If not valid JSON, try to parse as a simple key:value format
          // e.g. "tag:delete" -> [{name: "tag", value: "delete"}]
          return CommandSyntaxParser.parseSimpleProperties(raw);
        }
      }
      case 'string':
      default:
        return raw;
    }
  }

  /**
   * Parse simple property format: "name:value,name2:value2"
   * Returns an array of {name, value} objects suitable for search properties.
   */
  private static parseSimpleProperties(raw: string): Array<{ name: string; value: string }> {
    const pairs = raw
      .split(',')
      .map(s => s.trim())
      .filter(s => s.length > 0);
    const result: Array<{ name: string; value: string }> = [];

    for (const pair of pairs) {
      const colonIdx = pair.indexOf(':');
      if (colonIdx === -1) {
        continue;
      }
      const name = pair.slice(0, colonIdx).trim();
      const value = pair.slice(colonIdx + 1).trim();
      if (name && value) {
        result.push({ name, value });
      }
    }

    return result;
  }

  /**
   * Normalize flat input into the structure expected by each tool's schema.
   * Delegates to the registered {@link InputNormalizer} for the tool, if one exists.
   */
  private static normalizeInput(
    mapping: ToolSyntaxMapping,
    input: Record<string, unknown>
  ): Record<string, unknown> {
    const normalizer = getInputNormalizer(mapping.toolName);
    return normalizer ? normalizer.normalize(input) : input;
  }
}
