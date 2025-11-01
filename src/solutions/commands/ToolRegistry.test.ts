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

    it('should call exclude when exclude options are provided', () => {
      const mockTool1 = jest.fn();
      const mockTool2 = jest.fn();
      const mockTool3 = jest.fn();
      const tools = {
        [ToolName.CONTENT_READING]: mockTool1,
        [ToolName.EDIT]: mockTool2,
        [ToolName.GREP]: mockTool3,
      };

      // Create a spy on ToolRegistry.prototype.exclude before building
      const excludeSpy = jest.spyOn(ToolRegistry.prototype, 'exclude');

      const registry = ToolRegistry.buildFromTools(tools, {
        exclude: [ToolName.EDIT, ToolName.GREP],
      });

      // Verify exclude was called with the correct arguments
      expect(excludeSpy).toHaveBeenCalledWith([ToolName.EDIT, ToolName.GREP]);

      // Verify the excluded tools are not in the tools object
      const toolsObject = registry.getToolsObject();
      expect(toolsObject[ToolName.CONTENT_READING]).toBe(mockTool1);
      expect(toolsObject[ToolName.EDIT]).toBeUndefined();
      expect(toolsObject[ToolName.GREP]).toBeUndefined();

      excludeSpy.mockRestore();
    });
  });
});
