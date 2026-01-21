import { fixUnquotedJSON } from './jsonRepairs';

describe('jsonRepairs', () => {
  describe('fixUnquotedJSON', () => {
    it('should fix unquoted JSON strings', () => {
      const invalid = `{
        "name": "Dang",
        "city": Ho Chi Minh City,
        "active": true,
        "score": 42,
        "note": This is a value without quotes
      }`;

      expect(fixUnquotedJSON(invalid)).toBe(`{
        "name": "Dang",
        "city": "Ho Chi Minh City",
        "active": true,
        "score": 42,
        "note": "This is a value without quotes"}`);
    });

    it('should fix unquoted JSON with double curly brackets', () => {
      const invalid = `{
        "name": "Dang",
        "city": Ho Chi Minh City,
        "active": true,
        "score": 42,
        "note": His age is {{number}} years old
      }`;

      expect(fixUnquotedJSON(invalid)).toBe(`{
        "name": "Dang",
        "city": "Ho Chi Minh City",
        "active": true,
        "score": 42,
        "note": "His age is {{number}} years old"}`);
    });

    it('should fix invalid read_content tool call', () => {
      const invalid = `{"fileNames": ["Steward/Commands/Ask.md"], "readType": "pattern", "pattern": "command_name:", "blocksToRead": 1, "confidence": 0.9, "foundPlaceholder": Found {{number}} command names}`;

      expect(fixUnquotedJSON(invalid)).toBe(
        `{"fileNames": ["Steward/Commands/Ask.md"], "readType": "pattern", "pattern": "command_name:", "blocksToRead": 1, "confidence": 0.9, "foundPlaceholder": "Found {{number}} command names"}`
      );
    });
  });
});
