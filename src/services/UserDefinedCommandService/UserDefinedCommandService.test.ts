import { TFile, TFolder } from 'obsidian';
import i18next from 'src/i18n';
import { NoteContentService } from 'src/services/NoteContentService';
import { UserDefinedCommandService } from './UserDefinedCommandService';
import type StewardPlugin from 'src/main';
import { getInstance } from 'src/utils/getInstance';
import { UserDefinedCommandV1, type UserDefinedCommandV1Data } from './versions/v1';
import { UserDefinedCommandV2, type UserDefinedCommandV2Data } from './versions/v2';
import { Intent } from 'src/solutions/commands/types';

function createMockPlugin(): jest.Mocked<StewardPlugin> {
  return {
    app: {
      metadataCache: {
        getFirstLinkpathDest: jest.fn(),
        getFileCache: jest.fn(),
      },
      vault: {
        read: jest.fn(),
        getAbstractFileByPath: jest.fn(),
        on: jest.fn().mockReturnValue({ events: [] }),
        createFolder: jest.fn(),
      },
      workspace: {
        onLayoutReady: jest.fn().mockImplementation((callback: () => void) => {
          // Immediately call the callback to simulate layout ready
          callback();
          return { events: [] };
        }),
        getActiveFile: jest.fn(),
      },
    },
    settings: {
      stewardFolder: 'Steward',
    },
    registerEvent: jest.fn(),
    noteContentService: {
      processWikilinksInContent: jest.fn().mockImplementation(async (content: string) => content),
      parseMarkdownFrontmatter: NoteContentService.prototype.parseMarkdownFrontmatter.bind(
        {} as NoteContentService
      ),
    },
  } as unknown as jest.Mocked<StewardPlugin>;
}

