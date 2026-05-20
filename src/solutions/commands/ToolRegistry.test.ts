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
      expect(registry.listInactiveToolNames(new Set(['excluded_tool']))).toEqual([
        'inactive_tool',
      ]);
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

      expect(registry.generateOtherToolsSection()).toBe(
        '- inactive_tool - Visible description'
      );
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
});
