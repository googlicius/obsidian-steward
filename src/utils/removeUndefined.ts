import { JSONValue } from 'ai';

export function removeUndefined<T extends object>(obj: T): JSONValue {
  const result: Record<string, JSONValue> = {};

  for (const key of Object.keys(obj)) {
    const value = obj[key as keyof T];

    if (value === undefined) {
      continue;
    }

    if (Array.isArray(value)) {
      result[key] = value
        .filter(item => item !== undefined)
        .map(item =>
          item !== null && typeof item === 'object' ? removeUndefined(item as object) : item
        ) as JSONValue;
      continue;
    }

    if (value !== null && typeof value === 'object') {
      result[key] = removeUndefined(value as object);
      continue;
    }

    result[key] = value as JSONValue;
  }

  return result;
}
