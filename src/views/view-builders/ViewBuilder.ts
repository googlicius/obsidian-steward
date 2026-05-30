export interface ViewBuilder {
  buildContent(): Promise<string>;
  write(content: string): Promise<void>;
  getFilePath(): string;
}

export async function refreshViewBuilder(builder: ViewBuilder): Promise<void> {
  const content = await builder.buildContent();
  await builder.write(content);
}
