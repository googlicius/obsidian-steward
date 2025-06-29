import { UserDefinedCommandService } from './UserDefinedCommandService';

import type StewardPlugin from 'src/main';

// Mock the global sleep function
global.sleep = jest.fn().mockImplementation(ms => Promise.resolve());

describe('UserDefinedCommandService', () => {
  let userDefinedCommandService: UserDefinedCommandService;
  let mockPlugin: any;
  let mockCommandsFolder: any;

  beforeEach(() => {
    // Create mock plugin with required methods
    mockPlugin = {
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
      },
      settings: {
        stewardFolder: 'Steward',
      },
      registerEvent: jest.fn(),
    } as unknown as StewardPlugin;

    // Mock the commands folder
    mockCommandsFolder = {
      path: 'Steward/Commands',
      children: [],
    };

    // Mock the getAbstractFileByPath and instanceof check
    mockPlugin.app.vault.getAbstractFileByPath.mockImplementation((path: string) => {
      if (path === 'Steward/Commands') {
        return mockCommandsFolder;
      }
      return null;
    });

    // Mock the instanceof TFolder check
    jest
      .spyOn(UserDefinedCommandService.prototype as any, 'loadAllCommands')
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
      removeCommandsFromFile = (userDefinedCommandService as any).removeCommandsFromFile.bind(
        userDefinedCommandService
      );

      // Set up some test commands in the map
      userDefinedCommandService.userDefinedCommands.set('command1', {
        command_name: 'command1',
        commands: [{ name: 'test', query: 'query1' }],
        file_path: 'path/to/file1.md',
      });

      userDefinedCommandService.userDefinedCommands.set('command2', {
        command_name: 'command2',
        commands: [{ name: 'test', query: 'query2' }],
        file_path: 'path/to/file1.md',
      });

      userDefinedCommandService.userDefinedCommands.set('command3', {
        command_name: 'command3',
        commands: [{ name: 'test', query: 'query3' }],
        file_path: 'path/to/file2.md',
      });
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
});
