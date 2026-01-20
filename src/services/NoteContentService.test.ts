import { MarkdownUtil } from 'src/utils/markdownUtils';
import { NoteContentService } from './NoteContentService';
import { TFile } from 'obsidian';
import type StewardPlugin from 'src/main';
import { EditOperation } from 'src/solutions/commands/tools/editContent';

// Mock Plugin for testing
function createMockPlugin(): jest.Mocked<StewardPlugin> {
  return {
    app: {
      metadataCache: {
        getFirstLinkpathDest: jest.fn(),
      },
      vault: {
        read: jest.fn(),
        cachedRead: jest.fn(),
      },
    },
    settings: {
      stewardFolder: 'Steward',
    },
  } as unknown as jest.Mocked<StewardPlugin>;
}

describe('NoteContentService', () => {
  let noteContentService: NoteContentService;
  let mockPlugin: jest.Mocked<StewardPlugin>;
  let mockFile: TFile;

  beforeEach(() => {
    // Create a mock plugin for testing
    mockPlugin = createMockPlugin();

    // Create mock file
    mockFile = new TFile();

    // Create a new instance for each test with the mock plugin
    noteContentService = NoteContentService.getInstance(mockPlugin);
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
      mockPlugin.app.metadataCache.getFirstLinkpathDest = jest.fn().mockReturnValue(mockFile);
      mockPlugin.app.vault.read = jest.fn().mockResolvedValue(testContent);

      // Execute
      const result = await noteContentService.getContentByPath('test-file');

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

      mockPlugin.app.metadataCache.getFirstLinkpathDest = jest.fn().mockReturnValue(mockFile);
      mockPlugin.app.vault.read = jest.fn().mockResolvedValue(testContent);

      // Execute
      const result = await noteContentService.getContentByPath('test-file#Introduction');

      // Verify
      expect(mockPlugin.app.metadataCache.getFirstLinkpathDest).toHaveBeenCalledWith(
        'test-file',
        ''
      );
      expect(mockPlugin.app.vault.read).toHaveBeenCalledWith(mockFile);

      // The result should contain only the content under the Introduction heading
      // and before the Details heading
      const expectedOutput = 'This is the introduction content.\nIt spans multiple lines.';
      expect(result).toBe(expectedOutput);
    });

    it('should get content with alias', async () => {
      // Setup
      const testContent = 'This is the test content';
      mockPlugin.app.metadataCache.getFirstLinkpathDest = jest.fn().mockReturnValue(mockFile);
      mockPlugin.app.vault.read = jest.fn().mockResolvedValue(testContent);

      // Execute
      const result = await noteContentService.getContentByPath('test-file|Alias');

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

      mockPlugin.app.metadataCache.getFirstLinkpathDest = jest.fn().mockReturnValue(mockFile);
      mockPlugin.app.vault.read = jest.fn().mockResolvedValue(testContent);

      // Execute
      const result = await noteContentService.getContentByPath(
        'test-file#Introduction|Intro Section'
      );

      // Verify
      expect(mockPlugin.app.metadataCache.getFirstLinkpathDest).toHaveBeenCalledWith(
        'test-file',
        ''
      );
      expect(mockPlugin.app.vault.read).toHaveBeenCalledWith(mockFile);

      // The result should contain only the content under the Introduction heading
      const expectedOutput = 'This is the introduction content.\nIt spans multiple lines.';
      expect(result).toBe(expectedOutput);
    });

    it('should return null when file is not found', async () => {
      // Setup
      mockPlugin.app.metadataCache.getFirstLinkpathDest = jest.fn().mockReturnValue(null);

      // Execute
      const result = await noteContentService.getContentByPath('non-existent-file');

      // Verify
      expect(mockPlugin.app.metadataCache.getFirstLinkpathDest).toHaveBeenCalledWith(
        'non-existent-file',
        ''
      );
      expect(result).toBeNull();
    });
  });

  describe('formatCallout', () => {
    it('should format content as a callout', () => {
      const content = 'This is some content';
      const result = noteContentService.formatCallout(content, 'stw-search-result');
      expect(result).toBe('>[!stw-search-result]\n>This is some content\n');
    });

    it('should format content with metadata', () => {
      const content = 'This is some content';
      const metadata = { id: '123', path: 'test.md' };
      const result = noteContentService.formatCallout(content, 'stw-search-result', metadata);
      expect(result).toBe('>[!stw-search-result] id:123,path:test.md\n>This is some content\n');
    });

    it('should remove wikilinks to steward conversation folder', () => {
      const content = '![[Steward/Conversations/test-conversation.md]]\nSome content';
      const result = noteContentService.formatCallout(content, 'stw-search-result');
      expect(result).toBe('>[!stw-search-result]\n>Some content\n');
    });

    it('should remove regular wikilinks to steward conversation folder', () => {
      const content = '[[Steward/Conversations/test-conversation.md]]\nSome content';
      const result = noteContentService.formatCallout(content, 'stw-search-result');
      expect(result).toBe('>[!stw-search-result]\n>Some content\n');
    });

    it('should remove multiple conversation wikilinks', () => {
      const content =
        '![[Steward/Conversations/conv1.md]]\nContent 1\n[[Steward/Conversations/conv2.md]]\nContent 2';
      const result = noteContentService.formatCallout(content, 'stw-search-result');
      expect(result).toBe('>[!stw-search-result]\n>Content 1\n>Content 2\n');
    });

    it('should preserve other wikilinks', () => {
      const content =
        '![[Steward/Conversations/conv1.md]]\nSome content\n[[Other/Note.md]]\nMore content';
      const result = noteContentService.formatCallout(content, 'stw-search-result');
      expect(result).toBe(
        '>[!stw-search-result]\n>Some content\n>[[Other/Note.md]]\n>More content\n'
      );
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
      mockPlugin.app.metadataCache.getFirstLinkpathDest = jest.fn().mockReturnValue(mockFile);
      mockPlugin.app.vault.cachedRead = jest.fn().mockResolvedValue(linkedContent);

      // Execute
      const result = await noteContentService.processWikilinksInContent(content);

      // Verify
      expect(mockPlugin.app.metadataCache.getFirstLinkpathDest).toHaveBeenCalledWith(
        'TestNote',
        ''
      );
      expect(mockPlugin.app.vault.cachedRead).toHaveBeenCalledWith(mockFile);
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
      mockPlugin.app.metadataCache.getFirstLinkpathDest = jest.fn().mockImplementation(path => {
        if (path === 'TestNote') return mockTestFile;
        if (path === 'AnotherNote') return mockAnotherFile;
        return null;
      });

      // Mock reading different content based on the file
      mockPlugin.app.vault.cachedRead = jest.fn().mockImplementation(file => {
        if (file === mockTestFile) return Promise.resolve(testNoteContent);
        if (file === mockAnotherFile) return Promise.resolve(anotherNoteContent);
        return Promise.resolve('');
      });

      // Execute with depth level 2
      const result = await noteContentService.processWikilinksInContent(content, 2);

      // Verify
      expect(mockPlugin.app.metadataCache.getFirstLinkpathDest).toHaveBeenCalledWith(
        'TestNote',
        ''
      );
      expect(mockPlugin.app.metadataCache.getFirstLinkpathDest).toHaveBeenCalledWith(
        'AnotherNote',
        ''
      );
      expect(mockPlugin.app.vault.cachedRead).toHaveBeenCalledWith(mockTestFile);
      expect(mockPlugin.app.vault.cachedRead).toHaveBeenCalledWith(mockAnotherFile);
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
      mockPlugin.app.metadataCache.getFirstLinkpathDest = jest.fn().mockReturnValue(mockFile);
      mockPlugin.app.vault.cachedRead = jest.fn().mockResolvedValue(linkedContent);

      // Execute
      const result = await noteContentService.processWikilinksInContent(content);

      // Verify
      expect(mockPlugin.app.metadataCache.getFirstLinkpathDest).toHaveBeenCalledWith(
        'TestNote',
        ''
      );
      expect(mockPlugin.app.vault.cachedRead).toHaveBeenCalledWith(mockFile);
      expect(result).toBe('Content from the linked note.');
    });
  });

  describe('addColumnToTable', () => {
    it('should add a column at the end when no position is specified', () => {
      const table = `|Name|Age|
|---|---|
|Alice|30|
|Bob|25|`;

      const newColumn = `City
---
New York
London`;

      const result = noteContentService.addColumnToTable(table, newColumn);

      expect(result).toBe(`|Name|Age|City|
|---|---|---|
|Alice|30|New York|
|Bob|25|London|`);
    });

    it('should add a column at the beginning when position is 0', () => {
      const table = `| Name | Age |
|------|-----|
| Alice | 30 |
| Bob | 25 |`;

      const newColumn = `ID
---
1
2`;

      const result = noteContentService.addColumnToTable(table, newColumn, 0);

      expect(result).toBe(`|ID| Name | Age |
|---|------|-----|
|1| Alice | 30 |
|2| Bob | 25 |`);
    });

    it('should add a column in the middle when position is specified', () => {
      const table = `| Name | Age |
|------|-----|
| Alice | 30 |
| Bob | 25 |`;

      const newColumn = `City
---
New York
London`;

      const result = noteContentService.addColumnToTable(table, newColumn, 1);

      expect(result).toBe(`| Name |City| Age |
|------|---|-----|
| Alice |New York| 30 |
| Bob |London| 25 |`);
    });

    it('should pad with empty cells if new column has fewer values than rows', () => {
      const table = `| Name | Age |
|------|-----|
| Alice | 30 |
| Bob | 25 |
| Charlie | 35 |`;

      const newColumn = `City
---
NYC`;

      const result = noteContentService.addColumnToTable(table, newColumn);

      expect(result).toBe(`| Name | Age |City|
|------|-----|---|
| Alice | 30 |NYC|
| Bob | 25 ||
| Charlie | 35 ||`);
    });
  });

  describe('deleteColumnFromTable', () => {
    it('should delete the last column when no position is specified', () => {
      const table = `| Name | Age | City |
|------|-----|------|
| Alice | 30 | NYC |
| Bob | 25 | LA |`;

      const result = noteContentService.deleteColumnFromTable(table);

      expect(result).toBe(`| Name | Age |
|------|-----|
| Alice | 30 |
| Bob | 25 |`);
    });

    it('should delete the first column when position is 0', () => {
      const table = `| Name | Age | City |
|------|-----|------|
| Alice | 30 | NYC |
| Bob | 25 | LA |`;

      const result = noteContentService.deleteColumnFromTable(table, 0);

      expect(result).toBe(`| Age | City |
|-----|------|
| 30 | NYC |
| 25 | LA |`);
    });

    it('should delete a middle column when position is specified', () => {
      const table = `| Name | Age | City |
|------|-----|------|
| Alice | 30 | NYC |
| Bob | 25 | LA |`;

      const result = noteContentService.deleteColumnFromTable(table, 1);

      expect(result).toBe(`| Name | City |
|------|------|
| Alice | NYC |
| Bob | LA |`);
    });

    it('should clamp position to 0 if negative position is provided', () => {
      const table = `| Name | Age |
|------|-----|
| Alice | 30 |`;

      const result = noteContentService.deleteColumnFromTable(table, -5);

      expect(result).toBe(`| Age |
|-----|
| 30 |`);
    });

    it('should clamp position to last column if position exceeds column count', () => {
      const table = `| Name | Age |
|------|-----|
| Alice | 30 |`;

      const result = noteContentService.deleteColumnFromTable(table, 100);

      expect(result).toBe(`| Name |
|------|
| Alice |`);
    });
  });

  describe('computeChanges', () => {
    it('should compute changes for replace_by_lines operation', () => {
      const content = 'Line 1\nLine 2\nLine 3\nLine 4';
      const operation: EditOperation = {
        mode: 'replace_by_lines',
        path: 'test.md',
        content: 'New Line 2',
        fromLine: 1,
        toLine: 1,
      };

      const result = noteContentService.computeChanges(content, [operation]);

      expect(result.changes).toHaveLength(1);
      expect(result.changes[0]).toMatchObject({
        startLine: 1,
        endLine: 1,
        originalContent: 'Line 2',
        newContent: 'New Line 2',
        mode: 'replace_by_lines',
      });
      expect(result.modifiedContent).toBe('Line 1\nNew Line 2\nLine 3\nLine 4');
    });

    it('should compute changes for replace_by_lines replacing entire file', () => {
      const content = 'Line 1\nLine 2\nLine 3';
      const operation: EditOperation = {
        mode: 'replace_by_lines',
        path: 'test.md',
        content: 'New Content',
      };

      const result = noteContentService.computeChanges(content, [operation]);

      expect(result.changes).toHaveLength(1);
      expect(result.changes[0]).toMatchObject({
        startLine: 0,
        endLine: 2,
        originalContent: content,
        newContent: 'New Content',
        mode: 'replace_by_lines',
      });
      expect(result.modifiedContent).toBe('New Content');
    });

    it('should compute changes for insert operation at beginning', () => {
      const content = 'Line 1\nLine 2';
      const operation: EditOperation = {
        mode: 'insert',
        path: 'test.md',
        content: 'New Line',
        line: 0,
      };

      const result = noteContentService.computeChanges(content, [operation]);

      expect(result.changes).toHaveLength(1);
      expect(result.changes[0]).toMatchObject({
        startLine: 0,
        endLine: 0,
        originalContent: '',
        newContent: 'New Line',
        mode: 'insert',
      });
      expect(result.modifiedContent).toBe('New Line Line 1\nLine 2');
    });

    it('should compute changes for insert operation in middle', () => {
      const content = 'Line 1\nLine 2\nLine 3';
      const operation: EditOperation = {
        mode: 'insert',
        path: 'test.md',
        content: 'New Line',
        line: 1,
      };

      const result = noteContentService.computeChanges(content, [operation]);

      expect(result.changes).toHaveLength(1);
      expect(result.changes[0]).toMatchObject({
        startLine: 1,
        endLine: 1,
        originalContent: '',
        newContent: 'New Line',
        mode: 'insert',
      });
      expect(result.modifiedContent.split('\n')).toEqual([
        'Line 1',
        'New Line',
        'Line 2',
        'Line 3',
      ]);
    });

    it('should compute changes for insert operation at end', () => {
      const content = 'Line 1\nLine 2';
      const operation: EditOperation = {
        mode: 'insert',
        path: 'test.md',
        content: 'New Line',
        line: 2,
      };

      const result = noteContentService.computeChanges(content, [operation]);

      expect(result.changes).toHaveLength(1);
      expect(result.changes[0]).toMatchObject({
        startLine: 2,
        endLine: 2,
        originalContent: '',
        newContent: 'New Line',
        mode: 'insert',
      });
      expect(result.modifiedContent).toBe('Line 1\nLine 2\nNew Line');
    });

    it('should compute changes for add_table_column operation', () => {
      const content = '| Name | Age |\n|------|-----|\n| Alice | 30 |';
      const operation: EditOperation = {
        mode: 'add_table_column',
        path: 'test.md',
        content: 'Status\n---\nActive',
        fromLine: 0,
        toLine: 2,
        insertAfter: 'Age',
      };

      const result = noteContentService.computeChanges(content, [operation]);

      expect(result.changes).toHaveLength(1);
      expect(result.changes[0]).toMatchObject({
        startLine: 0,
        endLine: 2,
        mode: 'add_table_column',
      });
      expect(result.changes[0].originalContent).toBe(
        '| Name | Age |\n|------|-----|\n| Alice | 30 |'
      );
      expect(result.modifiedContent).toContain('Status');
      expect(result.modifiedContent).toContain('Active');
    });

    it('should compute changes for add_table_column operation with insertBefore', () => {
      const content = '| Name | Age |\n|------|-----|\n| Alice | 30 |';
      const operation: EditOperation = {
        mode: 'add_table_column',
        path: 'test.md',
        content: 'Status\n---\nActive',
        fromLine: 0,
        toLine: 2,
        insertBefore: 'Age',
      };

      const result = noteContentService.computeChanges(content, [operation]);

      expect(result.changes).toHaveLength(1);
      expect(result.changes[0]).toMatchObject({
        startLine: 0,
        endLine: 2,
        mode: 'add_table_column',
      });
      expect(result.modifiedContent).toContain('Status');
      expect(result.modifiedContent).toContain('Active');
      // Status should be before Age
      const lines = result.modifiedContent.split('\n');
      expect(lines[0]).toContain('Status');
      expect(lines[0].indexOf('Status')).toBeLessThan(lines[0].indexOf('Age'));
    });

    it('should compute changes for update_table_column operation', () => {
      const content = '| Name | Age |\n|------|-----|\n| Alice | 30 |';
      const operation: EditOperation = {
        mode: 'update_table_column',
        path: 'test.md',
        content: 'Age\n---\n31',
        fromLine: 0,
        toLine: 2,
        position: 1,
      };

      const result = noteContentService.computeChanges(content, [operation]);

      expect(result.changes).toHaveLength(1);
      expect(result.changes[0]).toMatchObject({
        startLine: 0,
        endLine: 2,
        mode: 'update_table_column',
      });
      expect(result.modifiedContent).toContain('31');
    });

    it('should compute changes for delete_table_column operation', () => {
      const content = '| Name | Age | Status |\n|------|-----|--------|\n| Alice | 30 | Active |';
      const operation: EditOperation = {
        mode: 'delete_table_column',
        path: 'test.md',
        fromLine: 0,
        toLine: 2,
        position: 2,
      };

      const result = noteContentService.computeChanges(content, [operation]);

      expect(result.changes).toHaveLength(1);
      expect(result.changes[0]).toMatchObject({
        startLine: 0,
        endLine: 2,
        mode: 'delete_table_column',
      });
      expect(result.modifiedContent).not.toContain('Status');
      expect(result.modifiedContent).toContain('Name');
      expect(result.modifiedContent).toContain('Age');
    });

    it('should compute changes for replace_by_pattern operation', () => {
      const content = 'Hello world\nHello universe\nHello galaxy';
      const operation: EditOperation = {
        mode: 'replace_by_pattern',
        artifactId: 'test-artifact',
        searchPattern: 'Hello',
        replacement: 'Hi',
      };

      const result = noteContentService.computeChanges(content, [operation]);

      expect(result.changes).toHaveLength(1);
      expect(result.changes[0]).toMatchObject({
        originalContent: 'Hello',
        newContent: 'Hi',
        mode: 'replace_by_pattern',
      });
      expect(result.modifiedContent).toBe('Hi world\nHi universe\nHi galaxy');
    });

    it('should return null change for replace_by_pattern when no matches found', () => {
      const content = 'Hello world';
      const operation: EditOperation = {
        mode: 'replace_by_pattern',
        artifactId: 'test-artifact',
        searchPattern: 'NotFound',
        replacement: 'Replaced',
      };

      const result = noteContentService.computeChanges(content, [operation]);

      expect(result.changes).toHaveLength(0);
      expect(result.modifiedContent).toBe(content);
    });

    it('should compute changes for multiple sequential operations', () => {
      const content = 'Line 1\nLine 2\nLine 3';
      const operations: EditOperation[] = [
        {
          mode: 'replace_by_lines',
          path: 'test.md',
          content: 'Modified Line 2',
          fromLine: 1,
          toLine: 1,
        },
        {
          mode: 'insert',
          path: 'test.md',
          content: 'New Line',
          line: 2,
        },
      ];

      const result = noteContentService.computeChanges(content, operations);

      expect(result.changes).toHaveLength(2);
      expect(result.changes[0].mode).toBe('replace_by_lines');
      expect(result.changes[1].mode).toBe('insert');
      expect(result.modifiedContent).toContain('Modified Line 2');
      expect(result.modifiedContent).toContain('New Line');
    });

    it('should handle invalid line range gracefully', () => {
      const content = 'Line 1\nLine 2';
      const operation: EditOperation = {
        mode: 'replace_by_lines',
        path: 'test.md',
        content: 'New',
        fromLine: 5,
        toLine: 3, // Invalid: fromLine > toLine
      };

      const result = noteContentService.computeChanges(content, [operation]);

      expect(result.changes).toHaveLength(0);
      expect(result.modifiedContent).toBe(content);
    });

    it('should include context before and after for changes', () => {
      const content = 'Line 0\nLine 1\nLine 2\nLine 3\nLine 4';
      const operation: EditOperation = {
        mode: 'replace_by_lines',
        path: 'test.md',
        content: 'Modified Line 2',
        fromLine: 2,
        toLine: 2,
      };

      const result = noteContentService.computeChanges(content, [operation]);

      expect(result.changes[0].contextBefore).toBeDefined();
      expect(result.changes[0].contextAfter).toBeDefined();
    });

    it('should handle table operations with invalid line ranges', () => {
      const content = '| Name | Age |\n|------|-----|\n| Alice | 30 |';
      const operation: EditOperation = {
        mode: 'add_table_column',
        path: 'test.md',
        content: 'Status\n---\nActive',
        fromLine: 10, // Invalid: beyond content length
        toLine: 5, // Invalid: fromLine > toLine
        insertAfter: 'Age',
      };

      const result = noteContentService.computeChanges(content, [operation]);

      expect(result.changes).toHaveLength(0);
      expect(result.modifiedContent).toBe(content);
    });

    it('should handle empty content', () => {
      const content = '';
      const operation: EditOperation = {
        mode: 'insert',
        path: 'test.md',
        content: 'New Line',
        line: 0,
      };

      const result = noteContentService.computeChanges(content, [operation]);

      expect(result.changes).toHaveLength(1);
      expect(result.modifiedContent).toBe('New Line ');
    });
  });
});
