import { UserDefinedCommandV2, type UserDefinedCommandV2Data } from './v2';

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
});
