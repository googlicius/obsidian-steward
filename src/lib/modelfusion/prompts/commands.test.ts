import { formatCommandsForPrompt, formatQueryTemplatesForPrompt } from './commands';

describe('commands', () => {
  describe('formatCommandsForPrompt', () => {
    it('should return formatted commands for prompt', () => {
      const formattedCommands = formatCommandsForPrompt();
      expect(formattedCommands).toMatchSnapshot();
    });

    it('should return formatted commands for prompt with given command names', () => {
      const formattedCommands = formatCommandsForPrompt(['read', 'generate', 'edit']);
      expect(formattedCommands).toMatchSnapshot();
    });

    it('should throw error if command not found', () => {
      expect(() => formatCommandsForPrompt(['not_found'])).toThrow('Command not_found not found');
    });

    it('should handle command names that include a query fragment', () => {
      const formattedCommands = formatCommandsForPrompt(['vault?tools=list,rename']);

      expect(formattedCommands).toMatchSnapshot();
    });

    it('should merge multiple commands referencing the same agent by tools', () => {
      const formattedCommands = formatCommandsForPrompt([
        'vault?tools=list',
        'vault?tools=rename',
        'vault?tools=copy',
      ]);

      expect(formattedCommands).toMatchSnapshot();
    });
  });

  describe('formatQueryTemplatesForPrompt', () => {
    it('should return formatted query templates for prompt', () => {
      const formattedTemplates = formatQueryTemplatesForPrompt();
      expect(formattedTemplates).toMatchSnapshot();
    });

    it('should return formatted query templates for prompt with given command names', () => {
      const formattedTemplates = formatQueryTemplatesForPrompt(['read', 'generate', 'edit']);
      expect(formattedTemplates).toMatchSnapshot();
    });

    it('should return empty YAML structure when no commands have templates', () => {
      const formattedTemplates = formatQueryTemplatesForPrompt(['close', 'confirm']);
      expect(formattedTemplates).toMatchSnapshot();
    });
  });
});
