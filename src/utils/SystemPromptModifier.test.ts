import { SystemPromptModifier, SystemPromptItem } from './SystemPromptModifier';

describe('SystemPromptModifier', () => {
  const basePrompt = `You are a helpful assistant.

GUIDELINES:
- Follow user instructions carefully
- Be concise and clear
- Always verify your answers
- Read ALL notes at once

CONTEXT:
Use the provided information to answer.`;

  describe('Constructor and apply method', () => {
    it('should create instance with modifications and apply to base prompt', () => {
      const modifications: SystemPromptItem[] = [
        {
          mode: 'modify',
          pattern: 'ALL',
          replacement: 'SOME',
        },
      ];
      const modifier = new SystemPromptModifier(modifications);

      const result = modifier.apply(`GUIDELINES:
- Read ALL notes at once`);

      expect(result).toContain(`GUIDELINES:
- Read SOME notes at once`);
    });

    it('should create instance with undefined and return base prompt unchanged', () => {
      const modifier = new SystemPromptModifier(undefined);
      const result = modifier.apply(basePrompt);

      expect(result).toBe(basePrompt);
    });

    it('should reuse same modifier for multiple prompts', () => {
      const modifications: SystemPromptItem[] = [
        {
          mode: 'modify',
          pattern: 'ALL',
          replacement: 'SOME',
        },
      ];
      const modifier = new SystemPromptModifier(modifications);

      const result1 = modifier.apply(basePrompt);
      const result2 = modifier.apply('Different - Read ALL notes - prompt');

      expect(result1).toContain('Read SOME notes');
      expect(result2).toContain('Read SOME notes');
    });
  });

  describe('Static factory method - withModifications', () => {
    it('should create instance using factory method', () => {
      const modifier = SystemPromptModifier.withModifications([
        {
          mode: 'modify',
          pattern: 'ALL',
          replacement: 'SOME',
        },
      ]);
      const result = modifier.apply(basePrompt);

      expect(result).toContain('Read SOME notes');
    });
  });

  describe('String additions (old format)', () => {
    it('should handle single string addition separately', () => {
      const modifier = new SystemPromptModifier(['Additional instruction']);
      const result = modifier.apply(basePrompt);
      const stringAdditions = modifier.getAdditionalSystemPrompts();

      // String additions are NOT applied to the prompt
      expect(result).toBe(basePrompt);
      // They are available separately
      expect(stringAdditions).toEqual(['Additional instruction']);
    });

    it('should return empty array when no string additions', () => {
      const modifications: SystemPromptItem[] = [
        {
          mode: 'modify',
          pattern: 'ALL',
          replacement: 'SOME',
        },
      ];
      const modifier = new SystemPromptModifier(modifications);
      const stringAdditions = modifier.getAdditionalSystemPrompts();

      expect(stringAdditions).toEqual([]);
    });
  });

  describe('Mode: remove', () => {
    it('should remove lines matching partial pattern', () => {
      const modifications: SystemPromptItem[] = [
        {
          mode: 'remove',
          pattern: 'Read ALL',
          matchType: 'partial',
        },
      ];
      const modifier = new SystemPromptModifier(modifications);
      const result = modifier.apply(basePrompt);

      expect(result).not.toContain('Read ALL notes at once');
      expect(result).toContain('Follow user instructions carefully');
    });

    it('should remove lines matching exact pattern', () => {
      const modifications: SystemPromptItem[] = [
        {
          mode: 'remove',
          pattern: '- Read ALL notes at once',
          matchType: 'exact',
        },
      ];
      const modifier = new SystemPromptModifier(modifications);
      const result = modifier.apply(basePrompt);

      expect(result).not.toContain('Read ALL notes at once');
    });

    it('should remove lines matching regex pattern', () => {
      const modifications: SystemPromptItem[] = [
        {
          mode: 'remove',
          pattern: 'Read.*notes',
          matchType: 'regex',
        },
      ];
      const modifier = new SystemPromptModifier(modifications);
      const result = modifier.apply(basePrompt);

      expect(result).not.toContain('Read ALL notes at once');
    });

    it('should default to partial match when matchType is not specified', () => {
      const modifications: SystemPromptItem[] = [
        {
          mode: 'remove',
          pattern: 'Read ALL',
        },
      ];
      const modifier = new SystemPromptModifier(modifications);
      const result = modifier.apply(basePrompt);

      expect(result).not.toContain('Read ALL notes at once');
    });

    it('should remove when pattern is multiple lines', () => {
      const modifications: SystemPromptItem[] = [
        {
          mode: 'remove',
          pattern: '- Guideline 1\n- Guideline 2\n',
        },
      ];
      const modifier = new SystemPromptModifier(modifications);
      const result = modifier.apply(`You are a helpful assistant.

GUIDELINES:
- Guideline 1
- Guideline 2
- Guideline 3`);

      expect(result).toEqual(`You are a helpful assistant.

GUIDELINES:
- Guideline 3`);
    });
  });

  describe('Mode: modify', () => {
    it('should modify lines matching pattern with replacement', () => {
      const modifications: SystemPromptItem[] = [
        {
          mode: 'modify',
          pattern: 'Read ALL notes at once',
          replacement: 'Read notes one at a time',
        },
      ];
      const modifier = new SystemPromptModifier(modifications);
      const result = modifier.apply(basePrompt);

      expect(result).not.toContain('Read ALL notes at once');
      expect(result).toContain('Read notes one at a time');
    });

    it('should modify partial pattern matches', () => {
      const modifications: SystemPromptItem[] = [
        {
          mode: 'modify',
          pattern: 'Read ALL',
          replacement: 'Read some',
          matchType: 'partial',
        },
      ];
      const modifier = new SystemPromptModifier(modifications);
      const result = modifier.apply(basePrompt);

      expect(result).toContain('Read some notes at once');
    });

    it('should modify using regex pattern', () => {
      const modifications: SystemPromptItem[] = [
        {
          mode: 'modify',
          pattern: 'Read (\\w+) notes',
          replacement: 'Read selected notes',
          matchType: 'regex',
        },
      ];
      const modifier = new SystemPromptModifier(modifications);
      const result = modifier.apply(basePrompt);

      expect(result).toEqual(`You are a helpful assistant.

GUIDELINES:
- Follow user instructions carefully
- Be concise and clear
- Always verify your answers
- Read selected notes at once

CONTEXT:
Use the provided information to answer.`);
    });
  });

  describe('Mode: add', () => {
    it('should add content to the end when no pattern is provided', () => {
      const modifications: SystemPromptItem[] = [
        {
          mode: 'add',
          content: 'New guideline to follow',
        },
      ];
      const modifier = new SystemPromptModifier(modifications);
      const result = modifier.apply(basePrompt);

      expect(result).toEqual(`You are a helpful assistant.

GUIDELINES:
- Follow user instructions carefully
- Be concise and clear
- Always verify your answers
- Read ALL notes at once

CONTEXT:
Use the provided information to answer.
New guideline to follow`);
    });

    it('should add content after matching pattern', () => {
      const modifications: SystemPromptItem[] = [
        {
          mode: 'add',
          pattern: 'Follow user instructions carefully',
          content: '- Verify sources before responding',
        },
      ];
      const modifier = new SystemPromptModifier(modifications);
      const result = modifier.apply(basePrompt);

      expect(result).toEqual(`You are a helpful assistant.

GUIDELINES:
- Follow user instructions carefully
- Verify sources before responding
- Be concise and clear
- Always verify your answers
- Read ALL notes at once

CONTEXT:
Use the provided information to answer.`);
    });
  });

  describe('Edge cases', () => {
    it('should handle empty modifications array', () => {
      const modifier = new SystemPromptModifier([]);
      const result = modifier.apply(basePrompt);

      expect(result).toBe(basePrompt);
    });

    it('should handle modification with no matching pattern', () => {
      const modifications: SystemPromptItem[] = [
        {
          mode: 'remove',
          pattern: 'nonexistent pattern',
        },
      ];
      const modifier = new SystemPromptModifier(modifications);
      const result = modifier.apply(basePrompt);

      expect(result).toBe(basePrompt);
    });

    it('should handle invalid regex gracefully by falling back to partial match', () => {
      const modifications: SystemPromptItem[] = [
        {
          mode: 'remove',
          pattern: '[invalid(regex',
          matchType: 'regex',
        },
      ];

      // Should not throw error
      const modifier = new SystemPromptModifier(modifications);
      expect(() => modifier.apply(basePrompt)).not.toThrow();
    });

    it('should handle multiple modifications on the same line', () => {
      const modifications: SystemPromptItem[] = [
        {
          mode: 'modify',
          pattern: 'Read ALL',
          replacement: 'Read SOME',
        },
        {
          mode: 'modify',
          pattern: 'notes at once',
          replacement: 'notes sequentially',
        },
      ];
      const modifier = new SystemPromptModifier(modifications);
      const result = modifier.apply(basePrompt);

      // First modification should work
      expect(result).toContain('Read SOME');
      // Second modification should also work on the modified line
      expect(result).toContain('notes sequentially');
    });
  });

  describe('Real-world example', () => {
    it('should handle the user suggested structure', () => {
      const modifications: SystemPromptItem[] = [
        'Instruction 1', // Old format - will be handled separately
        {
          mode: 'modify',
          pattern: 'Read ALL',
          replacement: 'Read one at a time',
        },
        {
          mode: 'remove',
          pattern: 'CONFIRMATION_TOOL_NAME BEFORE reading the entire',
        },
      ];

      const readCommandPrompt = `You are a helpful assistant.

GUIDELINES:
- Use CONTENT_READING_TOOL_NAME to read any type of content
- You MUST use CONFIRMATION_TOOL_NAME BEFORE reading the entire content of any note
- Read ALL notes at once with multiple tool calls`;

      const modifier = new SystemPromptModifier(modifications);
      const result = modifier.apply(readCommandPrompt);
      const stringAdditions = modifier.getAdditionalSystemPrompts();

      // String additions should be available separately
      expect(stringAdditions).toEqual(['Instruction 1']);

      // Result should only have modifications applied (no string additions)
      expect(result).toEqual(`You are a helpful assistant.

GUIDELINES:
- Use CONTENT_READING_TOOL_NAME to read any type of content
- Read one at a time notes at once with multiple tool calls`);
    });
  });
});
