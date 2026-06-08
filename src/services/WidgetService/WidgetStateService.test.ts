import { widgetStateSchema } from './WidgetStateService';

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
    const result = widgetStateSchema.safeParse({
      version: 2,
      updatedAt: '2026-05-29T00:00:00.000Z',
      data: {},
    });

    expect(result.success).toBe(false);
  });

  it('rejects missing data field', () => {
    const result = widgetStateSchema.safeParse({
      version: 1,
      updatedAt: '2026-05-29T00:00:00.000Z',
    });

    expect(result.success).toBe(false);
  });
});
