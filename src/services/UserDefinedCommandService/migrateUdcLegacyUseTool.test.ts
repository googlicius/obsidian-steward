import {
  migrateRawUdcObject,
  replaceFirstYamlFenceContent,
  stringifyUdcYaml,
} from './migrateUdcLegacyUseTool';
import { ToolName } from 'src/solutions/commands/ToolRegistry';

describe('migrateUdcLegacyUseTool', () => {
  describe('migrateRawUdcObject', () => {
    it('returns unchanged when use_tool is absent', () => {
      const data = { command_name: 'x', steps: [{ query: 'q' }] };
      const r = migrateRawUdcObject(data);
      expect(r.changed).toBe(false);
      expect(r.data).toBe(data);
    });

    it('maps use_tool false to tools switch_agent_capacity and removes use_tool', () => {
      const data = {
        command_name: 'ask',
        use_tool: false,
        steps: [{ query: '$from_user' }],
      };
      const r = migrateRawUdcObject(data);
      expect(r.changed).toBe(true);
      expect(r.data.use_tool).toBeUndefined();
      expect(r.data.tools).toEqual([ToolName.SWITCH_AGENT_CAPACITY]);
      expect(r.data.command_name).toBe('ask');
    });

    it('removes use_tool true without adding tools', () => {
      const data = {
        command_name: 'plan',
        use_tool: true,
        steps: [{ query: 'x' }],
      };
      const r = migrateRawUdcObject(data);
      expect(r.changed).toBe(true);
      expect(r.data.use_tool).toBeUndefined();
      expect(r.data.tools).toBeUndefined();
    });

    it('does not mutate the original object', () => {
      const data = { command_name: 'a', use_tool: false, steps: [{ query: 'q' }] };
      migrateRawUdcObject(data);
      expect(data.use_tool).toBe(false);
    });
  });

  describe('replaceFirstYamlFenceContent', () => {
    it('replaces first yaml fence inner content', () => {
      const md = 'Intro\n\n```yaml\nold: 1\n```\n\nMore';
      const next = replaceFirstYamlFenceContent(md, 'new: 2');
      expect(next).toContain('```yaml\nnew: 2\n```');
      expect(next).not.toContain('old: 1');
    });

    it('returns original when no yaml fence', () => {
      const md = 'no fence';
      expect(replaceFirstYamlFenceContent(md, 'x')).toBe(md);
    });
  });

  describe('stringifyUdcYaml', () => {
    it('serializes a mapping to YAML text', () => {
      const y = stringifyUdcYaml({ command_name: 'c', steps: [{ query: 'q' }] });
      expect(y).toContain('command_name');
      expect(y).toContain('steps');
    });
  });
});
