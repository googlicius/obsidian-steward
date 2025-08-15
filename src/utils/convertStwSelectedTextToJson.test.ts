import { convertStwSelectedTextToJson } from './convertStwSelectedTextToJson';

describe('convertStwSelectedTextToJson', () => {
  it('should return an empty array if the input does not contain {{stw-selected}}', () => {
    const input = 'This is a test';
    const result = convertStwSelectedTextToJson(input);
    expect(result).toEqual([]);
  });

  it('should return an array of JSON objects if the input contains {{stw-selected}}', () => {
    const input =
      'This is a test {{stw-selected from:1,to:2,selection:This is a test,path:test.md}}';
    const result = convertStwSelectedTextToJson(input);
    expect(result).toEqual([
      JSON.stringify({
        noteName: 'test.md',
        fromLine: '1',
        toLine: '2',
        selection: 'This is a test',
      }),
    ]);
  });

  it('should handle selection content with curly braces', () => {
    const input =
      'This is a test {{stw-selected from:1,to:2,selection:This is a test with {curly brace},path:test.md}}';
    const result = convertStwSelectedTextToJson(input);
    expect(result).toEqual([
      JSON.stringify({
        noteName: 'test.md',
        fromLine: '1',
        toLine: '2',
        selection: 'This is a test with {curly brace}',
      }),
    ]);
  });
});
