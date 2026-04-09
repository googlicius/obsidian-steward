import { expectZodIssuesContaining } from './testUtils';
import { googleDeleteToolSchema, type DeleteToolArgs } from './VaultDelete';

describe('VaultDelete', () => {
  describe('googleDeleteToolSchema', () => {
    describe('superRefine validation errors', () => {
      it('rejects artifactId mode without artifactId', () => {
        expectZodIssuesContaining({
          fn: () =>
            googleDeleteToolSchema.parse({
              operations: [{ mode: 'artifactId' }],
            }),
          path: ['operations', 0, 'artifactId'],
          messageSubstring: 'artifactId is required when mode is artifactId',
        });
      });

      it('rejects artifactId mode when files is present', () => {
        expectZodIssuesContaining({
          fn: () =>
            googleDeleteToolSchema.parse({
              operations: [
                {
                  mode: 'artifactId',
                  artifactId: 'art1',
                  files: ['a.md'],
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
            googleDeleteToolSchema.parse({
              operations: [{ mode: 'files' }],
            }),
          path: ['operations', 0, 'files'],
          messageSubstring: 'files is required when mode is files',
        });
      });

      it('rejects files mode when artifactId is present', () => {
        expectZodIssuesContaining({
          fn: () =>
            googleDeleteToolSchema.parse({
              operations: [
                {
                  mode: 'files',
                  files: ['x.md'],
                  artifactId: 'art',
                },
              ],
            }),
          path: ['operations', 0, 'artifactId'],
          messageSubstring: 'artifactId must be omitted when mode is files',
        });
      });

      it('rejects filePatterns mode without filePatterns', () => {
        expectZodIssuesContaining({
          fn: () =>
            googleDeleteToolSchema.parse({
              operations: [{ mode: 'filePatterns' }],
            }),
          path: ['operations', 0, 'filePatterns'],
          messageSubstring: 'filePatterns is required when mode is filePatterns',
        });
      });

      it('rejects filePatterns mode when files is present', () => {
        expectZodIssuesContaining({
          fn: () =>
            googleDeleteToolSchema.parse({
              operations: [
                {
                  mode: 'filePatterns',
                  filePatterns: { patterns: ['\\.md$'] },
                  files: ['nope'],
                },
              ],
            }),
          path: ['operations', 0, 'files'],
          messageSubstring: 'files must be omitted when mode is filePatterns',
        });
      });
    });

    describe('transform to primary DeleteToolArgs shape', () => {
      it('maps artifactId operation', () => {
        const result = googleDeleteToolSchema.parse({
          operations: [{ mode: 'artifactId', artifactId: 'my-artifact' }],
        }) as DeleteToolArgs;

        expect(result).toEqual({
          operations: [{ mode: 'artifactId', artifactId: 'my-artifact' }],
        });
      });

      it('maps files operation', () => {
        const result = googleDeleteToolSchema.parse({
          operations: [{ mode: 'files', files: ['a.md', 'b.md'] }],
        }) as DeleteToolArgs;

        expect(result).toEqual({
          operations: [{ mode: 'files', files: ['a.md', 'b.md'] }],
        });
      });

      it('maps filePatterns operation with optional folder', () => {
        const result = googleDeleteToolSchema.parse({
          operations: [
            {
              mode: 'filePatterns',
              filePatterns: { patterns: ['\\.md$'], folder: 'notes' },
            },
          ],
        }) as DeleteToolArgs;

        expect(result).toEqual({
          operations: [
            {
              mode: 'filePatterns',
              filePatterns: { patterns: ['\\.md$'], folder: 'notes' },
            },
          ],
        });
      });

      it('maps multiple operations in one call', () => {
        const result = googleDeleteToolSchema.parse({
          operations: [
            { mode: 'files', files: ['one.md'] },
            { mode: 'artifactId', artifactId: 'art-2' },
          ],
        }) as DeleteToolArgs;

        expect(result.operations).toHaveLength(2);
        expect(result.operations[0]).toEqual({ mode: 'files', files: ['one.md'] });
        expect(result.operations[1]).toEqual({ mode: 'artifactId', artifactId: 'art-2' });
      });
    });
  });
});
