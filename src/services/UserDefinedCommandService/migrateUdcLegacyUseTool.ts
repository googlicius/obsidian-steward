import { dump as yamlDump } from 'js-yaml';
import { ToolName } from 'src/solutions/commands/ToolRegistry';

/**
 * Migrates legacy `use_tool` from parsed UDC YAML objects (v2).
 * @returns Updated data and whether the object changed.
 */
export function migrateRawUdcObject(data: Record<string, unknown>): {
  data: Record<string, unknown>;
  changed: boolean;
} {
  if (!data || typeof data !== 'object') {
    return { data, changed: false };
  }
  if (!Object.prototype.hasOwnProperty.call(data, 'use_tool')) {
    return { data, changed: false };
  }
  const copy: Record<string, unknown> = { ...data };
  const wasDisabled = copy.use_tool === false;
  delete copy.use_tool;
  if (wasDisabled) {
    copy.tools = [ToolName.SWITCH_AGENT_CAPACITY];
  }
  return { data: copy, changed: true };
}

/** Replace the first ```yaml ... ``` fence inner content with migrated YAML text. */
export function replaceFirstYamlFenceContent(content: string, newYamlInner: string): string {
  let replaced = false;
  const updated = content.replace(/```yaml\s*([\s\S]*?)\s*```/i, () => {
    replaced = true;
    return `\`\`\`yaml\n${newYamlInner.trimEnd()}\n\`\`\``;
  });
  if (!replaced) {
    return content;
  }
  return updated;
}

export function stringifyUdcYaml(data: Record<string, unknown>): string {
  return yamlDump(data, {
    lineWidth: -1,
    noRefs: true,
    sortKeys: false,
  });
}
