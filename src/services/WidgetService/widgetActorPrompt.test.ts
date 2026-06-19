import { buildWidgetActorSystemPrompt } from './widgetActorPrompt';

describe('buildWidgetActorSystemPrompt', () => {
  it('includes base framing and agent instruction', () => {
    const prompt = buildWidgetActorSystemPrompt({
      agentInstruction: 'You play O in tic-tac-toe.',
    });

    expect(prompt).toContain('widget_action');
    expect(prompt).toContain('with_json');
    expect(prompt).toContain('with_presentation');
    expect(prompt).toContain('You play O in tic-tac-toe.');
    expect(prompt).not.toContain('Obsidian');
  });
});
