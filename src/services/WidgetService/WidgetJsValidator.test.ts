import { WidgetJsValidator } from './WidgetJsValidator';

describe('WidgetJsValidator', () => {
  let validator: WidgetJsValidator;

  beforeEach(() => {
    validator = new WidgetJsValidator();
  });

  describe('isJsFilePath', () => {
    it('returns true for .js paths', () => {
      expect(validator.isJsFilePath('main.js')).toBe(true);
      expect(validator.isJsFilePath('Steward/Widgets/chat/w1/main.js')).toBe(true);
    });

    it('returns false for non-js paths', () => {
      expect(validator.isJsFilePath('index.html')).toBe(false);
      expect(validator.isJsFilePath('style.css')).toBe(false);
    });
  });

  describe('validateContent', () => {
    it('returns null for valid JavaScript', () => {
      expect(
        validator.validateContent({ filePath: 'main.js', content: 'console.log("ok");' })
      ).toBeNull();
    });

    it('returns an error for invalid JavaScript', () => {
      const error = validator.validateContent({ filePath: 'main.js', content: 'function {' });
      expect(error).not.toBeNull();
      expect(error?.filePath).toBe('main.js');
      expect(error?.message).toBeTruthy();
    });
  });

  describe('validateProjectFiles', () => {
    it('validates only js files in the record', () => {
      const errors = validator.validateProjectFiles({
        'index.html': '<script></script>',
        'main.js': 'const x = ;',
        'style.css': 'body {}',
      });

      expect(errors).toHaveLength(1);
      expect(errors[0].filePath).toBe('main.js');
    });
  });

  describe('formatErrors', () => {
    it('formats multiple errors', () => {
      const formatted = validator.formatErrors([
        { filePath: 'a.js', message: 'Unexpected token', line: 2, column: 5 },
        { filePath: 'b.js', message: 'Unterminated string' },
      ]);

      expect(formatted).toContain('Invalid JavaScript in widget project:');
      expect(formatted).toContain('- a.js (2:5): Unexpected token');
      expect(formatted).toContain('- b.js: Unterminated string');
    });
  });
});
