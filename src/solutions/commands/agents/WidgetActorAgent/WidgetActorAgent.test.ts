import { ToolRegistry, ToolName } from 'src/solutions/commands/ToolRegistry';
import { WidgetActorAgent } from './WidgetActorAgent';

function createMockPlugin() {
  return {
    toolInstructionService: {
      getToolInstructionsRelativePath: () => 'Steward/Memory/Tool Instructions.md',
    },
    guardrailsRuleService: {
      getInstructionsByTool: () => new Map(),
    },
    settings: { stewardFolder: 'Steward' },
  } as never;
}

describe('WidgetActorAgent', () => {
  it('buildCorePrompt includes widget actor framing and tool section', () => {
    const agent = new WidgetActorAgent(createMockPlugin(), [ToolName.WIDGET_ACTION]);
    const registry = ToolRegistry.buildFromTools({
      [ToolName.WIDGET_ACTION]: { description: 'widget action tool' },
    }).setActive([ToolName.WIDGET_ACTION]);

    const prompt = agent.buildCorePrompt({
      registry,
      currentNote: null,
      currentPosition: null,
      includeSkillCatalog: false,
      includeSubAgentCatalog: false,
      runCommandAvailable: false,
      availableTools: [ToolName.WIDGET_ACTION],
    });

    expect(prompt).toContain('Widget actor');
    expect(prompt).toContain('widget_action');
    expect(prompt).toContain('Call exactly once');
    expect(prompt).not.toContain('Obsidian vault');
  });

  it('excludes delegated catalog sections', () => {
    const agent = new WidgetActorAgent(createMockPlugin());
    expect(agent.includesDelegatedCatalogSections()).toBe(false);
  });
});
