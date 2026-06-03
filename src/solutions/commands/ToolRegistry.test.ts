import { ToolRegistry, ToolName } from './ToolRegistry';

describe('ToolRegistry', () => {
  describe('buildFromTools', () => {
    it('should build a registry from tools and register all tools', () => {
      const mockTool1 = jest.fn();
      const mockTool2 = jest.fn();
      const tools = {
        [ToolName.CONTENT_READING]: mockTool1,
        [ToolName.EDIT]: mockTool2,
      };

      const registry = ToolRegistry.buildFromTools(tools);

      const toolsObject = registry.getToolsObject();
      expect(toolsObject[ToolName.CONTENT_READING]).toBe(mockTool1);
      expect(toolsObject[ToolName.EDIT]).toBe(mockTool2);
    });

    it('defaults showDescriptionWhenInactive to false when meta omits it', () => {
      const registry = ToolRegistry.buildFromTools({
        [ToolName.HELP]: jest.fn(),
        [ToolName.CONTENT_READING]: jest.fn(),
      });
      registry.setActive([ToolName.CONTENT_READING]);

      const section = registry.generateOtherToolsSection();

      expect(section).toBe(`- ${ToolName.HELP}`);
    });

    it('uses showDescriptionWhenInactive true from TOOL_DEFINITIONS when set', () => {
      const registry = ToolRegistry.buildFromTools({
        [ToolName.HELP]: jest.fn(),
        [ToolName.CONTENT_READING]: jest.fn(),
      });
      registry.setActive([ToolName.HELP]);

      const section = registry.generateOtherToolsSection();

      expect(section).toContain(`- ${ToolName.CONTENT_READING} -`);
      expect(section).toContain('Read content from a note');
    });
  });

  describe('listInactiveToolNames', () => {
    it('returns inactive tool names respecting exclude', () => {
      const registry = new ToolRegistry();
      registry.register({
        name: 'active_tool',
        tool: {},
        description: '',
        guidelines: [],
      });
      registry.register({
        name: 'inactive_tool',
        tool: {},
        description: '',
        guidelines: [],
      });
      registry.register({
        name: 'excluded_tool',
        tool: {},
        description: '',
        guidelines: [],
      });
      registry.setActive(['active_tool']);

      expect(registry.listInactiveToolNames()).toEqual(['inactive_tool', 'excluded_tool']);
      expect(registry.listInactiveToolNames(new Set(['excluded_tool']))).toEqual(['inactive_tool']);
    });
  });

  describe('companion tools', () => {
    it('returns companions from TOOL_DEFINITIONS', () => {
      expect(ToolRegistry.getCompanionTools(ToolName.CONTENT_READING)).toEqual([
        ToolName.CONFIRMATION,
        ToolName.ASK_USER,
      ]);
      expect(ToolRegistry.getCompanionTools(ToolName.EDIT)).toEqual([]);
    });

    it('expands primary tools with their companions', () => {
      expect(ToolRegistry.expandWithCompanionTools([ToolName.CONTENT_READING])).toEqual([
        ToolName.CONTENT_READING,
        ToolName.CONFIRMATION,
        ToolName.ASK_USER,
      ]);
    });

    it('dedupes overlapping tools', () => {
      expect(
        ToolRegistry.expandWithCompanionTools([ToolName.CONTENT_READING, ToolName.CONFIRMATION])
      ).toEqual([ToolName.CONTENT_READING, ToolName.CONFIRMATION, ToolName.ASK_USER]);
    });
  });

  describe('generateOtherToolsSection', () => {
    it('shows name only when showDescriptionWhenInactive is false', () => {
      const registry = new ToolRegistry();
      registry.register({
        name: 'inactive_tool',
        tool: {},
        description: 'Hidden description',
        guidelines: [],
        showDescriptionWhenInactive: false,
      });
      registry.setActive([]);

      expect(registry.generateOtherToolsSection()).toBe('- inactive_tool');
    });

    it('shows name and description when showDescriptionWhenInactive is true', () => {
      const registry = new ToolRegistry();
      registry.register({
        name: 'inactive_tool',
        tool: {},
        description: 'Visible description',
        guidelines: [],
        showDescriptionWhenInactive: true,
      });
      registry.setActive([]);

      expect(registry.generateOtherToolsSection()).toBe('- inactive_tool - Visible description');
    });

    it('shows name only when showDescriptionWhenInactive is omitted on register', () => {
      const registry = new ToolRegistry();
      registry.register({
        name: 'inactive_tool',
        tool: {},
        description: 'Omitted flag description',
        guidelines: [],
      });
      registry.setActive([]);

      expect(registry.generateOtherToolsSection()).toBe('- inactive_tool');
    });
  });

  describe('generateGuidelinesSection', () => {
    it('lists built-in bullets under the tool heading and Guardrails/Memory as H5 subsections', () => {
      const registry = new ToolRegistry();
      registry.register({
        name: ToolName.SHELL,
        tool: {},
        description: 'Run shell',
        guidelines: ['Use caution with destructive commands.'],
      });
      registry.setActive([ToolName.SHELL]);
      registry.setSupplementalGuidelines({
        guardrails: new Map([[ToolName.SHELL, ['Require user confirmation.']]]),
        memory: new Map([[ToolName.SHELL, ['Prefix commands with rtk.']]]),
      });

      const section = registry.generateGuidelinesSection({
        memorySourcePath: 'Steward/Memory/Tool instructions.md',
      });

      expect(section).toContain(`#### ${ToolName.SHELL}`);
      expect(section).not.toContain('##### Built-in');
      expect(section).toContain('- Use caution with destructive commands.');
      expect(section).toContain('##### Guardrails');
      expect(section).toContain('- Require user confirmation.');
      expect(section).toContain('##### Memory');
      expect(section).toContain('- Prefix commands with rtk.');
      expect(section).toContain('(from Steward/Memory/Tool instructions.md)');
    });

    it('omits empty guideline source subsections', () => {
      const registry = new ToolRegistry();
      registry.register({
        name: ToolName.GREP,
        tool: {},
        description: 'Search',
        guidelines: ['Search from vault root.'],
      });
      registry.setActive([ToolName.GREP]);
      registry.setSupplementalGuidelines({
        guardrails: new Map(),
        memory: new Map(),
      });

      const section = registry.generateGuidelinesSection();

      expect(section).toContain('- Search from vault root.');
      expect(section).not.toContain('##### Built-in');
      expect(section).not.toContain('##### Guardrails');
      expect(section).not.toContain('##### Memory');
    });
  });

  describe('generateToolSectionBody', () => {
    it('orders available tools, guidelines, and other tools', () => {
      const registry = ToolRegistry.buildFromTools({
        [ToolName.SHELL]: jest.fn(),
        [ToolName.GREP]: jest.fn(),
      });
      registry.setActive([ToolName.SHELL]);

      const body = registry.generateToolSectionBody({
        inactiveToolCount: 1,
        otherToolsEmptyLabel: 'No other tools available.',
        memorySourcePath: 'Steward/Memory/Tool instructions.md',
      });

      const availableIndex = body.indexOf('### Available tools');
      const guidelinesIndex = body.indexOf('### Guidelines');
      const otherToolsIndex = body.indexOf('### Other tools');

      expect(availableIndex).toBeGreaterThanOrEqual(0);
      expect(guidelinesIndex).toBeGreaterThan(availableIndex);
      expect(otherToolsIndex).toBeGreaterThan(guidelinesIndex);
      expect(body).toContain(`- ${ToolName.GREP}`);
    });

    it('includes memory file description under Guidelines when memory instructions exist', () => {
      const registry = ToolRegistry.buildFromTools({
        [ToolName.SHELL]: jest.fn(),
      });
      registry.setActive([ToolName.SHELL]);
      registry.setSupplementalGuidelines({
        guardrails: new Map(),
        memory: new Map([[ToolName.SHELL, ['Prefix commands with rtk.']]]),
      });

      const body = registry.generateToolSectionBody({
        inactiveToolCount: 0,
        otherToolsEmptyLabel: 'No other tools available.',
        memorySourcePath: 'Steward/Memory/Tool instructions.md',
      });

      expect(body).toContain('### Guidelines');
      expect(body).toContain(
        'Additional tool instructions from memory appear under the **Memory** subheading for each tool. Edit them in Steward/Memory/Tool instructions.md.'
      );
    });

    it('omits memory file description when no memory instructions exist', () => {
      const registry = ToolRegistry.buildFromTools({
        [ToolName.SHELL]: jest.fn(),
      });
      registry.setActive([ToolName.SHELL]);
      registry.setSupplementalGuidelines({
        guardrails: new Map(),
        memory: new Map(),
      });

      const body = registry.generateToolSectionBody({
        inactiveToolCount: 0,
        otherToolsEmptyLabel: 'No other tools available.',
        memorySourcePath: 'Steward/Memory/Tool instructions.md',
      });

      expect(body).not.toContain('Additional tool instructions from memory');
    });
  });
});
