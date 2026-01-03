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
  });
});
