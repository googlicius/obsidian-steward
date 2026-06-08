import { MarkdownBuilder } from './MarkdownBuilder';

describe('MarkdownBuilder', () => {
  it('builds a single section with heading and body', () => {
    const result = new MarkdownBuilder()
      .addSection('# Agent', 'You are a helpful assistant.')
      .build();

    expect(result).toBe('# Agent\n\nYou are a helpful assistant.');
  });

  it('joins multiple sections with the default divider', () => {
    const result = new MarkdownBuilder()
      .addSection('# Agent', 'Intro')
      .addSection('## Role', 'Task instructions')
      .build();

    expect(result).toBe('# Agent\n\nIntro\n\n## Role\n\nTask instructions');
  });

  it('skips sections with empty or whitespace-only content', () => {
    const result = new MarkdownBuilder()
      .addSection('# Agent', 'Intro')
      .addSection('## Skill', '')
      .addSection('## Context', '   ')
      .build();

    expect(result).toBe('# Agent\n\nIntro');
  });

  it('accepts a nested builder as section content', () => {
    const toolSection = new MarkdownBuilder()
      .addSection('### Available tools', '- shell')
      .addSection('### Guidelines', '- rule');

    const result = new MarkdownBuilder().addSection('## Tool', toolSection).build();

    expect(result).toContain('## Tool\n\n### Available tools\n\n- shell');
    expect(result).toContain('### Guidelines\n\n- rule');
  });

  it('uses a custom section divider', () => {
    const result = new MarkdownBuilder({ sectionDivider: '\n---\n' })
      .addSection('# Agent', 'Intro')
      .addSection('## Role', 'Body')
      .build();

    expect(result).toBe('# Agent\n\nIntro\n---\n## Role\n\nBody');
  });

  it('returns empty string when no sections were added', () => {
    expect(new MarkdownBuilder().build()).toBe('');
  });
});
