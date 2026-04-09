import { ZodError } from 'zod/v3';

export function expectZodIssuesContaining(params: {
  fn: () => unknown;
  path: (string | number)[];
  messageSubstring: string;
}): void {
  try {
    params.fn();
    throw new Error('expected ZodError');
  } catch (e) {
    expect(e).toBeInstanceOf(ZodError);
    const err = e as ZodError;
    const match = err.issues.some(
      issue =>
        issue.message.includes(params.messageSubstring) &&
        JSON.stringify(issue.path) === JSON.stringify(params.path)
    );
    expect(match).toBe(true);
  }
}
