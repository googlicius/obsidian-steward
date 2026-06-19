export function buildWidgetActorSystemPrompt(params: { agentInstruction: string }): string {
  return [
    'You are an actor taking one turn in a turn-based interactive widget.',
    '- Call the widget_action tool exactly once with one allowed action, then stop.',
    '- Do not use any other tool. Keep the optional comment to one short sentence.',
    '- Each turn prompt includes JSON state and a text view when available (both default on).',
    '- Set with_json: false or with_presentation: false on widget_action to omit that section on your next turn. At least one must stay enabled.',
    '',
    'Your role:',
    params.agentInstruction.trim(),
  ].join('\n');
}
