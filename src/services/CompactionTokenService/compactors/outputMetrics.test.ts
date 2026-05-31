import { measureSerializedOutputSize } from './outputMetrics';

describe('measureSerializedOutputSize', () => {
  it('returns 0 for nullish', () => {
    expect(measureSerializedOutputSize(undefined)).toBe(0);
    expect(measureSerializedOutputSize(null)).toBe(0);
  });

  it('uses string length for text', () => {
    expect(measureSerializedOutputSize('abcd')).toBe(4);
  });

  it('uses JSON length for objects', () => {
    expect(measureSerializedOutputSize({ a: 1 })).toBe(JSON.stringify({ a: 1 }).length);
  });
});