describe('UserDefinedCommandService', () => {
  let userDefinedCommandService: UserDefinedCommandService;
  let mockPlugin: jest.Mocked<StewardPlugin>;
  let mockCommandsFolder: TFolder;

  beforeEach(() => {
    // Create mock plugin with required methods
    mockPlugin = createMockPlugin();

    // Mock the commands folder
    mockCommandsFolder = getInstance(TFolder, {
      path: 'Steward/Commands',
      children: [],
    });

    // Mock the getAbstractFileByPath and instanceof check
    mockPlugin.app.vault.getAbstractFileByPath = jest.fn().mockImplementation((path: string) => {
      if (path === 'Steward/Commands') {
        return mockCommandsFolder;
      }
      return null;
    });

    // Mock the instanceof TFolder check
    jest
      .spyOn(
        UserDefinedCommandService.prototype as unknown as { loadAllCommands: () => Promise<void> },
        'loadAllCommands'
      )
      .mockImplementation(function (this: UserDefinedCommandService) {
        // Simulate successful loading
        return Promise.resolve();
      });

    // Mock ensureExampleCommandExists to prevent it from running during tests
    jest
      .spyOn(
        UserDefinedCommandService.prototype as unknown as {
          ensureExampleCommandExists: () => Promise<void>;
        },
        'ensureExampleCommandExists'
      )
      .mockImplementation(function (this: UserDefinedCommandService) {
        // Do nothing during tests
        return Promise.resolve();
      });

    userDefinedCommandService = UserDefinedCommandService.getInstance(mockPlugin);
  });

  it('should be defined', () => {
    expect(userDefinedCommandService).toBeDefined();
  });

  describe('loadCommandFromFile', () => {
    const commandFilePath = 'Steward/Commands/test-udc.md';

    function udcNoteBody(yamlInner: string): string {
      return ['```yaml', yamlInner.trim(), '```'].join('\n');
    }

    const validV2Yaml = `
command_name: udc_load_test
steps:
  - name: read
    query: test query
`;

    beforeEach(() => {
      mockPlugin.app.vault.cachedRead = jest.fn();
      mockPlugin.app.vault.modify = jest.fn().mockResolvedValue(undefined);
      mockPlugin.app.fileManager = {
        processFrontMatter: jest.fn().mockResolvedValue(undefined),
      } as unknown as typeof mockPlugin.app.fileManager;
    });

    it('sets enabled: true and status to valid when frontmatter omits enabled and YAML is valid', async () => {
      const file = getInstance(TFile, {
        path: commandFilePath,
        basename: 'test-udc',
        extension: 'md',
      });
      mockPlugin.app.vault.cachedRead = jest.fn().mockResolvedValue(udcNoteBody(validV2Yaml));

      const fm: Record<string, unknown> = {};
      mockPlugin.app.fileManager.processFrontMatter = jest
        .fn()
        .mockImplementation((_f, fn: (x: Record<string, unknown>) => void) => {
          fn(fm);
          return Promise.resolve();
        });

      await userDefinedCommandService['loadCommandFromFile'](file);

      expect(fm.enabled).toBe(true);
      expect(fm.status).toBe(i18next.t('common.statusValid'));
      expect(userDefinedCommandService.hasCommand('udc_load_test')).toBe(true);
    });

    it('does not call processFrontMatter when enabled and status already match', async () => {
      const file = getInstance(TFile, {
        path: commandFilePath,
        basename: 'test-udc',
        extension: 'md',
      });
      const note = [
        '---',
        'enabled: true',
        `status: ${JSON.stringify(i18next.t('common.statusValid'))}`,
        '---',
        '',
        udcNoteBody(validV2Yaml),
      ].join('\n');
      mockPlugin.app.vault.cachedRead = jest.fn().mockResolvedValue(note);

      await userDefinedCommandService['loadCommandFromFile'](file);

      expect(mockPlugin.app.fileManager.processFrontMatter).not.toHaveBeenCalled();
      expect(userDefinedCommandService.hasCommand('udc_load_test')).toBe(true);
    });

    it('sets status to invalid when no yaml code block is present', async () => {
      const file = getInstance(TFile, {
        path: commandFilePath,
        basename: 'test-udc',
        extension: 'md',
      });
      mockPlugin.app.vault.cachedRead = jest.fn().mockResolvedValue('# No command block\n');

      const fm: Record<string, unknown> = {};
      mockPlugin.app.fileManager.processFrontMatter = jest
        .fn()
        .mockImplementation((_f, fn: (x: Record<string, unknown>) => void) => {
          fn(fm);
          return Promise.resolve();
        });

      await userDefinedCommandService['loadCommandFromFile'](file);

      expect(fm.enabled).toBe(true);
      expect(fm.status).toBe(
        i18next.t('common.statusInvalid', {
          errors: i18next.t('validation.noCommandYamlBlock'),
        })
      );
      expect(userDefinedCommandService.userDefinedCommands.size).toBe(0);
    });

    it('sets status to invalid when command YAML fails validation', async () => {
      const file = getInstance(TFile, {
        path: commandFilePath,
        basename: 'test-udc',
        extension: 'md',
      });
      const badYaml = `
command_name: invalid name
steps:
  - query: x
`;
      mockPlugin.app.vault.cachedRead = jest.fn().mockResolvedValue(udcNoteBody(badYaml));

      const fm: Record<string, unknown> = {};
      mockPlugin.app.fileManager.processFrontMatter = jest
        .fn()
        .mockImplementation((_f, fn: (x: Record<string, unknown>) => void) => {
          fn(fm);
          return Promise.resolve();
        });

      await userDefinedCommandService['loadCommandFromFile'](file);

      expect(fm.enabled).toBe(true);
      expect(fm.status).not.toBe(i18next.t('common.statusValid'));
      expect(String(fm.status)).toContain('Invalid');
      expect(userDefinedCommandService.hasCommand('invalid name')).toBe(false);
    });

    it('does not register the command when enabled is false but still records valid status', async () => {
      const file = getInstance(TFile, {
        path: commandFilePath,
        basename: 'test-udc',
        extension: 'md',
      });
      const note = ['---', 'enabled: false', '---', '', udcNoteBody(validV2Yaml)].join('\n');
      mockPlugin.app.vault.cachedRead = jest.fn().mockResolvedValue(note);

      const fm: Record<string, unknown> = {};
      mockPlugin.app.fileManager.processFrontMatter = jest
        .fn()
        .mockImplementation((_f, fn: (x: Record<string, unknown>) => void) => {
          fn(fm);
          return Promise.resolve();
        });

      await userDefinedCommandService['loadCommandFromFile'](file);

      expect(fm.status).toBe(i18next.t('common.statusValid'));
      expect(userDefinedCommandService.hasCommand('udc_load_test')).toBe(false);
    });
  });

  describe('removeCommandsFromFile', () => {
    // We need to access the private method for testing
    let removeCommandsFromFile: (filePath: string) => void;

    beforeEach(() => {
      // Access the private method using type assertion
      removeCommandsFromFile =
        userDefinedCommandService['removeCommandsFromFile'].bind(userDefinedCommandService);

      // Set up some test commands in the map (using v1)
      const command1Data: UserDefinedCommandV1Data = {
        command_name: 'command1',
        commands: [{ name: 'test', query: 'query1' }],
        file_path: 'path/to/file1.md',
      };
      userDefinedCommandService.userDefinedCommands.set(
        'command1',
        new UserDefinedCommandV1(command1Data)
      );

      const command2Data: UserDefinedCommandV1Data = {
        command_name: 'command2',
        commands: [{ name: 'test', query: 'query2' }],
        file_path: 'path/to/file1.md',
      };
      userDefinedCommandService.userDefinedCommands.set(
        'command2',
        new UserDefinedCommandV1(command2Data)
      );

      const command3Data: UserDefinedCommandV1Data = {
        command_name: 'command3',
        commands: [{ name: 'test', query: 'query3' }],
        file_path: 'path/to/file2.md',
      };
      userDefinedCommandService.userDefinedCommands.set(
        'command3',
        new UserDefinedCommandV1(command3Data)
      );
    });

    it('should remove all commands from a specific file', () => {
      // Execute
      removeCommandsFromFile('path/to/file1.md');

      // Verify
      expect(userDefinedCommandService.userDefinedCommands.has('command1')).toBe(false);
      expect(userDefinedCommandService.userDefinedCommands.has('command2')).toBe(false);
      expect(userDefinedCommandService.userDefinedCommands.has('command3')).toBe(true);
    });

    it('should not remove commands if file path does not match', () => {
      // Execute
      removeCommandsFromFile('path/to/nonexistent.md');

      // Verify
      expect(userDefinedCommandService.userDefinedCommands.size).toBe(3);
    });
  });

  describe('getCommandNames', () => {
    it('should return all command names when no commands are hidden', () => {
      // Arrange
      const command1Data: UserDefinedCommandV1Data = {
        command_name: 'command1',
        commands: [{ name: 'test', query: 'query1' }],
        file_path: 'path/to/file1.md',
      };
      userDefinedCommandService.userDefinedCommands.set(
        'command1',
        new UserDefinedCommandV1(command1Data)
      );

      const command2Data: UserDefinedCommandV1Data = {
        command_name: 'command2',
        commands: [{ name: 'test', query: 'query2' }],
        file_path: 'path/to/file2.md',
      };
      userDefinedCommandService.userDefinedCommands.set(
        'command2',
        new UserDefinedCommandV1(command2Data)
      );

      // Execute
      const result = userDefinedCommandService.getCommandNames();

      // Verify
      expect(result).toEqual(['command1', 'command2']);
    });

    it('should filter out hidden commands', () => {
      // Arrange
      const visibleCommandData: UserDefinedCommandV1Data = {
        command_name: 'visible_command',
        commands: [{ name: 'test', query: 'query1' }],
        file_path: 'path/to/file1.md',
      };
      userDefinedCommandService.userDefinedCommands.set(
        'visible_command',
        new UserDefinedCommandV1(visibleCommandData)
      );

      const hiddenCommandData: UserDefinedCommandV1Data = {
        command_name: 'hidden_command',
        commands: [{ name: 'test', query: 'query2' }],
        file_path: 'path/to/file2.md',
        hidden: true,
      };
      userDefinedCommandService.userDefinedCommands.set(
        'hidden_command',
        new UserDefinedCommandV1(hiddenCommandData)
      );

      const anotherVisibleData: UserDefinedCommandV1Data = {
        command_name: 'another_visible',
        commands: [{ name: 'test', query: 'query3' }],
        file_path: 'path/to/file3.md',
      };
      userDefinedCommandService.userDefinedCommands.set(
        'another_visible',
        new UserDefinedCommandV1(anotherVisibleData)
      );

      // Execute
      const result = userDefinedCommandService.getCommandNames();

      // Verify
      expect(result).toEqual(['visible_command', 'another_visible']);
      expect(result).not.toContain('hidden_command');
    });

    it('should return empty array when all commands are hidden', () => {
      // Arrange
      const hiddenCommand1Data: UserDefinedCommandV1Data = {
        command_name: 'hidden_command1',
        commands: [{ name: 'test', query: 'query1' }],
        file_path: 'path/to/file1.md',
        hidden: true,
      };
      userDefinedCommandService.userDefinedCommands.set(
        'hidden_command1',
        new UserDefinedCommandV1(hiddenCommand1Data)
      );

      const hiddenCommand2Data: UserDefinedCommandV1Data = {
        command_name: 'hidden_command2',
        commands: [{ name: 'test', query: 'query2' }],
        file_path: 'path/to/file2.md',
        hidden: true,
      };
      userDefinedCommandService.userDefinedCommands.set(
        'hidden_command2',
        new UserDefinedCommandV1(hiddenCommand2Data)
      );

      // Execute
      const result = userDefinedCommandService.getCommandNames();

      // Verify
      expect(result).toEqual([]);
    });
  });

  describe('expandUserDefinedCommandIntents', () => {
    it('should expand user-defined commands into their constituent CommandIntents', async () => {
      // Arrange
      const mockCommandProcessorService = {
        isBuiltInCommand: jest.fn().mockReturnValue(false),
      };

      // Mock the commandProcessorService getter
      Object.defineProperty(userDefinedCommandService, 'commandProcessorService', {
        get: jest.fn().mockReturnValue(mockCommandProcessorService),
      });

      // Set up a test user-defined command (v1)
      const testCommandData: UserDefinedCommandV1Data = {
        command_name: 'testCommand',
        commands: [
          { name: 'read', query: 'Read $from_user' },
          { name: 'create', query: 'Create note about $from_user' },
        ],
        file_path: 'path/to/test.md',
      };
      userDefinedCommandService.userDefinedCommands.set(
        'testCommand',
        new UserDefinedCommandV1(testCommandData)
      );

      // Create input CommandIntents that reference the user-defined command
      const inputIntents: Intent[] = [
        {
          type: 'testCommand',
          query: 'some user input',
        },
      ];

      // Execute
      const result = await userDefinedCommandService.expandUserDefinedCommandIntents(
        inputIntents,
        'some user input'
      );

      // Verify
      expect(result).toMatchObject([
        {
          type: 'read',
          model: undefined,
          query: 'Read some user input',
          systemPrompts: undefined,
        },
        {
          type: 'create',
          model: undefined,
          query: 'Create note about some user input',
          systemPrompts: undefined,
        },
      ]);
    });

    it('does not copy root-level system_prompt onto each expanded step intent', async () => {
      const mockCommandProcessorService = {
        isBuiltInCommand: jest.fn().mockReturnValue(false),
      };

      Object.defineProperty(userDefinedCommandService, 'commandProcessorService', {
        get: jest.fn().mockReturnValue(mockCommandProcessorService),
      });

      const v2Data: UserDefinedCommandV2Data = {
        command_name: 'udcRootOnlyPrompt',
        file_path: 'path/to/udc.md',
        system_prompt: ['[[Steward/Commands/Flashcard ask#Flashcard guidelines]]'],
        steps: [
          { name: 'read', query: 'Read $from_user' },
          { name: 'generate', query: 'Ask $from_user' },
        ],
      };
      userDefinedCommandService.userDefinedCommands.set(
        'udcRootOnlyPrompt',
        new UserDefinedCommandV2(v2Data)
      );

      const result = await userDefinedCommandService.expandUserDefinedCommandIntents(
        [{ type: 'udcRootOnlyPrompt', query: 'hello' }],
        'hello'
      );

      expect(result).toMatchObject([
        { type: 'read', systemPrompts: undefined },
        { type: 'generate', systemPrompts: undefined },
      ]);
    });

    it('puts only step-level system_prompt on each expanded intent (no merge with root)', async () => {
      const mockCommandProcessorService = {
        isBuiltInCommand: jest.fn().mockReturnValue(false),
      };

      Object.defineProperty(userDefinedCommandService, 'commandProcessorService', {
        get: jest.fn().mockReturnValue(mockCommandProcessorService),
      });

      const v2Data: UserDefinedCommandV2Data = {
        command_name: 'udcStepPrompt',
        file_path: 'path/to/udc.md',
        system_prompt: ['root baseline'],
        steps: [
          { name: 'read', query: 'Read $from_user' },
          { name: 'generate', query: 'Ask $from_user', system_prompt: ['step extra'] },
        ],
      };
      userDefinedCommandService.userDefinedCommands.set(
        'udcStepPrompt',
        new UserDefinedCommandV2(v2Data)
      );

      const result = await userDefinedCommandService.expandUserDefinedCommandIntents(
        [{ type: 'udcStepPrompt', query: 'hello' }],
        'hello'
      );

      expect(result).toMatchObject([
        { type: 'read', systemPrompts: undefined },
        { type: 'generate', systemPrompts: ['step extra'] },
      ]);
    });

    it('should override built-in audio command with custom query and system prompt', async () => {
      // Arrange
      const mockCommandProcessorService = {
        isBuiltInCommand: jest.fn().mockImplementation((commandType: string) => {
          // audio is a built-in command
          return commandType === 'audio';
        }),
      };

      // Mock the commandProcessorService getter
      Object.defineProperty(userDefinedCommandService, 'commandProcessorService', {
        get: jest.fn().mockReturnValue(mockCommandProcessorService),
      });

      // Set up a test user-defined command that overrides the audio command (v1)
      const audioCommandData: UserDefinedCommandV1Data = {
        command_name: 'audio',
        commands: [
          {
            name: 'audio',
            query: 'Pronounce: $from_user',
            system_prompt: ['Fix typo if any'],
          },
        ],
        file_path: 'path/to/audio-override.md',
      };
      userDefinedCommandService.userDefinedCommands.set(
        'audio',
        new UserDefinedCommandV1(audioCommandData)
      );

      // Create input CommandIntents that reference the overridden audio command
      const inputIntents: Intent[] = [
        {
          type: 'audio',
          query: 'hello world',
        },
      ];

      // Execute
      const result = await userDefinedCommandService.expandUserDefinedCommandIntents(
        inputIntents,
        'hello world'
      );

      // Verify
      expect(result).toMatchObject([
        {
          type: 'audio',
          model: undefined,
          query: 'Pronounce: hello world',
          systemPrompts: ['Fix typo if any'],
        },
      ]);
    });

    it('should handle model overrides at command and step levels', async () => {
      // Arrange
      const mockCommandProcessorService = {
        isBuiltInCommand: jest.fn().mockReturnValue(false),
      };

      // Mock the commandProcessorService getter
      Object.defineProperty(userDefinedCommandService, 'commandProcessorService', {
        get: jest.fn().mockReturnValue(mockCommandProcessorService),
      });

      // Set up a test user-defined command with model overrides (v1)
      const multiModelCommandData: UserDefinedCommandV1Data = {
        command_name: 'multiModelCommand',
        model: 'gemini-2.5', // Default model for the command
        commands: [
          {
            name: 'read',
            query: 'Read $from_user',
            model: 'gpt-4o', // Override for this specific step
          },
          {
            name: 'create',
            query: 'Create note about $from_user',
            // No model defined - should use command default
          },
        ],
        file_path: 'path/to/multi-model.md',
      };
      userDefinedCommandService.userDefinedCommands.set(
        'multiModelCommand',
        new UserDefinedCommandV1(multiModelCommandData)
      );

      // Create input CommandIntents that reference the multi-model command
      const inputIntents: Intent[] = [
        {
          type: 'multiModelCommand',
          query: 'test content',
        },
      ];

      // Execute
      const result = await userDefinedCommandService.expandUserDefinedCommandIntents(
        inputIntents,
        'test content'
      );

      // Verify
      expect(result).toMatchObject([
        {
          type: 'read',
          model: 'gpt-4o',
          query: 'Read test content',
          systemPrompts: undefined,
        },
        {
          type: 'create',
          model: 'gemini-2.5',
          query: 'Create note about test content',
          systemPrompts: undefined,
        },
      ]);
    });
  });
});
