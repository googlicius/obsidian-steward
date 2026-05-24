import { evaluateStepCondition, evaluateStepWhen } from './stepConditions';
import { stepConditionSchema } from './versions/v1';

describe('stepConditions', () => {
  describe('evaluateStepCondition', () => {
    it('empty_from_user is true for empty input', () => {
      expect(evaluateStepCondition('empty_from_user', { cleanedUserInput: '' })).toBe(true);
    });

    it('empty_from_user is true for whitespace-only input', () => {
      expect(evaluateStepCondition('empty_from_user', { cleanedUserInput: '   ' })).toBe(true);
    });

    it('empty_from_user is false when input has content', () => {
      expect(evaluateStepCondition('empty_from_user', { cleanedUserInput: 'hello' })).toBe(false);
    });

    it('matches returns true when pattern matches input', () => {
      expect(evaluateStepCondition({ matches: 'foo' }, { cleanedUserInput: 'hello foo bar' })).toBe(
        true
      );
    });

    it('matches returns false when pattern does not match', () => {
      expect(evaluateStepCondition({ matches: 'foo' }, { cleanedUserInput: 'hello bar' })).toBe(
        false
      );
    });

    it('not_matches returns true when pattern does not match', () => {
      expect(evaluateStepCondition({ not_matches: 'youtube' }, { cleanedUserInput: 'hello' })).toBe(
        true
      );
    });

    it('not_matches returns false when pattern matches', () => {
      expect(
        evaluateStepCondition(
          { not_matches: 'youtube' },
          { cleanedUserInput: 'https://youtube.com/watch?v=x' }
        )
      ).toBe(false);
    });
  });

  describe('evaluateStepWhen', () => {
    it('returns true when when is undefined', () => {
      expect(evaluateStepWhen(undefined, { cleanedUserInput: 'hello' })).toBe(true);
    });

    it('returns true when when is an empty array', () => {
      expect(evaluateStepWhen([], { cleanedUserInput: 'hello' })).toBe(true);
    });

    it('uses OR semantics across conditions', () => {
      expect(
        evaluateStepWhen([{ not_matches: 'youtube' }, 'empty_from_user'], {
          cleanedUserInput: 'hello',
        })
      ).toBe(true);
    });

    it('returns false when no condition matches', () => {
      expect(
        evaluateStepWhen([{ not_matches: 'youtube' }, 'empty_from_user'], {
          cleanedUserInput: 'https://youtube.com/watch?v=x',
        })
      ).toBe(false);
    });
  });

  describe('stepConditionSchema', () => {
    it('accepts empty_from_user', () => {
      expect(stepConditionSchema.parse('empty_from_user')).toBe('empty_from_user');
    });

    it('accepts matches with valid regex', () => {
      expect(stepConditionSchema.parse({ matches: '(youtube\\.com|youtu\\.be)' })).toEqual({
        matches: '(youtube\\.com|youtu\\.be)',
      });
    });

    it('accepts not_matches with valid regex', () => {
      expect(stepConditionSchema.parse({ not_matches: 'foo' })).toEqual({ not_matches: 'foo' });
    });

    it('rejects invalid regex patterns', () => {
      expect(() => stepConditionSchema.parse({ matches: '(' })).toThrow(
        'step condition pattern must be a valid regex'
      );
      expect(() => stepConditionSchema.parse({ not_matches: '[' })).toThrow(
        'step condition pattern must be a valid regex'
      );
    });
  });
});
