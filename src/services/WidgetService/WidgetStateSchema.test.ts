import { parseWidgetState, widgetStateSchema } from './WidgetStateSchema';

describe('widgetStateSchema', () => {
  it('accepts a valid envelope', () => {
    const data = widgetStateSchema.parse({
      version: 1,
      updatedAt: '2026-05-29T00:00:00.000Z',
      data: { count: 2 },
    });

    expect(data.data).toEqual({ count: 2 });
  });

  it('rejects wrong version', () => {
    const result = parseWidgetState({
      version: 2,
      updatedAt: '2026-05-29T00:00:00.000Z',
      data: {},
    });

    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.length).toBeGreaterThan(0);
    }
  });

  it('rejects missing data field', () => {
    const result = parseWidgetState({
      version: 1,
      updatedAt: '2026-05-29T00:00:00.000Z',
    });

    expect(result.valid).toBe(false);
  });
});
