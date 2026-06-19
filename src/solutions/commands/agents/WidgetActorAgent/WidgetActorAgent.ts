import type StewardPlugin from 'src/main';
import { MarkdownBuilder } from 'src/utils/MarkdownBuilder';
import type { AgentCorePromptContext } from '../../Agent';
import { ToolName } from '../../ToolRegistry';
import { SuperAgent } from '../SuperAgent/SuperAgent';

/**
 * Narrow SuperAgent for interactive widget model turns: minimal framing plus
 * registry-built tool instructions (same detail as the main agent).
 */
export class WidgetActorAgent extends SuperAgent {
  constructor(plugin: StewardPlugin, activeTools: ToolName[] = []) {
    super(plugin, activeTools);
  }

  public includesDelegatedCatalogSections(): boolean {
    return false;
  }

  public buildCorePrompt(context?: AgentCorePromptContext): string {
    if (!context) {
      return 'You are an actor taking one turn in a turn-based interactive widget.';
    }

    const memorySourcePath = this.plugin.toolInstructionService.getToolInstructionsRelativePath();
    const inactiveToolCount = context.registry.listInactiveToolNames().length;
    const toolSection = context.registry.generateToolSectionBody({
      inactiveToolCount,
      otherToolsEmptyLabel: 'No inactive tools available.',
      memorySourcePath,
    });

    const framing = [
      'You are an actor taking one turn in a turn-based interactive widget.',
      '- Take exactly one allowed action on your turn, then stop.',
      '- Use only the tools listed below.',
    ].join('\n');

    return new MarkdownBuilder()
      .addSection('# Widget actor', framing)
      .addSection('## Tool', toolSection || 'No tools available.')
      .build();
  }
}
