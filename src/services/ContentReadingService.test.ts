import {
  ContentReadingService,
  PLAIN_TEXT_READ_INSTRUCTION,
  type ContentReadingResult,
} from './ContentReadingService';
import { TFile, EditorPosition, CachedMetadata, SectionCache } from 'obsidian';
import type StewardPlugin from '../main';
import { getInstance } from 'src/utils/getInstance';

function assertContentReadingResult(
  value: ContentReadingResult | string
): asserts value is ContentReadingResult {
  if (typeof value === 'string') {
    throw new Error('Expected ContentReadingResult, got model hint string');
  }
}

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
  mockFile = getInstance(TFile, { path: '', name: '', extension: 'md' })
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
      vault: {
        cachedRead: jest.fn().mockResolvedValue(mockText),
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
  describe('image path helpers', () => {
    let service: ContentReadingService;
    let buildImageVisionNotice: ContentReadingService['buildImageVisionNotice'];

    beforeEach(() => {
      const mockPlugin = createMockPlugin('', [], { line: 0, ch: 0 });
      service = ContentReadingService.getInstance(mockPlugin);
      buildImageVisionNotice = service['buildImageVisionNotice'].bind(service);
    });

    it('collectImagePathsFromReadingResult includes image file paths and wikilink targets', () => {
      const imageFileResult: ContentReadingResult = {
        blocks: [],
        source: 'entire',
        file: { path: 'assets/image.png', name: 'image.png' },
      };
      expect(service.collectImagePathsFromReadingResult(imageFileResult)).toEqual([
        'assets/image.png',
      ]);

      const wikilinkResult: ContentReadingResult = {
        blocks: [
          {
            startLine: 2,
            endLine: 2,
            sections: [{ type: 'paragraph', startLine: 2, endLine: 2 }],
            content: '![[Pasted image 20250610015617.png]]',
          },
        ],
        source: 'element',
        file: { path: 'note.md', name: 'note.md' },
      };
      expect(service.collectImagePathsFromReadingResult(wikilinkResult)).toEqual([
        'Pasted image 20250610015617.png',
      ]);
    });

    it('buildImageVisionNotice describes the model limitation for the agent', () => {
      expect(buildImageVisionNotice('deepseek-chat')).toContain('deepseek-chat');
      expect(buildImageVisionNotice('deepseek-chat')).toContain('does not support vision');
      expect(buildImageVisionNotice('deepseek-chat')).toContain('spawn_subagent');
      expect(buildImageVisionNotice('deepseek-chat')).toContain('image_vision');
    });

    it('buildImageVisionNotice omits spawn hint when the current sub-agent is image_vision', () => {
      const notice = buildImageVisionNotice('deepseek-chat', 'image_vision');
      expect(notice).toContain('does not support vision');
      expect(notice).not.toContain('spawn_subagent');
      expect(notice).toContain(
        'Either stop and tell the user this model cannot view images, or continue with a non-image approach'
      );
    });

    it('buildImageVisionNotice recommends switch_model when a vision alternative exists', () => {
      const mockPlugin = createMockPlugin('', [], { line: 0, ch: 0 });
      mockPlugin.llmService = {
        supportsVision: jest
          .fn()
          .mockImplementation((model: string) => model === 'google:gemini-2.5-flash'),
      } as never;
      service = ContentReadingService.getInstance(mockPlugin);
      buildImageVisionNotice = service['buildImageVisionNotice'].bind(service);

      const notice = buildImageVisionNotice(
        'deepseek-chat',
        undefined,
        ['deepseek:deepseek-chat', 'google:gemini-2.5-flash'],
        'deepseek:deepseek-chat'
      );

      expect(notice).toContain('switch_model');
      expect(notice).toContain('google:gemini-2.5-flash');
      expect(notice).not.toContain('spawn_subagent');
    });
  });

  describe('readContent - readType above/below/entire', () => {
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
        fileName: 'test.md',
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

    it('returns a shell hint string for hidden (dot) paths before file resolution (vault API never sees them)', async () => {
      const mockPlugin = createMockPlugin('secret', [], { line: 0, ch: 0 });
      const findFile = mockPlugin.mediaTools.findFileByNameOrPath as jest.Mock;
      const service = ContentReadingService.getInstance(mockPlugin);

      const result = await service.readContent({
        blocksToRead: 1,
        readType: 'entire',
        elementType: null,
        fileName: '.config/my-file.md',
      });

      expect(findFile).not.toHaveBeenCalled();
      expect(typeof result).toBe('string');
      expect(result).toContain('.config/my-file.md');
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
        fileName: 'test.md',
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
        fileName: 'test.md',
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
        fileName: 'test.md',
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
        fileName: 'test.md',
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
        fileName: 'test.md',
      });

      const result2 = await service.readContent({
        blocksToRead: -1,
        readType: 'above',
        elementType: 'image',
        fileName: 'test.md',
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

    it('should return file details for binary non-text files', async () => {
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

    it('should read plain text files with 0-based line number prefixes', async () => {
      const mockText = `<div class="widget">
  <span>Hello</span>
</div>`;
      const sections: MockSection[] = [];
      const mockFile = getInstance(TFile, {
        path: 'widgets/index.html',
        name: 'index.html',
        extension: 'html',
      });
      const mockPlugin = createMockPlugin(mockText, sections, undefined, mockFile);
      const service = ContentReadingService.getInstance(mockPlugin);

      const result = await service.readContent({
        blocksToRead: 1,
        readType: 'entire',
        elementType: null,
        fileName: 'widgets/index.html',
      });
      assertContentReadingResult(result);

      expect(result).toMatchObject({
        source: 'entire',
        instruction: PLAIN_TEXT_READ_INSTRUCTION,
        file: {
          path: 'widgets/index.html',
          name: 'index.html',
        },
        blocks: [
          {
            startLine: 0,
            endLine: 2,
            sections: [{ type: 'plain-text', startLine: 0, endLine: 2 }],
            content: `0: <div class="widget">
1:   <span>Hello</span>
2: </div>`,
          },
        ],
      });
    });
  });

  describe('readContent - readType pattern', () => {
    it('should find blocks containing a simple pattern', async () => {
      const mockText = `First paragraph with some text.
      
Second paragraph with keyword here.

Third paragraph without the keyword.`;

      const sections = [
        createSection('paragraph', 0, 0),
        createSection('paragraph', 2, 2),
        createSection('paragraph', 4, 4),
      ];

      const mockPlugin = createMockPlugin(mockText, sections, { line: 0, ch: 0 });
      const service = ContentReadingService.getInstance(mockPlugin);

      const result = await service.readContent({
        blocksToRead: -1,
        readType: 'pattern',
        elementType: null,
        fileName: 'test.md',
        pattern: 'keyword',
      });

      expect(result).toMatchObject({
        blocks: [
          {
            content: 'Second paragraph with keyword here.',
            startLine: 2,
            endLine: 2,
            sections: [{ type: 'paragraph', startLine: 2, endLine: 2 }],
          },
          {
            content: 'Third paragraph without the keyword.',
            startLine: 4,
            endLine: 4,
            sections: [{ type: 'paragraph', startLine: 4, endLine: 4 }],
          },
        ],
        source: 'element',
        file: {
          name: '',
          path: '',
        },
      });
    });

    it('should find blocks with case-insensitive pattern matching', async () => {
      const mockText = `First paragraph with KEYWORD.
      
Second paragraph with Keyword.

Third paragraph with keyword.`;

      const sections = [
        createSection('paragraph', 0, 0),
        createSection('paragraph', 2, 2),
        createSection('paragraph', 4, 4),
      ];

      const mockPlugin = createMockPlugin(mockText, sections, { line: 0, ch: 0 });
      const service = ContentReadingService.getInstance(mockPlugin);

      const result = await service.readContent({
        blocksToRead: -1,
        readType: 'pattern',
        elementType: null,
        fileName: 'test.md',
        pattern: 'keyword',
      });
      assertContentReadingResult(result);

      expect(result.blocks).toHaveLength(3);
      expect(result.blocks[0].content).toBe('First paragraph with KEYWORD.');
      expect(result.blocks[1].content).toBe('Second paragraph with Keyword.');
      expect(result.blocks[2].content).toBe('Third paragraph with keyword.');
    });

    it('should respect blocksToRead limit', async () => {
      const mockText = `First paragraph with keyword.
      
Second paragraph with keyword.

Third paragraph with keyword.`;

      const sections = [
        createSection('paragraph', 0, 0),
        createSection('paragraph', 2, 2),
        createSection('paragraph', 4, 4),
      ];

      const mockPlugin = createMockPlugin(mockText, sections, { line: 0, ch: 0 });
      const service = ContentReadingService.getInstance(mockPlugin);

      const result = await service.readContent({
        blocksToRead: 2,
        readType: 'pattern',
        elementType: null,
        fileName: 'test.md',
        pattern: 'keyword',
      });
      assertContentReadingResult(result);

      expect(result.blocks).toHaveLength(2);
    });

    it('should find YAML field in a code block', async () => {
      const mockText = `Some content before.

\`\`\`yaml
name: John Doe
age: 30
email: john@example.com
status: active
\`\`\`

Some content after.`;

      const sections = [
        createSection('paragraph', 0, 0),
        createSection('code', 2, 7),
        createSection('paragraph', 9, 9),
      ];

      const mockPlugin = createMockPlugin(mockText, sections, { line: 0, ch: 0 });
      const service = ContentReadingService.getInstance(mockPlugin);

      const result = await service.readContent({
        blocksToRead: -1,
        readType: 'pattern',
        elementType: null,
        fileName: 'test.md',
        pattern: 'email:',
      });

      expect(result).toMatchObject({
        blocks: [
          {
            content: `\`\`\`yaml
name: John Doe
age: 30
email: john@example.com
status: active
\`\`\``,
            startLine: 2,
            endLine: 7,
            sections: [{ type: 'code', startLine: 2, endLine: 7 }],
          },
        ],
        source: 'element',
      });
    });

    it('should find YAML field in a paragraph', async () => {
      const mockText = `Some content before.

Here is some YAML-like content:
name: Jane Doe
age: 25
email: jane@example.com
status: inactive

Some content after.`;

      const sections = [
        createSection('paragraph', 0, 0),
        createSection('paragraph', 2, 6),
        createSection('paragraph', 8, 8),
      ];

      const mockPlugin = createMockPlugin(mockText, sections, { line: 0, ch: 0 });
      const service = ContentReadingService.getInstance(mockPlugin);

      const result = await service.readContent({
        blocksToRead: -1,
        readType: 'pattern',
        elementType: null,
        fileName: 'test.md',
        pattern: 'status:\\s*(active|inactive)',
      });

      expect(result).toMatchObject({
        blocks: [
          {
            content: `Here is some YAML-like content:
name: Jane Doe
age: 25
email: jane@example.com
status: inactive`,
            startLine: 2,
            endLine: 6,
            sections: [{ type: 'paragraph', startLine: 2, endLine: 6 }],
          },
        ],
        source: 'element',
      });
    });

    it('should return empty blocks when pattern is not provided', async () => {
      const mockText = `Some content.`;

      const sections = [createSection('paragraph', 0, 0)];

      const mockPlugin = createMockPlugin(mockText, sections, { line: 0, ch: 0 });
      const service = ContentReadingService.getInstance(mockPlugin);

      const result = await service.readContent({
        blocksToRead: -1,
        readType: 'pattern',
        elementType: null,
        fileName: 'test.md',
      });

      expect(result).toMatchObject({
        blocks: [],
        source: 'unknown',
        file: {
          name: '',
          path: '',
        },
      });
    });

    it('should return empty blocks when pattern does not match', async () => {
      const mockText = `Some content without the pattern.`;

      const sections = [createSection('paragraph', 0, 0)];

      const mockPlugin = createMockPlugin(mockText, sections, { line: 0, ch: 0 });
      const service = ContentReadingService.getInstance(mockPlugin);

      const result = await service.readContent({
        blocksToRead: -1,
        readType: 'pattern',
        elementType: null,
        fileName: 'test.md',
        pattern: 'nonexistent',
      });

      expect(result).toMatchObject({
        blocks: [],
        source: 'unknown',
        file: {
          name: '',
          path: '',
        },
      });
    });

    it('should find multiple blocks with pattern across different sections', async () => {
      const mockText = `First paragraph with pattern.

\`\`\`js
// Code block with pattern
const pattern = 'test';
\`\`\`

Third paragraph with pattern again.`;

      const sections = [
        createSection('paragraph', 0, 0),
        createSection('code', 2, 5),
        createSection('paragraph', 7, 7),
      ];

      const mockPlugin = createMockPlugin(mockText, sections, { line: 0, ch: 0 });
      const service = ContentReadingService.getInstance(mockPlugin);

      const result = await service.readContent({
        blocksToRead: -1,
        readType: 'pattern',
        elementType: null,
        fileName: 'test.md',
        pattern: 'pattern',
      });
      assertContentReadingResult(result);

      expect(result.blocks).toHaveLength(3);
      expect(result.blocks[0].content).toBe('First paragraph with pattern.');
      expect(result.blocks[1].content).toContain('pattern');
      expect(result.blocks[2].content).toBe('Third paragraph with pattern again.');
    });
  });

  describe('readContent - readType frontmatter', () => {
    it('should read frontmatter from a file with YAML frontmatter', async () => {
      const mockText = `---
title: My Note
tags: [test, example]
date: 2025-01-15
---

# My Note

Some content here.`;

      const sections = [
        createSection('yaml', 0, 4),
        createSection('heading', 6, 6),
        createSection('paragraph', 8, 8),
      ];

      const mockPlugin = createMockPlugin(mockText, sections, { line: 8, ch: 0 });

      // Override the cache to include frontmatterPosition
      (mockPlugin.app.metadataCache.getFileCache as jest.Mock).mockReturnValue({
        sections: sections as SectionCache[],
        frontmatterPosition: {
          start: { line: 0, col: 0, offset: 0 },
          end: { line: 4, col: 3, offset: 0 },
        },
      });

      const service = ContentReadingService.getInstance(mockPlugin);

      const result = await service.readContent({
        blocksToRead: 1,
        readType: 'frontmatter',
        elementType: null,
        fileName: 'test.md',
      });

      expect(result).toMatchObject({
        blocks: [
          {
            startLine: 0,
            endLine: 4,
            sections: [{ type: 'yaml', startLine: 0, endLine: 4 }],
            content: `title: My Note\ntags: [test, example]\ndate: 2025-01-15`,
          },
        ],
        source: 'frontmatter',
        file: {
          name: '',
          path: '',
        },
      });
    });

    it('should return empty blocks when file has no frontmatter', async () => {
      const mockText = `# No Frontmatter

Just regular content here.`;

      const sections = [createSection('heading', 0, 0), createSection('paragraph', 2, 2)];

      const mockPlugin = createMockPlugin(mockText, sections, { line: 0, ch: 0 });

      // Cache has no frontmatter or frontmatterPosition
      (mockPlugin.app.metadataCache.getFileCache as jest.Mock).mockReturnValue({
        sections: sections as SectionCache[],
      });

      const service = ContentReadingService.getInstance(mockPlugin);

      const result = await service.readContent({
        blocksToRead: 1,
        readType: 'frontmatter',
        elementType: null,
        fileName: 'test.md',
      });

      expect(result).toMatchObject({
        blocks: [],
        source: 'frontmatter',
        file: {
          name: '',
          path: '',
        },
      });
    });

    it('should return empty blocks when cache is null', async () => {
      const mockText = `Some content.`;

      const sections = [createSection('paragraph', 0, 0)];

      const mockPlugin = createMockPlugin(mockText, sections, { line: 0, ch: 0 });

      // Return null cache
      (mockPlugin.app.metadataCache.getFileCache as jest.Mock).mockReturnValue(null);

      const service = ContentReadingService.getInstance(mockPlugin);

      const result = await service.readContent({
        blocksToRead: 1,
        readType: 'frontmatter',
        elementType: null,
        fileName: 'test.md',
      });

      expect(result).toMatchObject({
        blocks: [],
        source: 'frontmatter',
        file: {
          name: '',
          path: '',
        },
      });
    });

    it('should read frontmatter with many properties', async () => {
      const mockText = `---
title: Project Plan
author: Alice
status: draft
priority: high
tags: [planning, q1]
created: 2025-03-01
---

## Overview

Project details here.`;

      const sections = [
        createSection('yaml', 0, 7),
        createSection('heading', 9, 9),
        createSection('paragraph', 11, 11),
      ];

      const mockPlugin = createMockPlugin(mockText, sections, { line: 11, ch: 0 });

      (mockPlugin.app.metadataCache.getFileCache as jest.Mock).mockReturnValue({
        sections: sections as SectionCache[],
        frontmatterPosition: {
          start: { line: 0, col: 0, offset: 0 },
          end: { line: 7, col: 3, offset: 0 },
        },
      });

      const service = ContentReadingService.getInstance(mockPlugin);

      const result = await service.readContent({
        blocksToRead: 1,
        readType: 'frontmatter',
        elementType: null,
        fileName: 'test.md',
      });
      assertContentReadingResult(result);

      expect(result.blocks).toHaveLength(1);
      expect(result).toMatchObject({
        blocks: [
          {
            startLine: 0,
            endLine: 7,
            sections: [{ type: 'yaml', startLine: 0, endLine: 7 }],
            content: `title: Project Plan
author: Alice
status: draft
priority: high
tags: [planning, q1]
created: 2025-03-01`,
          },
        ],
        source: 'frontmatter',
      });
    });

    it('should read frontmatter with empty properties', async () => {
      const mockText = `---
title:
tags:
---

Content.`;

      const sections = [createSection('yaml', 0, 3), createSection('paragraph', 5, 5)];

      const mockPlugin = createMockPlugin(mockText, sections, { line: 5, ch: 0 });

      (mockPlugin.app.metadataCache.getFileCache as jest.Mock).mockReturnValue({
        sections: sections as SectionCache[],
        frontmatterPosition: {
          start: { line: 0, col: 0, offset: 0 },
          end: { line: 3, col: 3, offset: 0 },
        },
      });

      const service = ContentReadingService.getInstance(mockPlugin);

      const result = await service.readContent({
        blocksToRead: 1,
        readType: 'frontmatter',
        elementType: null,
        fileName: 'test.md',
      });

      expect(result).toMatchObject({
        blocks: [
          {
            startLine: 0,
            endLine: 3,
            sections: [{ type: 'yaml', startLine: 0, endLine: 3 }],
            content: `title:\ntags:`,
          },
        ],
        source: 'frontmatter',
      });
    });
  });

  describe('readContent - readType entire pagination', () => {
    function createLongLineContent(lineCount: number): string {
      return Array.from({ length: lineCount }, (_, i) => `line ${i}`).join('\n');
    }

    it('returns full markdown content without truncationNotice when under the line limit', async () => {
      const lineCount = 500;
      const mockText = createLongLineContent(lineCount);
      const sections = [createSection('paragraph', 0, lineCount - 1)];
      const mockFile = getInstance(TFile, {
        path: 'notes/small.md',
        name: 'small.md',
        extension: 'md',
      });
      const mockPlugin = createMockPlugin(mockText, sections, { line: 0, ch: 0 }, mockFile);
      const service = ContentReadingService.getInstance(mockPlugin);

      const result = await service.readContent({
        blocksToRead: 1,
        readType: 'entire',
        elementType: null,
        fileName: 'notes/small.md',
      });
      assertContentReadingResult(result);

      expect(result.truncationNotice).toBeUndefined();
      expect(result.blocks).toHaveLength(1);
      expect(result.blocks[0].startLine).toBe(0);
      expect(result.blocks[0].endLine).toBe(lineCount - 1);
      expect(result.blocks[0].content).toBe(mockText);
    });

    it('truncates markdown entire reads at MAX_READ_ENTIRE_LINES with continuation notice', async () => {
      const lineCount = 1200;
      const mockText = createLongLineContent(lineCount);
      const sections = [createSection('paragraph', 0, lineCount - 1)];
      const mockFile = getInstance(TFile, {
        path: 'notes/large.md',
        name: 'large.md',
        extension: 'md',
      });
      const mockPlugin = createMockPlugin(mockText, sections, { line: 0, ch: 0 }, mockFile);
      const service = ContentReadingService.getInstance(mockPlugin);

      const result = await service.readContent({
        blocksToRead: 1,
        readType: 'entire',
        elementType: null,
        fileName: 'notes/large.md',
        offset: 0,
      });
      assertContentReadingResult(result);

      expect(result.blocks[0].startLine).toBe(0);
      expect(result.blocks[0].endLine).toBe(999);
      expect(result.blocks[0].content.split('\n')).toHaveLength(1000);
      expect(result.truncationNotice).toContain('1200 total');
      expect(result.truncationNotice).toContain('200 line(s) remain');
      expect(result.truncationNotice).toContain('offset 1000');
    });

    it('continues markdown entire reads from offset and reports end of file', async () => {
      const lineCount = 1200;
      const mockText = createLongLineContent(lineCount);
      const sections = [createSection('paragraph', 0, lineCount - 1)];
      const mockFile = getInstance(TFile, {
        path: 'notes/large.md',
        name: 'large.md',
        extension: 'md',
      });
      const mockPlugin = createMockPlugin(mockText, sections, { line: 0, ch: 0 }, mockFile);
      const service = ContentReadingService.getInstance(mockPlugin);

      const result = await service.readContent({
        blocksToRead: 1,
        readType: 'entire',
        elementType: null,
        fileName: 'notes/large.md',
        offset: 1000,
      });
      assertContentReadingResult(result);

      expect(result.blocks[0].startLine).toBe(1000);
      expect(result.blocks[0].endLine).toBe(1199);
      expect(result.blocks[0].content.split('\n')).toHaveLength(200);
      expect(result.truncationNotice).toContain('End of file reached');
    });

    it('clamps sections that span the pagination boundary', async () => {
      const lineCount = 1200;
      const mockText = createLongLineContent(lineCount);
      const sections = [
        createSection('paragraph', 990, 1020),
        createSection('paragraph', 1100, 1150),
      ];
      const mockFile = getInstance(TFile, {
        path: 'notes/large.md',
        name: 'large.md',
        extension: 'md',
      });
      const mockPlugin = createMockPlugin(mockText, sections, { line: 0, ch: 0 }, mockFile);
      const service = ContentReadingService.getInstance(mockPlugin);

      const result = await service.readContent({
        blocksToRead: 1,
        readType: 'entire',
        elementType: null,
        fileName: 'notes/large.md',
        offset: 0,
      });
      assertContentReadingResult(result);

      expect(result.blocks[0].sections).toEqual([
        { type: 'paragraph', startLine: 990, endLine: 999 },
      ]);
    });

    it('clamps section start lines when continuing with offset > 0', async () => {
      const lineCount = 1200;
      const mockText = createLongLineContent(lineCount);
      const sections = [createSection('paragraph', 990, 1020)];
      const mockFile = getInstance(TFile, {
        path: 'notes/large.md',
        name: 'large.md',
        extension: 'md',
      });
      const mockPlugin = createMockPlugin(mockText, sections, { line: 0, ch: 0 }, mockFile);
      const service = ContentReadingService.getInstance(mockPlugin);

      const result = await service.readContent({
        blocksToRead: 1,
        readType: 'entire',
        elementType: null,
        fileName: 'notes/large.md',
        offset: 1000,
      });
      assertContentReadingResult(result);

      expect(result.blocks[0].sections).toEqual([
        { type: 'paragraph', startLine: 1000, endLine: 1020 },
      ]);
    });

    it('uses a fallback entire section when cache has no sections', async () => {
      const lineCount = 1200;
      const mockText = createLongLineContent(lineCount);
      const mockFile = getInstance(TFile, {
        path: 'notes/large.md',
        name: 'large.md',
        extension: 'md',
      });
      const mockPlugin = createMockPlugin(mockText, [], { line: 0, ch: 0 }, mockFile);
      (mockPlugin.app.metadataCache.getFileCache as jest.Mock).mockReturnValue({});
      const service = ContentReadingService.getInstance(mockPlugin);

      const result = await service.readContent({
        blocksToRead: 1,
        readType: 'entire',
        elementType: null,
        fileName: 'notes/large.md',
        offset: 1000,
      });
      assertContentReadingResult(result);

      expect(result.blocks[0].sections).toEqual([
        { type: 'entire', startLine: 1000, endLine: 1199 },
      ]);
    });

    it('returns empty blocks and an out-of-range notice when offset is past EOF', async () => {
      const lineCount = 1200;
      const mockText = createLongLineContent(lineCount);
      const sections = [createSection('paragraph', 0, lineCount - 1)];
      const mockFile = getInstance(TFile, {
        path: 'notes/large.md',
        name: 'large.md',
        extension: 'md',
      });
      const mockPlugin = createMockPlugin(mockText, sections, { line: 0, ch: 0 }, mockFile);
      const service = ContentReadingService.getInstance(mockPlugin);

      const result = await service.readContent({
        blocksToRead: 1,
        readType: 'entire',
        elementType: null,
        fileName: 'notes/large.md',
        offset: 1200,
      });
      assertContentReadingResult(result);

      expect(result.blocks).toEqual([]);
      expect(result.truncationNotice).toContain('Offset 1200 is beyond the end of file');
      expect(result.truncationNotice).toContain('valid offsets 0-1199');
    });

    it('paginates plain-text entire reads with line-number prefixes on continuation pages', async () => {
      const lineCount = 1200;
      const mockText = createLongLineContent(lineCount);
      const mockFile = getInstance(TFile, {
        path: 'widgets/large.html',
        name: 'large.html',
        extension: 'html',
      });
      const mockPlugin = createMockPlugin(mockText, [], { line: 0, ch: 0 }, mockFile);
      const service = ContentReadingService.getInstance(mockPlugin);

      const page1 = await service.readContent({
        blocksToRead: 1,
        readType: 'entire',
        elementType: null,
        fileName: 'widgets/large.html',
        offset: 0,
      });
      assertContentReadingResult(page1);

      expect(page1.instruction).toBe(PLAIN_TEXT_READ_INSTRUCTION);
      expect(page1.truncationNotice).toContain('200 line(s) remain');

      const page2 = await service.readContent({
        blocksToRead: 1,
        readType: 'entire',
        elementType: null,
        fileName: 'widgets/large.html',
        offset: 1000,
      });
      assertContentReadingResult(page2);

      expect(page2.instruction).toBe(PLAIN_TEXT_READ_INSTRUCTION);
      expect(page2.truncationNotice).toContain('End of file reached');
      expect(page2.blocks[0].content.startsWith('1000: line 1000')).toBe(true);
    });
  });

  describe('getFileProperty', () => {
    it('returns a frontmatter property from the metadata cache', () => {
      const mockFile = new TFile();
      mockFile.path = 'Steward/Skills/search/SKILL.md';
      const mockPlugin = {
        app: {
          vault: {
            getFileByPath: jest.fn().mockReturnValue(mockFile),
          },
          metadataCache: {
            getFileCache: jest.fn().mockReturnValue({
              frontmatter: { name: 'search-skill', enabled: true },
            }),
          },
        },
      } as unknown as jest.Mocked<StewardPlugin>;
      const service = ContentReadingService.getInstance(mockPlugin);

      expect(service.getFileProperty<string>(mockFile.path, 'name')).toBe('search-skill');
      expect(service.getFileProperty<boolean>(mockFile.path, 'enabled')).toBe(true);
      expect(service.getFileProperty<string>(mockFile.path, 'missing')).toBeUndefined();
    });

    it('returns undefined when the file is not found', () => {
      const mockPlugin = {
        app: {
          vault: {
            getFileByPath: jest.fn().mockReturnValue(null),
          },
          metadataCache: {
            getFileCache: jest.fn(),
          },
        },
      } as unknown as jest.Mocked<StewardPlugin>;
      const service = ContentReadingService.getInstance(mockPlugin);

      expect(service.getFileProperty<string>('missing.md', 'name')).toBeUndefined();
      expect(mockPlugin.app.metadataCache.getFileCache).not.toHaveBeenCalled();
    });

    it('returns undefined when frontmatter is not cached', () => {
      const mockFile = new TFile();
      mockFile.path = 'Steward/Skills/search/SKILL.md';
      const mockPlugin = {
        app: {
          vault: {
            getFileByPath: jest.fn().mockReturnValue(mockFile),
          },
          metadataCache: {
            getFileCache: jest.fn().mockReturnValue(undefined),
          },
        },
      } as unknown as jest.Mocked<StewardPlugin>;
      const service = ContentReadingService.getInstance(mockPlugin);

      expect(service.getFileProperty<string>(mockFile.path, 'name')).toBeUndefined();
    });
  });
});
