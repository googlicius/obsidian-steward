export interface MarkdownBuilderOptions {
  /** Separator between top-level sections. Default: double newline. */
  sectionDivider?: string;
}

type SectionContent = string | MarkdownBuilder;

/**
 * Chainable Markdown document builder for prompts, notes, or any structured text.
 */
export class MarkdownBuilder {
  private readonly sectionDivider: string;
  private readonly sections: Array<{ heading: string; content: string }> = [];

  constructor(options?: MarkdownBuilderOptions) {
    this.sectionDivider = options?.sectionDivider ?? '\n\n';
  }

  /**
   * Append a section. Skipped when resolved content is empty or whitespace-only.
   * `content` may be a nested builder; its output is used as the section body.
   */
  public addSection(heading: string, content: SectionContent): this {
    const body = this.resolveContent(content);
    if (!body.trim()) {
      return this;
    }
    this.sections.push({ heading, content: body });
    return this;
  }

  public build(): string {
    if (this.sections.length === 0) {
      return '';
    }

    const parts: string[] = [];
    for (let i = 0; i < this.sections.length; i++) {
      const section = this.sections[i];
      parts.push(`${section.heading}\n\n${section.content}`);
    }
    return parts.join(this.sectionDivider);
  }

  private resolveContent(content: SectionContent): string {
    if (content instanceof MarkdownBuilder) {
      return content.build();
    }
    return content;
  }
}
