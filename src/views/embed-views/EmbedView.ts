import type { TFile } from 'obsidian';

export interface EmbedView {
  buildContent(): Promise<string>;
  write(content: string): Promise<void>;
  replaceHostWikilink(hostFile: TFile): Promise<void>;
}
