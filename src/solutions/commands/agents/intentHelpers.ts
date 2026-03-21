import { ToolName } from '../ToolRegistry';

const VALID_TOOL_NAMES = new Set<string>(Object.values(ToolName));

/** Default intent type for the main (super) agent. Matches COMMAND_CONTENT_REQUIRED and CommandProcessorService registration. */
export const DEFAULT_INTENT_TYPE = ' ';

export function parseIntentType(intentType: string): {
  baseType: string;
  queryParams: URLSearchParams | null;
} {
  const [baseType, queryString] = intentType.split('?', 2);
  if (!queryString) {
    return { baseType, queryParams: null };
  }

  return {
    baseType,
    queryParams: new URLSearchParams(queryString),
  };
}

export function extractToolsFromQuery(queryParams: URLSearchParams | null): ToolName[] {
  if (!queryParams) {
    return [];
  }

  const tools: ToolName[] = [];
  const seen = new Set<ToolName>();

  const rawValues = queryParams.getAll('tools');
  if (rawValues.length === 0) {
    return tools;
  }

  const candidates = rawValues
    .flatMap(entry => entry.split(','))
    .map(value => value.trim())
    .filter(value => value.length > 0);

  for (const candidate of candidates) {
    if (!VALID_TOOL_NAMES.has(candidate)) {
      continue;
    }

    const toolName = candidate as ToolName;
    if (seen.has(toolName)) {
      continue;
    }

    seen.add(toolName);
    tools.push(toolName);
  }

  return tools;
}
