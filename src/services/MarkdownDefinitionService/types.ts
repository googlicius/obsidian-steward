interface YamlFenceBlock {
  content: string;
  startLine: number;
  endLine: number;
}

export interface ParsedYamlFenceBlock extends YamlFenceBlock {
  data: Record<string, unknown>;
}

export interface YamlFenceReplacement {
  block: YamlFenceBlock;
  newInner: string;
}
