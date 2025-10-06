import { MarkdownUtil } from 'src/utils/markdownUtils';
import { NoteContentService } from './NoteContentService';
import { App, TFile } from 'obsidian';

// Mock App for testing
const createMockApp = () => {
  const mockApp = {
    metadataCache: {
      getFirstLinkpathDest: jest.fn(),
    },
    vault: {
      read: jest.fn(),
      cachedRead: jest.fn(),
    },
  } as unknown as App;

  return mockApp;
};

describe('NoteContentService', () => {
  let noteContentService: NoteContentService;
  let mockApp: App;
  let mockFile: TFile;

  beforeEach(() => {
    // Create a mock app for testing
    mockApp = createMockApp();

    // Create mock file
    mockFile = new TFile();

    // Create a new instance for each test with the mock app
    noteContentService = NoteContentService.getInstance(mockApp);
  });

  describe('extractImageLinks', () => {
    it('should extract image links', () => {
      const content = `Read content:
["![[Pasted image 20250611021640.png]]"]

Is the image above a lake, pond, reservoir, or sea?`;
      const imageLinks = noteContentService.extractImageLinks(content);
      expect(imageLinks).toEqual(['Pasted image 20250611021640.png']);
    });

    it('should extract image with custom size', () => {
      const content = `![[Image.png|400]]\nDescribe the image`;
      const imageLinks = noteContentService.extractImageLinks(content);
      expect(imageLinks).toEqual(['Image.png']);
    });

    it('should extract the image from a complex text', () => {
      const content = `Read content:\n["Describe this image:\\n![[Pasted image 20250222171626.png|400]]\\n?\\nA Chinese fishing boat [[ram|rammed]] a Japanese [[coastguard patrol]]\\n<!--SR:!2025-08-21,108,250-->"]\n\nRead the text above and tell me what is the image about?`;
      const imageLinks = noteContentService.extractImageLinks(content);
      expect(imageLinks).toEqual(['Pasted image 20250222171626.png']);
    });

    it('should extract images from stw-selected blocks', () => {
      const content = `Here is a selected block with an image:
{{stw-selected from:0,to:4,selection: ${new MarkdownUtil('This contains an image: ![[image2.jpg]] and some text').escape().getText()},path:test.md}}`;
      const imageLinks = noteContentService.extractImageLinks(content);
      expect(imageLinks).toEqual(['image2.jpg']);
    });
  });

  describe('extractWikilinks', () => {
    it('should extract wikilinks and exclude media links', () => {
      const content = `Here is a wikilink [[Note1]] and an embedded link ![[Note2]]. Also, a media file [[Image.png]] should be excluded.`;
      const wikilinks = noteContentService.extractWikilinks(content);
      expect(wikilinks).toEqual(['Note1', 'Note2']);
    });

    it('should extract wikilinks with anchors', () => {
      const content = `Here is a wikilink [[Note1#Anchor1]] and an embedded link ![[Note2#Anchor2]].`;
      const wikilinks = noteContentService.extractWikilinks(content);
      expect(wikilinks).toEqual(['Note1#Anchor1', 'Note2#Anchor2']);
    });
  });

  describe('extractContentUnderHeading', () => {
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
      const result = noteContentService.extractContentUnderHeading(testContent, 'Introduction');

      // Verify
      expect(result).toBe('This is the introduction.\n\n### Sub-section\n\nThis is a sub-section.');
    });

    it('should return empty string when heading is not found', () => {
      const testContent = `# Main Title

## Introduction

This is the introduction.`;

      const result = noteContentService.extractContentUnderHeading(
        testContent,
        'NonExistentHeading'
      );

      expect(result).toBe('');
    });

    it('should handle nested headings correctly', () => {
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

      // Execute
      const result = noteContentService.extractContentUnderHeading(testContent, 'Introduction');

      // The result should contain all content under Introduction including nested sections
      const expectedOutput =
        'This is the introduction.\n\n### Sub-section\n\nThis is a sub-section under Introduction.\n\n#### Deep nested section\n\nThis is deeply nested.';
      expect(result).toBe(expectedOutput);
    });
  });

  describe('getContentByPath', () => {
    it('should get content when there is no anchor', async () => {
      // Setup
      const testContent = 'This is the test content';
      mockApp.metadataCache.getFirstLinkpathDest = jest.fn().mockReturnValue(mockFile);
      mockApp.vault.read = jest.fn().mockResolvedValue(testContent);

      // Execute
      const result = await noteContentService.getContentByPath('test-file');

      // Verify
      expect(mockApp.metadataCache.getFirstLinkpathDest).toHaveBeenCalledWith('test-file', '');
      expect(mockApp.vault.read).toHaveBeenCalledWith(mockFile);
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

      mockApp.metadataCache.getFirstLinkpathDest = jest.fn().mockReturnValue(mockFile);
      mockApp.vault.read = jest.fn().mockResolvedValue(testContent);

      // Execute
      const result = await noteContentService.getContentByPath('test-file#Introduction');

      // Verify
      expect(mockApp.metadataCache.getFirstLinkpathDest).toHaveBeenCalledWith('test-file', '');
      expect(mockApp.vault.read).toHaveBeenCalledWith(mockFile);

      // The result should contain only the content under the Introduction heading
      // and before the Details heading
      const expectedOutput = 'This is the introduction content.\nIt spans multiple lines.';
      expect(result).toBe(expectedOutput);
    });

    it('should get content with alias', async () => {
      // Setup
      const testContent = 'This is the test content';
      mockApp.metadataCache.getFirstLinkpathDest = jest.fn().mockReturnValue(mockFile);
      mockApp.vault.read = jest.fn().mockResolvedValue(testContent);

      // Execute
      const result = await noteContentService.getContentByPath('test-file|Alias');

      // Verify
      expect(mockApp.metadataCache.getFirstLinkpathDest).toHaveBeenCalledWith('test-file', '');
      expect(mockApp.vault.read).toHaveBeenCalledWith(mockFile);
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

      mockApp.metadataCache.getFirstLinkpathDest = jest.fn().mockReturnValue(mockFile);
      mockApp.vault.read = jest.fn().mockResolvedValue(testContent);

      // Execute
      const result = await noteContentService.getContentByPath(
        'test-file#Introduction|Intro Section'
      );

      // Verify
      expect(mockApp.metadataCache.getFirstLinkpathDest).toHaveBeenCalledWith('test-file', '');
      expect(mockApp.vault.read).toHaveBeenCalledWith(mockFile);

      // The result should contain only the content under the Introduction heading
      const expectedOutput = 'This is the introduction content.\nIt spans multiple lines.';
      expect(result).toBe(expectedOutput);
    });

    it('should return null when file is not found', async () => {
      // Setup
      mockApp.metadataCache.getFirstLinkpathDest = jest.fn().mockReturnValue(null);

      // Execute
      const result = await noteContentService.getContentByPath('non-existent-file');

      // Verify
      expect(mockApp.metadataCache.getFirstLinkpathDest).toHaveBeenCalledWith(
        'non-existent-file',
        ''
      );
      expect(result).toBeNull();
    });
  });

  describe('extractCalloutContent', () => {
    it('should extract content from a simple callout', () => {
      const content = `
Some text before the callout

>[!user-message]
>This is a user message
>with multiple lines

Some text after the callout
`;

      const result = noteContentService.extractCalloutContent(content, 'user-message');
      expect(result).toBe('This is a user message\nwith multiple lines');
    });

    it('should extract content from a callout with metadata', () => {
      const content = `
>[!user-message] key:value,another:value
>This is a user message
>with metadata in the header
`;

      const result = noteContentService.extractCalloutContent(content, 'user-message');
      expect(result).toBe('This is a user message\nwith metadata in the header');
    });

    it('should handle callouts with formatted content', () => {
      const content = `
>[!user-message]
>**User:** This is a *formatted* message
>with **bold** and *italic* text
>and \`code\` blocks
`;

      const result = noteContentService.extractCalloutContent(content, 'user-message');
      expect(result).toBe(
        '**User:** This is a *formatted* message\nwith **bold** and *italic* text\nand `code` blocks'
      );
    });

    it('should return null if no matching callout is found', () => {
      const content = `
>[!info]
>This is an info callout, not a user-message
`;

      const result = noteContentService.extractCalloutContent(content, 'user-message');
      expect(result).toBeNull();
    });

    it('should handle callouts at the start of content', () => {
      const content = `>[!user-message]
>This is at the start
>of the content`;

      const result = noteContentService.extractCalloutContent(content, 'user-message');
      expect(result).toBe('This is at the start\nof the content');
    });

    it('should handle callouts at the end of content', () => {
      const content = `Some text before

>[!user-message]
>This is at the end`;

      const result = noteContentService.extractCalloutContent(content, 'user-message');
      expect(result).toBe('This is at the end');
    });

    it('should handle empty callouts', () => {
      const content = `>[!user-message]
>`;

      const result = noteContentService.extractCalloutContent(content, 'user-message');
      expect(result).toBe('');
    });

    it('should handle callouts with code blocks', () => {
      const content = `
>[!user-message]
>Here is some code:
>
>\`\`\`javascript
>function hello() {
>  console.log('Hello world');
>}
>\`\`\`
>
>And some text after the code block
`;

      const result = noteContentService.extractCalloutContent(content, 'user-message');
      expect(result).toBe(
        "Here is some code:\n\n```javascript\nfunction hello() {\n  console.log('Hello world');\n}\n```\n\nAnd some text after the code block"
      );
    });

    it('should handle nested callouts', () => {
      const content = `
>[!user-message]
>This is a user message with a nested callout:
>
>>[!info]
>>This is a nested info callout
>
>And some text after the nested callout
`;

      const result = noteContentService.extractCalloutContent(content, 'user-message');
      expect(result).toBe(
        'This is a user message with a nested callout:\n\n>[!info]\n>This is a nested info callout\n\nAnd some text after the nested callout'
      );
    });

    it('should handle callouts with special characters', () => {
      const content = `
>[!user-message]
>This message has special characters: !@#$%^&*()_+{}|:"<>?~\`-=[]\\;',./
>And emojis: 😀 🚀 💡 🔥
`;

      const result = noteContentService.extractCalloutContent(content, 'user-message');
      expect(result).toBe(
        'This message has special characters: !@#$%^&*()_+{}|:"<>?~`-=[]\\;\',./\nAnd emojis: 😀 🚀 💡 🔥'
      );
    });

    it('should handle case insensitive callout types', () => {
      const content = `
>[!USER-MESSAGE]
>This callout has uppercase type
`;

      const result = noteContentService.extractCalloutContent(content, 'user-message');
      expect(result).toBe('This callout has uppercase type');
    });
  });

  describe('processWikilinksInContent', () => {
    it('should process wikilinks in content with default depth level', async () => {
      // Setup
      const content = 'This is some content with a wikilink [[TestNote]] and more text.';
      const linkedContent = 'Content from the linked note. With [[AnotherNote]]';

      // Mock the app methods
      mockApp.metadataCache.getFirstLinkpathDest = jest.fn().mockReturnValue(mockFile);
      mockApp.vault.cachedRead = jest.fn().mockResolvedValue(linkedContent);

      // Execute
      const result = await noteContentService.processWikilinksInContent(content);

      // Verify
      expect(mockApp.metadataCache.getFirstLinkpathDest).toHaveBeenCalledWith('TestNote', '');
      expect(mockApp.vault.cachedRead).toHaveBeenCalledWith(mockFile);
      expect(result).toBe(`This is some content with a wikilink [[TestNote]] and more text.

The content of [[TestNote]]:
Content from the linked note. With [[AnotherNote]]`);
    });

    it('should process wikilinks in content with a depth level of 2', async () => {
      // Setup
      const content = 'This is some content with a wikilink [[TestNote]] and more text.';
      const testNoteContent = 'Content from the linked note. With [[AnotherNote]].';
      const anotherNoteContent = 'Content from another linked note. With [[YetAnotherNote]].';

      // Mock the app methods
      const mockTestFile = new TFile();
      const mockAnotherFile = new TFile();

      // First call returns TestNote file
      mockApp.metadataCache.getFirstLinkpathDest = jest.fn().mockImplementation(path => {
        if (path === 'TestNote') return mockTestFile;
        if (path === 'AnotherNote') return mockAnotherFile;
        return null;
      });

      // Mock reading different content based on the file
      mockApp.vault.cachedRead = jest.fn().mockImplementation(file => {
        if (file === mockTestFile) return Promise.resolve(testNoteContent);
        if (file === mockAnotherFile) return Promise.resolve(anotherNoteContent);
        return Promise.resolve('');
      });

      // Execute with depth level 2
      const result = await noteContentService.processWikilinksInContent(content, 2);

      // Verify
      expect(mockApp.metadataCache.getFirstLinkpathDest).toHaveBeenCalledWith('TestNote', '');
      expect(mockApp.metadataCache.getFirstLinkpathDest).toHaveBeenCalledWith('AnotherNote', '');
      expect(mockApp.vault.cachedRead).toHaveBeenCalledWith(mockTestFile);
      expect(mockApp.vault.cachedRead).toHaveBeenCalledWith(mockAnotherFile);
      expect(result).toBe(`This is some content with a wikilink [[TestNote]] and more text.

The content of [[TestNote]]:
Content from the linked note. With [[AnotherNote]].

The content of [[AnotherNote]]:
Content from another linked note. With [[YetAnotherNote]].`);
    });

    it('should process content with just a wikilink', async () => {
      // Setup
      const content = '[[TestNote]]';
      const linkedContent = 'Content from the linked note.';

      // Mock the app methods
      mockApp.metadataCache.getFirstLinkpathDest = jest.fn().mockReturnValue(mockFile);
      mockApp.vault.cachedRead = jest.fn().mockResolvedValue(linkedContent);

      // Execute
      const result = await noteContentService.processWikilinksInContent(content);

      // Verify
      expect(mockApp.metadataCache.getFirstLinkpathDest).toHaveBeenCalledWith('TestNote', '');
      expect(mockApp.vault.cachedRead).toHaveBeenCalledWith(mockFile);
      expect(result).toBe('Content from the linked note.');
    });
  });
});
