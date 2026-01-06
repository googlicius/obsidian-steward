import { deleteToolSchema } from './VaultDelete';

describe('deleteToolSchema', () => {
  it('should fail when all fields are missing', () => {
    const result = deleteToolSchema.safeParse({});

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.errors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            message: 'You can only provide either artifactId, files, or filePatterns.',
          }),
        ])
      );
    }
  });

  it('should fail when all fields are empty or undefined', () => {
    const result = deleteToolSchema.safeParse({
      artifactId: undefined,
      files: undefined,
      filePatterns: undefined,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.errors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            message: 'You can only provide either artifactId, files, or filePatterns.',
          }),
        ])
      );
    }
  });

  it('should pass when artifactId is provided', () => {
    const result = deleteToolSchema.safeParse({
      artifactId: 'test-artifact-id',
    });

    expect(result.success).toBe(true);
  });

  it('should pass when files array is provided with at least one file', () => {
    const result = deleteToolSchema.safeParse({
      files: ['file1.md'],
    });

    expect(result.success).toBe(true);
  });

  it('should pass when filePatterns is provided with at least one pattern', () => {
    const result = deleteToolSchema.safeParse({
      filePatterns: {
        patterns: ['.*\\.md$'],
      },
    });

    expect(result.success).toBe(true);
  });

  it('should fail when more than one field is provided', () => {
    const testCases = [
      {
        input: {
          artifactId: 'test-artifact-id',
          files: ['file1.md'],
        },
        description: 'artifactId and files',
      },
      {
        input: {
          artifactId: 'test-artifact-id',
          filePatterns: {
            patterns: ['.*\\.md$'],
          },
        },
        description: 'artifactId and filePatterns',
      },
      {
        input: {
          files: ['file1.md'],
          filePatterns: {
            patterns: ['.*\\.md$'],
          },
        },
        description: 'files and filePatterns',
      },
      {
        input: {
          artifactId: 'test-artifact-id',
          files: ['file1.md'],
          filePatterns: {
            patterns: ['.*\\.md$'],
          },
        },
        description: 'artifactId, files, and filePatterns',
      },
    ];

    for (const testCase of testCases) {
      const result = deleteToolSchema.safeParse(testCase.input);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.errors).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              message: 'You can only provide either artifactId, files, or filePatterns.',
            }),
          ])
        );
      }
    }
  });
});
