import { ContentReadingService } from './ContentReadingService';
import { TFile, EditorPosition } from 'obsidian';
import type StewardPlugin from '../main';

// Mock StewardPlugin
jest.mock('../main');

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
  });
});
