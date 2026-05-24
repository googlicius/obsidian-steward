import {
  UserDefinedCommandV2,
  userDefinedCommandV2Schema,
  udcV2RootCliSchema,
  type UserDefinedCommandV2Data,
} from './v2';

describe('UserDefinedCommandV2', () => {
  describe('heading-only wikilink transformation', () => {
    it('should transform heading-only wikilinks in root-level system_prompt', () => {
      const data: UserDefinedCommandV2Data = {
        command_name: 'test_command',
        file_path: 'Steward/Commands/MyCommand.md',
        steps: [{ query: 'test query' }],
        system_prompt: ['[[#Guidelines]]', 'Some other text', '[[#Instructions]]'],
      };

      const command = new UserDefinedCommandV2(data);
      const normalized = command.normalized;

      expect(normalized.system_prompt).toEqual([
        '[[Steward/Commands/MyCommand#Guidelines]]',
        'Some other text',
        '[[Steward/Commands/MyCommand#Instructions]]',
      ]);
    });

    it('should transform heading-only wikilinks in step-level system_prompt', () => {
      const data: UserDefinedCommandV2Data = {
        command_name: 'test_command',
        file_path: 'Steward/Commands/MyCommand.md',
        steps: [
          {
            name: 'step1',
            query: 'query1',
            system_prompt: ['[[#Step1Guidelines]]', 'Regular text'],
          },
          {
            name: 'step2',
            query: 'query2',
            system_prompt: ['[[#Step2Instructions]]'],
          },
        ],
      };

      const command = new UserDefinedCommandV2(data);
      const normalized = command.normalized;

      expect(normalized.steps[0].system_prompt).toEqual([
        '[[Steward/Commands/MyCommand#Step1Guidelines]]',
        'Regular text',
      ]);
      expect(normalized.steps[1].system_prompt).toEqual([
        '[[Steward/Commands/MyCommand#Step2Instructions]]',
      ]);
    });

    it('should transform heading-only wikilinks in both root and step-level system_prompts', () => {
      const data: UserDefinedCommandV2Data = {
        command_name: 'test_command',
        file_path: 'Steward/Commands/MyCommand.md',
        system_prompt: ['[[#RootGuidelines]]'],
        steps: [
          {
            name: 'step1',
            query: 'query1',
            system_prompt: ['[[#StepGuidelines]]'],
          },
        ],
      };

      const command = new UserDefinedCommandV2(data);
      const normalized = command.normalized;

      expect(normalized.system_prompt).toEqual(['[[Steward/Commands/MyCommand#RootGuidelines]]']);
      expect(normalized.steps[0].system_prompt).toEqual([
        '[[Steward/Commands/MyCommand#StepGuidelines]]',
      ]);
    });

    it('should not transform regular wikilinks (non-heading-only)', () => {
      const data: UserDefinedCommandV2Data = {
        command_name: 'test_command',
        file_path: 'Steward/Commands/MyCommand.md',
        system_prompt: [
          '[[#HeadingOnly]]',
          '[[RegularNote]]',
          '[[AnotherNote#Heading]]',
          '[[#AnotherHeadingOnly]]',
        ],
        steps: [{ query: 'test query' }],
      };

      const command = new UserDefinedCommandV2(data);
      const normalized = command.normalized;

      expect(normalized.system_prompt).toEqual([
        '[[Steward/Commands/MyCommand#HeadingOnly]]',
        '[[RegularNote]]',
        '[[AnotherNote#Heading]]',
        '[[Steward/Commands/MyCommand#AnotherHeadingOnly]]',
      ]);
    });

    it('should handle file paths with folders', () => {
      const data: UserDefinedCommandV2Data = {
        command_name: 'test_command',
        file_path: 'Steward/Commands/SubFolder/MyCommand.md',
        system_prompt: ['[[#Guidelines]]'],
        steps: [{ query: 'test query' }],
      };

      const command = new UserDefinedCommandV2(data);
      const normalized = command.normalized;

      expect(normalized.system_prompt).toEqual([
        '[[Steward/Commands/SubFolder/MyCommand#Guidelines]]',
      ]);
    });

    it('should handle file paths without folders', () => {
      const data: UserDefinedCommandV2Data = {
        command_name: 'test_command',
        file_path: 'MyCommand.md',
        system_prompt: ['[[#Guidelines]]'],
        steps: [{ query: 'test query' }],
      };

      const command = new UserDefinedCommandV2(data);
      const normalized = command.normalized;

      expect(normalized.system_prompt).toEqual(['[[MyCommand#Guidelines]]']);
    });

    it('should handle multiple heading-only wikilinks in a single prompt string', () => {
      const data: UserDefinedCommandV2Data = {
        command_name: 'test_command',
        file_path: 'Steward/Commands/MyCommand.md',
        system_prompt: ['Follow [[#Guidelines]] and [[#Instructions]] for this task'],
        steps: [{ query: 'test query' }],
      };

      const command = new UserDefinedCommandV2(data);
      const normalized = command.normalized;

      expect(normalized.system_prompt).toEqual([
        'Follow [[Steward/Commands/MyCommand#Guidelines]] and [[Steward/Commands/MyCommand#Instructions]] for this task',
      ]);
    });

    it('should handle empty file_path by leaving wikilinks unchanged', () => {
      const data: UserDefinedCommandV2Data = {
        command_name: 'test_command',
        file_path: '',
        system_prompt: ['[[#Guidelines]]'],
        steps: [{ query: 'test query' }],
      };

      const command = new UserDefinedCommandV2(data);
      const normalized = command.normalized;

      expect(normalized.system_prompt).toEqual(['[[#Guidelines]]']);
    });

    it('should handle undefined file_path by leaving wikilinks unchanged', () => {
      const data: UserDefinedCommandV2Data = {
        command_name: 'test_command',
        file_path: undefined as unknown as string,
        system_prompt: ['[[#Guidelines]]'],
        steps: [{ query: 'test query' }],
      };

      const command = new UserDefinedCommandV2(data);
      const normalized = command.normalized;

      expect(normalized.system_prompt).toEqual(['[[#Guidelines]]']);
    });
  });

  describe('command description', () => {
    it('should pass description through normalized output', () => {
      const data: UserDefinedCommandV2Data = {
        command_name: 'with_desc',
        description: 'Short help blurb.',
        file_path: 'Steward/Commands/x.md',
        steps: [{ query: 'q' }],
      };

      const command = new UserDefinedCommandV2(data);
      expect(command.normalized.description).toBe('Short help blurb.');
    });

    it('should omit description when not set', () => {
      const data: UserDefinedCommandV2Data = {
        command_name: 'no_desc',
        file_path: 'Steward/Commands/y.md',
        steps: [{ query: 'q' }],
      };

      const command = new UserDefinedCommandV2(data);
      expect(command.normalized.description).toBeUndefined();
    });
  });

  describe('udcV2RootCliSchema', () => {
    it('trims shell and copies whitelist', () => {
      const result = udcV2RootCliSchema.parse({
        shell: '  /bin/zsh  ',
        whitelist: ['echo*', 'ls'],
      });

      expect(result).toEqual({ shell: '/bin/zsh', whitelist: ['echo*', 'ls'] });
    });

    it('returns undefined when shell is only whitespace and whitelist absent', () => {
      expect(udcV2RootCliSchema.parse({ shell: '   \t' })).toBeUndefined();
    });

    it('returns undefined for empty object', () => {
      expect(udcV2RootCliSchema.parse({})).toBeUndefined();
    });

    it('returns whitelist only when shell empty or missing', () => {
      expect(udcV2RootCliSchema.parse({ whitelist: ['pwd'] })).toEqual({ whitelist: ['pwd'] });
    });

    it('returns shell only when whitelist absent', () => {
      expect(udcV2RootCliSchema.parse({ shell: '/bin/sh' })).toEqual({ shell: '/bin/sh' });
    });

    it('rejects whitelist entries that are only * wildcards', () => {
      expect(() => udcV2RootCliSchema.parse({ whitelist: ['*'] })).toThrow();
      expect(() => udcV2RootCliSchema.parse({ whitelist: ['**'] })).toThrow();
      expect(() => udcV2RootCliSchema.parse({ whitelist: [' *** '] })).toThrow();
    });
  });

  describe('userDefinedCommandV2Schema cli', () => {
    it('normalizes cli via parse like other transformed fields', () => {
      const result = userDefinedCommandV2Schema.parse({
        command_name: 'c',
        steps: [{ query: 'q' }],
        cli: { shell: ' bash ', whitelist: ['a'] },
      });

      expect(result.cli).toEqual({ shell: 'bash', whitelist: ['a'] });
    });

    it('omits cli when optional key missing', () => {
      const result = userDefinedCommandV2Schema.parse({
        command_name: 'c',
        steps: [{ query: 'q' }],
      });

      expect(result.cli).toBeUndefined();
    });
  });

  describe('root cli', () => {
    it('should normalize root cli.shell and cli.whitelist after validate', () => {
      const parsed = UserDefinedCommandV2.validate({
        command_name: 'shell_cmd',
        file_path: 'Steward/Commands/s.md',
        cli: { shell: '  /bin/zsh  ', whitelist: ['echo*'] },
        steps: [{ query: 'echo 1' }, { query: 'echo 2' }],
      });

      const command = new UserDefinedCommandV2(parsed);
      expect(command.normalized.cli).toEqual({
        shell: '/bin/zsh',
        whitelist: ['echo*'],
      });
    });
  });

  describe('enabled (YAML vs note)', () => {
    it('uses YAML enabled when set, over noteEnabled', () => {
      const data: UserDefinedCommandV2Data = {
        command_name: 'c',
        file_path: 'x.md',
        enabled: true,
        steps: [{ query: 'q' }],
      };
      expect(new UserDefinedCommandV2(data, false).normalized.enabled).toBe(true);
    });

    it('falls back to noteEnabled when YAML enabled omitted', () => {
      const data: UserDefinedCommandV2Data = {
        command_name: 'c',
        file_path: 'x.md',
        steps: [{ query: 'q' }],
      };
      expect(new UserDefinedCommandV2(data, false).normalized.enabled).toBe(false);
      expect(new UserDefinedCommandV2(data, true).normalized.enabled).toBe(true);
    });

    it('YAML enabled false overrides noteEnabled true', () => {
      const data: UserDefinedCommandV2Data = {
        command_name: 'c',
        file_path: 'x.md',
        enabled: false,
        steps: [{ query: 'q' }],
      };
      expect(new UserDefinedCommandV2(data, true).normalized.enabled).toBe(false);
    });
  });
});
