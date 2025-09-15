type DeepValue<T, P extends string> = P extends `${infer K}.${infer Rest}`
  ? K extends keyof T
    ? DeepValue<T[K], Rest>
    : unknown
  : P extends keyof T
    ? T[P]
    : unknown;

// Helper function that uses the DeepValue type
export const get = <T, P extends string>(obj: T, path: P): DeepValue<T, P> => {
  const fieldPath = path.split('.');
  let current: unknown = obj;

  for (const field of fieldPath) {
    if (current && typeof current === 'object' && field in current) {
      current = (current as Record<string, unknown>)[field];
    } else {
      return undefined as DeepValue<T, P>;
    }
  }

  return current as DeepValue<T, P>;
};
