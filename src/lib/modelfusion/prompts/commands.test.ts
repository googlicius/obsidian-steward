import { ArtifactType } from 'src/solutions/artifact';
import {
  COMMAND_DEFINITIONS,
  CommandDefinition,
  artifactDependentExamples,
  formatCommandsForPrompt,
  formatCurrentArtifacts,
  formatQueryTemplatesForPrompt,
} from './commands';

describe('commands', () => {
  describe('formatCurrentArtifacts', () => {
    it('should return formatted current artifacts for prompt', () => {
      const formattedArtifacts = formatCurrentArtifacts([
        { artifactType: ArtifactType.SEARCH_RESULTS },
        { artifactType: ArtifactType.READ_CONTENT },
      ]);
      expect(formattedArtifacts).toMatchSnapshot();
    });
  });

  describe('formatCommandsForPrompt', () => {
    it('should return formatted commands for prompt', () => {
      const formattedCommands = formatCommandsForPrompt();
      expect(formattedCommands).toMatchSnapshot();
    });

    it('should return formatted commands for prompt with given command names', () => {
      const formattedCommands = formatCommandsForPrompt([
        'read',
        'generate',
        'update_from_artifact',
      ]);
      expect(formattedCommands).toMatchSnapshot();
    });

    it('should throw error if command not found', () => {
      expect(() => formatCommandsForPrompt(['not_found'])).toThrow('Command not_found not found');
    });
  });

  describe('formatQueryTemplatesForPrompt', () => {
    it('should return formatted query templates for prompt', () => {
      const formattedTemplates = formatQueryTemplatesForPrompt();
      expect(formattedTemplates).toMatchSnapshot();
    });

    it('should return formatted query templates for prompt with given command names', () => {
      const formattedTemplates = formatQueryTemplatesForPrompt([
        'read',
        'generate',
        'update_from_artifact',
      ]);
      expect(formattedTemplates).toMatchSnapshot();
    });

    it('should return empty YAML structure when no commands have templates', () => {
      const formattedTemplates = formatQueryTemplatesForPrompt(['close', 'confirm']);
      expect(formattedTemplates).toMatchSnapshot();
    });
  });

  describe('artifactDependentExamples', () => {
    it('should return examples for commands that depend on artifacts', () => {
      const commands = COMMAND_DEFINITIONS;
      const examples = artifactDependentExamples(commands);
      expect(examples).toMatchSnapshot();
    });

    it('should return empty string if there are no commands that depend on artifacts', () => {
      const commands = COMMAND_DEFINITIONS.filter(cmd => !cmd.artifactDesc);
      const examples = artifactDependentExamples(commands);
      expect(examples).toBe('');
    });

    it('should return empty string if there are no commands that create artifacts', () => {
      const commands = COMMAND_DEFINITIONS.filter(cmd => !cmd.artifactDesc);
      const examples = artifactDependentExamples(commands);
      expect(examples).toBe('');
    });

    it('should return only one example if there are only one command that creates artifacts', () => {
      const commands: CommandDefinition[] = [
        {
          commandType: 'read',
          description: 'Read a note',
          category: 'built-in',
          artifactDesc: 'The reading result',
        },
        {
          commandType: 'update_from_artifact',
          description: 'Update a note',
          category: 'built-in',
          artifactDesc: 'The updated content',
        },
      ];
      const examples = artifactDependentExamples(commands);
      expect(examples).toMatchSnapshot();
    });
  });
});
