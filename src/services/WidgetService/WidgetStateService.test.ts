import { widgetStateSchema } from './types';
import { WidgetStateService } from './WidgetStateService';

describe('widgetStateSchema', () => {
  it('accepts a valid envelope', () => {
    const data = widgetStateSchema.parse({
      version: 1,
      updatedAt: '2026-05-29T00:00:00.000Z',
      data: { count: 2 },
    });

    expect(data.data).toEqual({ count: 2 });
  });

  it('accepts optional session sibling', () => {
    const data = widgetStateSchema.parse({
      version: 1,
      updatedAt: '2026-05-29T00:00:00.000Z',
      data: { cells: [] },
      session: {
        conversationTitle: 'game__session_abc',
        actor: 'user',
        turnIndex: 0,
        phase: 'awaiting_input',
      },
    });

    expect(data.session?.actor).toBe('user');
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

describe('WidgetStateService.writeState session preservation', () => {
  it('carries forward session when iframe save omits it', async () => {
    const written: unknown[] = [];
    const plugin = {
      app: {
        vault: {
          getFileByPath: () => ({ path: 'Widgets/game/state.json' }),
          modify: async (_file: unknown, content: string) => {
            written.push(JSON.parse(content));
          },
        },
      },
      obsidianAPITools: {
        ensureFolderExists: async () => undefined,
      },
    } as never;

    const service = WidgetStateService.getInstance(plugin);
    jest.spyOn(service, 'readState').mockResolvedValue({
      version: 1,
      updatedAt: '2026-05-29T00:00:00.000Z',
      data: { score: 1 },
      session: {
        conversationTitle: 'game__session_x',
        actor: 'user',
        turnIndex: 0,
        phase: 'awaiting_input',
      },
    });

    await service.writeState({
      projectPath: 'Steward/Widgets/game',
      data: { score: 2 },
    });

    expect(written).toHaveLength(1);
    const envelope = written[0] as { data: { score: number }; session: { actor: string } };
    expect(envelope.data.score).toBe(2);
    expect(envelope.session.actor).toBe('user');
  });
});
