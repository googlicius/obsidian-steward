import { ContentReadingService } from './ContentReadingService';
import { TFile, EditorPosition, CachedMetadata, SectionCache } from 'obsidian';
import type StewardPlugin from '../main';
import { getInstance } from 'src/utils/getInstance';

/**
 * Section definition for mocking cache.sections
 */
interface MockSection {
  type: string;
  position: {
    start: { line: number; col: number; offset: number };
    end: { line: number; col: number; offset: number };
  };
}

/**
 * Creates a mock plugin with a mock editor using the provided text content
 */
function createMockPlugin(
  mockText: string,
  sections: MockSection[],
  cursorPosition: EditorPosition = { line: 1, ch: 0 },
  mockFile = new TFile()
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

  // Create mock cache with sections
  const mockCache: Partial<CachedMetadata> = {
    sections: sections as SectionCache[],
  };

  // Create and return mock plugin with editor
  return {
    editor: mockEditor,
    mediaTools: {
      findFileByNameOrPath: jest.fn().mockResolvedValue(mockFile),
    },
    settings: {
      stewardFolder: 'steward',
    },
    app: {
      workspace: {
        getActiveFile: jest.fn().mockReturnValue(mockFile),
      },
      metadataCache: {
        getFileCache: jest.fn().mockReturnValue(mockCache),
      },
    },
  } as unknown as jest.Mocked<StewardPlugin>;
}

/**
 * Helper to create a section mock
 */
function createSection(type: string, startLine: number, endLine: number): MockSection {
  return {
    type,
    position: {
      start: { line: startLine, col: 0, offset: 0 },
      end: { line: endLine, col: 0, offset: 0 },
    },
  };
}

