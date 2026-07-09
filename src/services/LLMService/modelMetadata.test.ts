import { formatContextLengthTokens, getModelMetadata, normalizeModelId } from './modelMetadata';

describe('normalizeModelId', () => {
  it('strips ollama-style tags', () => {
    expect(normalizeModelId('llama3.3:latest')).toBe('llama3.3');
    expect(normalizeModelId('deepseek-r1:8b')).toBe('deepseek-r1');
  });

  it('strips trailing date suffixes', () => {
    expect(normalizeModelId('claude-haiku-4-5-20251001')).toBe('claude-haiku-4-5');
    expect(normalizeModelId('claude-opus-4-6-2026-02-05')).toBe('claude-opus-4-6');
  });

  it('keeps gateway-style model ids intact', () => {
    expect(normalizeModelId('cc/claude-sonnet-4-6')).toBe('cc/claude-sonnet-4-6');
    expect(normalizeModelId('cc^claude-sonnet-4-6')).toBe('cc^claude-sonnet-4-6');
  });
});

describe('formatContextLengthTokens', () => {
  it('formats thousands and millions', () => {
    expect(formatContextLengthTokens(128_000)).toBe('128K');
    expect(formatContextLengthTokens(1_000_000)).toBe('1M');
    expect(formatContextLengthTokens(1_050_000)).toBe('1.1M');
  });
});

describe('getModelMetadata', () => {
  it('resolves exact provider and model ids', () => {
    const metadata = getModelMetadata('openai:gpt-4o');
    expect(metadata?.context).toBe(128_000);
    expect(metadata?.toolCall).toBe(true);
    expect(metadata?.temperature).toBe(true);
    expect(metadata?.input).toContain('image');
  });

  it('normalizes ollama-style tags before lookup', () => {
    const metadata = getModelMetadata('deepseek:deepseek-chat:latest');
    expect(metadata?.context).toBe(1_000_000);
    expect(metadata?.toolCall).toBe(true);
  });

  it('normalizes trailing date suffixes', () => {
    const metadata = getModelMetadata('anthropic:claude-haiku-4-5-20990101');
    expect(metadata?.context).toBe(200_000);
    expect(metadata?.input).toContain('image');
  });

  it('uses longest-prefix match within a provider', () => {
    const metadata = getModelMetadata('openai:gpt-4-turbo-preview');
    expect(metadata?.context).toBe(128_000);
  });

  it('falls back to known model id contained in custom model ids', () => {
    const metadata = getModelMetadata('custom-gateway:gpt-4o');
    expect(metadata?.context).toBe(128_000);
  });

  it('resolves models when a known id is embedded in gateway model ids', () => {
    const slashMetadata = getModelMetadata('omniroute:cc/claude-sonnet-4-6');
    expect(slashMetadata?.context).toBe(1_000_000);
    expect(slashMetadata?.input).toContain('image');

    const caretMetadata = getModelMetadata('omniroute:cc^claude-sonnet-4-6');
    expect(caretMetadata?.context).toBe(1_000_000);
    expect(caretMetadata?.input).toContain('image');
  });

  it('returns undefined for unknown models', () => {
    expect(getModelMetadata('custom:unknown-model-xyz')).toBeUndefined();
    expect(getModelMetadata('')).toBeUndefined();
  });
});
