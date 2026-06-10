export class SysError extends Error {
  name = 'SysError';
}

export function getCaughtErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === 'object' && error !== null && 'error' in error) {
    const nestedError = error.error;
    if (nestedError instanceof Error) {
      return nestedError.message;
    }
    if (
      typeof nestedError === 'object' &&
      nestedError !== null &&
      'message' in nestedError &&
      typeof nestedError.message === 'string'
    ) {
      return (nestedError as { message: string }).message;
    }
  }
  return String(error);
}