describe('ContentReadingService', () => {
  describe('readContent', () => {
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

      const sections = [
        createSection('paragraph', 0, 0),
        createSection('list', 1, 2),
        createSection('paragraph', 4, 4),
        createSection('list', 5, 6),
        createSection('paragraph', 9, 9),
      ];

      // Create mock plugin and service with cursor at the "End" line
      const mockPlugin = createMockPlugin(mockText, sections, { line: 9, ch: 0 });
      const service = ContentReadingService.getInstance(mockPlugin);

      const result = await service.readContent({
        blocksToRead: 1,
        readType: 'above',
        elementType: 'list',
        fileName: null,
        startLine: null,
      });

      expect(result).toMatchObject({
        blocks: [
          {
            content: `This is the second list
- Item 3
- Item 4`,
            endLine: 6,
            startLine: 4,
            sections: [
              { type: 'paragraph', startLine: 4, endLine: 4 },
              { type: 'list', startLine: 5, endLine: 6 },
            ],
          },
        ],
        elementType: 'list',
        range: {
          from: { ch: 0, line: 4 },
          to: { ch: 8, line: 6 },
        },
      });
    });

    it('should read the list with 2 items above the cursor at non-null input line', async () => {
      // Create mock text content with a list and an input line
      const mockText = `- Item 1
- Item 2

![[Steward/Conversations/General]]

/ Test 123`;

      const sections = [
        createSection('list', 0, 1),
        createSection('paragraph', 3, 3),
        createSection('paragraph', 5, 5),
      ];

      // Create mock plugin and service with cursor at the "/ Test 123" line
      const mockPlugin = createMockPlugin(mockText, sections, { line: 5, ch: 10 });
      const service = ContentReadingService.getInstance(mockPlugin);

      const result = await service.readContent({
        blocksToRead: 1,
        readType: 'above',
        elementType: null,
        fileName: null,
        startLine: null,
      });

      expect(result).toMatchObject({
        blocks: [
          {
            content: '- Item 1\n- Item 2',
            endLine: 1,
            startLine: 0,
            sections: [{ type: 'list', startLine: 0, endLine: 1 }],
          },
        ],
        elementType: undefined,
        source: 'cursor',
        file: {
          name: '',
          path: '',
        },
        range: {
          from: { ch: 0, line: 0 },
          to: { ch: 8, line: 1 },
        },
      });
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

      const sections = [
        createSection('heading', 0, 0),
        createSection('paragraph', 1, 1),
        createSection('heading', 3, 3),
        createSection('paragraph', 4, 4),
        createSection('heading', 6, 6),
        createSection('paragraph', 7, 7),
        createSection('list', 9, 11),
        createSection('heading', 13, 13),
        createSection('paragraph', 14, 15),
        createSection('blockquote', 17, 17),
      ];

      // Create mock plugin and service with cursor positioned at Section 2
      const mockPlugin = createMockPlugin(mockText, sections, { line: 8, ch: 0 });
      const service = ContentReadingService.getInstance(mockPlugin);

      const result = await service.readContent({
        blocksToRead: -1,
        readType: 'below',
        elementType: null,
        fileName: null,
        startLine: null,
      });

      expect(result).toMatchObject({
        blocks: [
          {
            content: `- List item 1
- List item 2
- List item 3`,
            endLine: 11,
            startLine: 9,
            sections: [{ type: 'list', startLine: 9, endLine: 11 }],
          },
          {
            content: `## Section 3
Final paragraph with more content.
Multiple lines here.`,
            endLine: 15,
            startLine: 13,
            sections: [
              { type: 'heading', startLine: 13, endLine: 13 },
              { type: 'paragraph', startLine: 14, endLine: 15 },
            ],
          },
          {
            content: '> A blockquote at the end.',
            endLine: 17,
            startLine: 17,
            sections: [{ type: 'blockquote', startLine: 17, endLine: 17 }],
          },
        ],
        elementType: undefined,
        source: 'cursor',
        file: {
          name: '',
          path: '',
        },
        range: {
          from: { ch: 0, line: 9 },
          to: { ch: 26, line: 17 },
        },
      });
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

      const sections = [
        createSection('paragraph', 0, 0),
        createSection('paragraph', 2, 2),
        createSection('code', 4, 10),
      ];

      // Create mock plugin and service with cursor at the first line
      const mockPlugin = createMockPlugin(mockText, sections, { line: 0, ch: 0 });
      const service = ContentReadingService.getInstance(mockPlugin);

      const result = await service.readContent({
        blocksToRead: 1,
        readType: 'below',
        elementType: 'code',
        fileName: null,
        startLine: null,
      });

      expect(result).toMatchObject({
        blocks: [
          {
            content: `\`\`\`js
function greet(name) {
  const greet = 'Greet: ';

  return greet + name;
}
\`\`\``,
            endLine: 10,
            startLine: 4,
            sections: [{ type: 'code', startLine: 4, endLine: 10 }],
          },
        ],
        elementType: 'code',
        source: 'element',
        range: {
          from: { ch: 0, line: 4 },
          to: { ch: 3, line: 10 },
        },
      });
    });

    it('should read a list with 2 items separated by an empty line above the cursor', async () => {
      // Create mock text content with a list that has an empty line between items
      const mockText = `Start here

- First item in the list

- Second item in the list

End paragraph`;

      const sections = [
        createSection('paragraph', 0, 0),
        createSection('list', 2, 4),
        createSection('paragraph', 6, 6),
      ];

      // Create mock plugin and service with cursor at the end paragraph
      const mockPlugin = createMockPlugin(mockText, sections, { line: 6, ch: 0 });
      const service = ContentReadingService.getInstance(mockPlugin);

      const result = await service.readContent({
        blocksToRead: 1,
        readType: 'above',
        elementType: 'list',
        fileName: null,
        startLine: null,
      });

      expect(result).toMatchObject({
        blocks: [
          {
            content: `- First item in the list

- Second item in the list`,
            endLine: 4,
            startLine: 2,
            sections: [{ type: 'list', startLine: 2, endLine: 4 }],
          },
        ],
        elementType: 'list',
        source: 'element',
        file: {
          name: '',
          path: '',
        },
        range: {
          from: { ch: 0, line: 2 },
          to: { ch: 25, line: 4 },
        },
      });
    });

    it('should read the image above the cursor', async () => {
      // Create mock text with an embedded image wikilink above the cursor
      const mockText = `Intro paragraph

![[Pasted image 20250610015617.png]]

End paragraph`;

      const sections = [
        createSection('paragraph', 0, 0),
        createSection('paragraph', 2, 2),
        createSection('paragraph', 4, 4),
      ];

      // Place cursor at the end paragraph (below the image)
      const mockPlugin = createMockPlugin(mockText, sections, { line: 4, ch: 0 });
      const service = ContentReadingService.getInstance(mockPlugin);

      const result = await service.readContent({
        blocksToRead: 1,
        readType: 'above',
        elementType: 'image',
        fileName: null,
        startLine: null,
      });

      const result2 = await service.readContent({
        blocksToRead: -1,
        readType: 'above',
        elementType: 'image',
        fileName: null,
        startLine: null,
      });

      const expected = {
        blocks: [
          {
            content: '![[Pasted image 20250610015617.png]]',
            startLine: 2,
            endLine: 2,
            sections: [{ type: 'paragraph', startLine: 2, endLine: 2 }],
          },
        ],
        elementType: 'image',
        source: 'element',
        file: {
          name: '',
          path: '',
        },
        range: {
          from: { ch: 0, line: 2 },
          to: { ch: 36, line: 2 },
        },
      };

      expect(result2).toMatchObject(expected);

      expect(result).toMatchObject(expected);
    });

    it('should return file details for non-markdown files', async () => {
      const mockText = '';
      const sections: MockSection[] = [];
      const mockFile = getInstance(TFile, {
        path: 'assets/image.png',
        name: 'image.png',
        extension: 'png',
      });
      const mockPlugin = createMockPlugin(mockText, sections, undefined, mockFile);

      const service = ContentReadingService.getInstance(mockPlugin);

      const result = await service.readContent({
        blocksToRead: 1,
        readType: 'entire',
        elementType: null,
        startLine: null,
        fileName: 'image.png',
      });

      expect(result).toEqual({
        blocks: [],
        source: 'entire',
        file: {
          path: 'assets/image.png',
          name: 'image.png',
        },
      });
    });
  });
});
