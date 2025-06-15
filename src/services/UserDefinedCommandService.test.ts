import { UserDefinedCommandService } from './UserDefinedCommandService';
import { TFile } from 'obsidian';
import StewardPlugin from 'src/main';

// Mock the global sleep function
global.sleep = jest.fn().mockImplementation(ms => Promise.resolve());

describe('UserDefinedCommandService', () => {
  let userDefinedCommandService: UserDefinedCommandService;
  let mockPlugin: any;
  let mockFile: any;
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

    // Create mock file
    mockFile = {
      path: 'test-file.md',
      basename: 'test-file',
      extension: 'md',
    } as unknown as TFile;

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

    userDefinedCommandService = new UserDefinedCommandService(mockPlugin);
  });

  it('should be defined', () => {
    expect(userDefinedCommandService).toBeDefined();
  });

  describe('getContentByPath', () => {
    // We need to access the private method for testing
    let getContentByPath: (linkPath: string) => Promise<string | null>;

    beforeEach(() => {
      // Access the private methods using type assertion
      getContentByPath = (userDefinedCommandService as any).getContentByPath.bind(
        userDefinedCommandService
      );
    });

    it('should get content when there is no anchor', async () => {
      // Setup
      const testContent = 'This is the test content';
      mockPlugin.app.metadataCache.getFirstLinkpathDest.mockReturnValue(mockFile);
      mockPlugin.app.vault.read.mockResolvedValue(testContent);

      // Execute
      const result = await getContentByPath('test-file');

      // Verify
      expect(mockPlugin.app.metadataCache.getFirstLinkpathDest).toHaveBeenCalledWith(
        'test-file',
        ''
      );
      expect(mockPlugin.app.vault.read).toHaveBeenCalledWith(mockFile);
      expect(result).toBe(testContent);
    });

    it('should get content under the specified heading (anchor)', async () => {
      // Setup
      const testContent = `# Main Title

Some content before the section.

## Introduction

This is the introduction content.
It spans multiple lines.

## Details

These are the details.

## Conclusion

This is the conclusion.`;

      mockPlugin.app.metadataCache.getFirstLinkpathDest.mockReturnValue(mockFile);
      mockPlugin.app.vault.read.mockResolvedValue(testContent);

      // Execute
      const result = await getContentByPath('test-file#Introduction');

      // Verify
      expect(mockPlugin.app.metadataCache.getFirstLinkpathDest).toHaveBeenCalledWith(
        'test-file',
        ''
      );
      expect(mockPlugin.app.vault.read).toHaveBeenCalledWith(mockFile);

      // The result should contain only the content under the Introduction heading
      // and before the Details heading
      const expectedOutput = 'This is the introduction content.\nIt spans multiple lines.'.replace(
        /\n/g,
        '\\n'
      );
      expect(result).toBe(expectedOutput);
    });

    it('should get content with alias', async () => {
      // Setup
      const testContent = 'This is the test content';
      mockPlugin.app.metadataCache.getFirstLinkpathDest.mockReturnValue(mockFile);
      mockPlugin.app.vault.read.mockResolvedValue(testContent);

      // Execute
      const result = await getContentByPath('test-file|Alias');

      // Verify
      expect(mockPlugin.app.metadataCache.getFirstLinkpathDest).toHaveBeenCalledWith(
        'test-file',
        ''
      );
      expect(mockPlugin.app.vault.read).toHaveBeenCalledWith(mockFile);
      expect(result).toBe(testContent);
    });

    it('should get content with both anchor and alias', async () => {
      // Setup
      const testContent = `# Main Title

Some content before the section.

## Introduction

This is the introduction content.
It spans multiple lines.

## Details

These are the details.

## Conclusion

This is the conclusion.`;

      mockPlugin.app.metadataCache.getFirstLinkpathDest.mockReturnValue(mockFile);
      mockPlugin.app.vault.read.mockResolvedValue(testContent);

      // Execute
      const result = await getContentByPath('test-file#Introduction|Intro Section');

      // Verify
      expect(mockPlugin.app.metadataCache.getFirstLinkpathDest).toHaveBeenCalledWith(
        'test-file',
        ''
      );
      expect(mockPlugin.app.vault.read).toHaveBeenCalledWith(mockFile);

      // The result should contain only the content under the Introduction heading
      const expectedOutput = 'This is the introduction content.\nIt spans multiple lines.'.replace(
        /\n/g,
        '\\n'
      );
      expect(result).toBe(expectedOutput);
    });

    it('should return null when file is not found', async () => {
      // Setup
      mockPlugin.app.metadataCache.getFirstLinkpathDest.mockReturnValue(null);

      // Execute
      const result = await getContentByPath('non-existent-file');

      // Verify
      expect(mockPlugin.app.metadataCache.getFirstLinkpathDest).toHaveBeenCalledWith(
        'non-existent-file',
        ''
      );
      expect(result).toBeNull();
    });

    it('should handle nested headings correctly', async () => {
      // Setup
      const testContent = `# Main Title

## Introduction

This is the introduction.

### Sub-section

This is a sub-section under Introduction.

#### Deep nested section

This is deeply nested.

## Details

These are the details.`;

      mockPlugin.app.metadataCache.getFirstLinkpathDest.mockReturnValue(mockFile);
      mockPlugin.app.vault.read.mockResolvedValue(testContent);

      // Execute
      const result = await getContentByPath('test-file#Introduction');

      // Verify
      expect(mockPlugin.app.metadataCache.getFirstLinkpathDest).toHaveBeenCalledWith(
        'test-file',
        ''
      );
      expect(mockPlugin.app.vault.read).toHaveBeenCalledWith(mockFile);

      // The result should contain all content under Introduction including nested sections
      const expectedOutput =
        'This is the introduction.\n\n### Sub-section\n\nThis is a sub-section under Introduction.\n\n#### Deep nested section\n\nThis is deeply nested.'.replace(
          /\n/g,
          '\\n'
        );
      expect(result).toBe(expectedOutput);
    });
  });

  describe('extractContentUnderHeading', () => {
    let extractContentUnderHeading: (content: string, headingText: string) => string;

    beforeEach(() => {
      // Access the private methods using type assertion
      extractContentUnderHeading = (
        userDefinedCommandService as any
      ).extractContentUnderHeading.bind(userDefinedCommandService);
    });

    it('should extract content under heading directly', () => {
      // Test the extractContentUnderHeading method directly
      const testContent = `# Main Title

## Introduction

This is the introduction.

### Sub-section

This is a sub-section.

## Conclusion

This is the conclusion.`;

      // Extract content under the Introduction heading
      const result = extractContentUnderHeading(testContent, 'Introduction');

      // Verify
      expect(result).toBe('This is the introduction.\n\n### Sub-section\n\nThis is a sub-section.');
    });

    it('should return empty string when heading is not found', () => {
      const testContent = `# Main Title

## Introduction

This is the introduction.`;

      const result = extractContentUnderHeading(testContent, 'NonExistentHeading');

      expect(result).toBe('');
    });
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
