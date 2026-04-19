import { expectZodIssuesContaining } from './testUtils';
import { googleMoveToolSchema, type MoveToolArgs } from './VaultMove';

describe('VaultMove', () => {
  describe('googleMoveToolSchema', () => {
    const destinationFolder = 'dest/inbox';

    describe('superRefine validation errors', () => {
      it('rejects artifactId mode without artifactId', () => {
        expectZodIssuesContaining({
          fn: () =>
            googleMoveToolSchema.parse({
              destinationFolder,
              operations: [{ mode: 'artifactId' }],
            }),
          path: ['operations', 0, 'artifactId'],
          messageSubstring: 'artifactId is required when mode is artifactId',
        });
      });

      it('rejects artifactId mode when files is present', () => {
        expectZodIssuesContaining({
          fn: () =>
            googleMoveToolSchema.parse({
              destinationFolder,
              operations: [
                {
                  mode: 'artifactId',
                  artifactId: 'a1',
                  files: ['x.md'],
                },
              ],
            }),
          path: ['operations', 0, 'files'],
          messageSubstring: 'files must be omitted when mode is artifactId',
        });
      });

      it('rejects files mode without files', () => {
        expectZodIssuesContaining({
          fn: () =>
            googleMoveToolSchema.parse({
              destinationFolder,
              operations: [{ mode: 'files' }],
            }),
          path: ['operations', 0, 'files'],
          messageSubstring: 'files is required when mode is files',
        });
      });

      it('rejects folders mode without folders', () => {
        expectZodIssuesContaining({
          fn: () =>
            googleMoveToolSchema.parse({
              destinationFolder,
              operations: [{ mode: 'folders' }],
            }),
          path: ['operations', 0, 'folders'],
          messageSubstring: 'folders is required when mode is folders',
        });
      });

      it('rejects filePatterns mode without filePatterns', () => {
        expectZodIssuesContaining({
          fn: () =>
            googleMoveToolSchema.parse({
              destinationFolder,
              operations: [{ mode: 'filePatterns' }],
            }),
          path: ['operations', 0, 'filePatterns'],
          messageSubstring: 'filePatterns is required when mode is filePatterns',
        });
      });

      it('rejects filePatterns mode when folders is present', () => {
        expectZodIssuesContaining({
          fn: () =>
            googleMoveToolSchema.parse({
              destinationFolder,
              operations: [
                {
                  mode: 'filePatterns',
                  filePatterns: { patterns: ['\\.md$'] },
                  folders: [{ path: 'nope' }],
                },
              ],
            }),
          path: ['operations', 0, 'folders'],
          messageSubstring: 'folders must be omitted when mode is filePatterns',
        });
      });
    });

    describe('transform to primary MoveToolArgs shape', () => {
      it('maps artifactId operation', () => {
        const result = googleMoveToolSchema.parse({
          destinationFolder,
          operations: [{ mode: 'artifactId', artifactId: 'art-1' }],
        }) as MoveToolArgs;

        expect(result).toEqual({
          destinationFolder,
          operations: [{ mode: 'artifactId', artifactId: 'art-1' }],
        });
      });

      it('maps files operation', () => {
        const result = googleMoveToolSchema.parse({
          destinationFolder,
          operations: [{ mode: 'files', files: ['a.md', 'b.md'] }],
        }) as MoveToolArgs;

        expect(result).toEqual({
          destinationFolder,
          operations: [{ mode: 'files', files: ['a.md', 'b.md'] }],
        });
      });

      it('maps folders operation and strips slashes on paths', () => {
        const result = googleMoveToolSchema.parse({
          destinationFolder,
          operations: [
            {
              mode: 'folders',
              folders: [{ path: '/projects/foo/' }, { path: 'bar' }],
            },
          ],
        }) as MoveToolArgs;

        expect(result).toEqual({
          destinationFolder,
          operations: [
            {
              mode: 'folders',
              folders: [{ path: 'projects/foo' }, { path: 'bar' }],
            },
          ],
        });
      });

      it('maps filePatterns operation with optional folder', () => {
        const result = googleMoveToolSchema.parse({
          destinationFolder,
          operations: [
            {
              mode: 'filePatterns',
              filePatterns: { patterns: ['\\.md$'], folder: 'notes' },
            },
          ],
        }) as MoveToolArgs;

        expect(result).toEqual({
          destinationFolder,
          operations: [
            {
              mode: 'filePatterns',
              filePatterns: { patterns: ['\\.md$'], folder: 'notes' },
            },
          ],
        });
      });

      it('maps multiple operations in one call', () => {
        const result = googleMoveToolSchema.parse({
          destinationFolder,
          operations: [
            { mode: 'files', files: ['one.md'] },
            { mode: 'artifactId', artifactId: 'art-2' },
          ],
        }) as MoveToolArgs;

        expect(result.destinationFolder).toBe(destinationFolder);
        expect(result.operations).toHaveLength(2);
        expect(result.operations[0]).toEqual({ mode: 'files', files: ['one.md'] });
        expect(result.operations[1]).toEqual({ mode: 'artifactId', artifactId: 'art-2' });
      });
    });
  });
});
