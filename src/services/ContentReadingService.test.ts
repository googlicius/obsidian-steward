import { ContentReadingService } from './ContentReadingService';
import { TFile, EditorPosition } from 'obsidian';
import type StewardPlugin from '../main';

/**
 * Creates a mock plugin with a mock editor using the provided text content
 * @param mockText The text content to use in the mock editor
 * @param cursorPosition Optional cursor position (defaults to line 1, ch 0)
 */
function createMockPlugin(
  mockText: string,
  cursorPosition: EditorPosition = { line: 1, ch: 0 }
): jest.Mocked<StewardPlugin> {
  // Create mock editor
  const mockEditor = {
    lineCount: jest.fn().mockReturnValue(mockText.split('\n').length),
    getLine: jest.fn().mockImplementation(line => mockText.split('\n')[line] || ''),
    getCursor: jest.fn().mockReturnValue(cursorPosition),
    getSelection: jest.fn().mockReturnValue(''),
    getRange: jest.fn().mockImplementation((from, to) => {
      const lines = [];
      for (let i = from.line; i <= to.line; i++) {
        lines.push(mockText.split('\n')[i] || '');
      }
      return lines.join('\n');
    }),
  };

  // Create mock file
  const mockFile = new TFile();

  // Create and return mock plugin with editor
  return {
    editor: mockEditor,
    settings: {
      stewardFolder: 'steward',
    },
    app: {
      workspace: {
        getActiveFile: jest.fn().mockReturnValue(mockFile),
      },
      metadataCache: {
        getFileCache: jest.fn().mockReturnValue(null),
      },
    },
  } as unknown as jest.Mocked<StewardPlugin>;
}

describe('ContentReadingService', () => {
  describe('readContent', () => {
    it('should read the paragraph block below the cursor', async () => {
      // Create mock text content
      const mockText = `# Heading
This is a paragraph
With multiple lines
Of content

- List item 1
- List item 2

\`\`\`typescript
const code = 'block';
console.log(code);
\`\`\`
`;

      // Create mock plugin and service
      const mockPlugin = createMockPlugin(mockText);
      const service = ContentReadingService.getInstance(mockPlugin);

      const result = await service.readContent({
        blocksToRead: 1,
        readType: 'below',
        elementType: 'paragraph',
        noteName: null,
      });

      expect(result).toMatchSnapshot();
    });

    it('should read the list above the cursor', async () => {
      // Create mock text content with lists and paragraphs
      const mockText = `This is the first list
- Item 1
- Item 2

This is the second list
- Item 3
- Item 4


End
`;

      // Create mock plugin and service with cursor at the "End" line
      const mockPlugin = createMockPlugin(mockText, { line: 9, ch: 0 });
      const service = ContentReadingService.getInstance(mockPlugin);

      const result = await service.readContent({
        blocksToRead: 1,
        readType: 'above',
        elementType: 'list',
        noteName: null,
      });

      expect(result).toMatchSnapshot();
    });

    it('should read the list with 2 items above the cursor at non-null input line', async () => {
      // Create mock text content with a list and an input line
      const mockText = `- Item 1
- Item 2

![[Steward/Conversations/General]]

/ Test 123`;

      // Create mock plugin and service with cursor at the "/ Test 123" line
      const mockPlugin = createMockPlugin(mockText, { line: 5, ch: 10 });
      const service = ContentReadingService.getInstance(mockPlugin);

      const result = await service.readContent({
        blocksToRead: 1,
        readType: 'above',
        elementType: null,
        noteName: null,
      });

      expect(result).toMatchSnapshot();
    });

    it('should read all content below the cursor when blocksToRead is -1', async () => {
      // Create mock text content with cursor in the middle
      const mockText = `# Introduction
This is the introduction paragraph.

## Section 1
Content before cursor.

## Section 2
Content after cursor starts here.

- List item 1
- List item 2
- List item 3

## Section 3
Final paragraph with more content.
Multiple lines here.

> A blockquote at the end.`;

      // Create mock plugin and service with cursor positioned at Section 2
      const mockPlugin = createMockPlugin(mockText, { line: 8, ch: 0 });
      const service = ContentReadingService.getInstance(mockPlugin);

      const result = await service.readContent({
        blocksToRead: -1,
        readType: 'below',
        elementType: null,
        noteName: null,
      });

      expect(result).toMatchSnapshot();
    });

    it('should read the code block below the cursor', async () => {
      // Create mock text content with a code block
      const mockText = `Code
 
Should skip this line

\`\`\`js
function greet(name) {
  const greet = 'Greet: ';

  return greet + name;
}
\`\`\`
`;

      // Create mock plugin and service with cursor at the first line
      const mockPlugin = createMockPlugin(mockText, { line: 0, ch: 0 });
      const service = ContentReadingService.getInstance(mockPlugin);

      const result = await service.readContent({
        blocksToRead: 1,
        readType: 'below',
        elementType: 'code',
        noteName: null,
      });

      expect(result).toMatchSnapshot();
    });

    it('should read a list with 2 items separated by an empty line above the cursor', async () => {
      // Create mock text content with a list that has an empty line between items
      const mockText = `Start here

- First item in the list

- Second item in the list

End paragraph`;

      // Create mock plugin and service with cursor at the start
      const mockPlugin = createMockPlugin(mockText, { line: 6, ch: 0 });
      const service = ContentReadingService.getInstance(mockPlugin);

      const result = await service.readContent({
        blocksToRead: 1,
        readType: 'above',
        elementType: 'list',
        noteName: null,
      });

      expect(result).toMatchSnapshot();
    });

    it('should read a list with 2 items separated by an empty line below the cursor', async () => {
      // Create mock text content with a list that has an empty line between items
      const mockText = `Start here

- First item in the list


- Second item in the list

End paragraph`;

      // Create mock plugin and service with cursor at the start
      const mockPlugin = createMockPlugin(mockText, { line: 0, ch: 0 });
      const service = ContentReadingService.getInstance(mockPlugin);

      const result = await service.readContent({
        blocksToRead: 1,
        readType: 'below',
        elementType: 'list',
        noteName: null,
      });

      expect(result).toMatchSnapshot();
    });
  });
});
