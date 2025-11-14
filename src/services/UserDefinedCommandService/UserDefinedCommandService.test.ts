import { TFolder } from 'obsidian';
import { UserDefinedCommandService } from './UserDefinedCommandService';
import type StewardPlugin from 'src/main';
import { getInstance } from 'src/utils/getInstance';
import { UserDefinedCommandV1, type UserDefinedCommandV1Data } from './versions/v1';
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
      },
    },
    settings: {
      stewardFolder: 'Steward',
    },
    registerEvent: jest.fn(),
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

    userDefinedCommandService = UserDefinedCommandService.getInstance(mockPlugin);
  });

  it('should be defined', () => {
    expect(userDefinedCommandService).toBeDefined();
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
    it('should expand user-defined commands into their constituent CommandIntents', () => {
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
      const result = userDefinedCommandService.expandUserDefinedCommandIntents(
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

    it('should override built-in audio command with custom query and system prompt', () => {
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
      const result = userDefinedCommandService.expandUserDefinedCommandIntents(
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

    it('should handle model overrides at command and step levels', () => {
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
      const result = userDefinedCommandService.expandUserDefinedCommandIntents(
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
