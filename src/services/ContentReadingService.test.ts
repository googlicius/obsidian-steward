import { ContentReadingService } from './ContentReadingService';
import StewardPlugin from '../main';

// Mock StewardPlugin
jest.mock('../main');

/**
 * Creates a mock plugin with a mock editor using the provided text content
 */
function createMockPlugin(mockText: string): jest.Mocked<StewardPlugin> {
  // Create mock editor
  const mockEditor = {
    lineCount: jest.fn().mockReturnValue(mockText.split('\n').length),
    getLine: jest.fn().mockImplementation(line => mockText.split('\n')[line] || ''),
    getCursor: jest.fn().mockReturnValue({ line: 1, ch: 0 }),
  };

  // Create and return mock plugin with editor
  return {
    editor: mockEditor,
    settings: {
      stewardFolder: 'steward',
    },
  } as unknown as jest.Mocked<StewardPlugin>;
}

describe('ContentReadingService', () => {
  describe('findBlockBoundary', () => {
    it('should find paragraph block boundary moving below', () => {
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
      const service = new ContentReadingService(mockPlugin);

      // Access the private method using type assertion
      const findBlockBoundary = (service as any).findBlockBoundary.bind(service);

      const result = findBlockBoundary({
        startingLine: 1,
        direction: 'below',
        initialBlockType: 'paragraph',
        inList: false,
        inCodeBlock: false,
      });

      expect(result).toEqual({
        lineNumber: 3,
        types: new Set(['paragraph']),
        inList: false,
        inCodeBlock: false,
      });
    });

    it('should find paragraph block boundary moving above from last line', () => {
      // Create mock text content with lists and paragraphs
      const mockText = `This is the first list
- Item 1
- Item 2

This is the second list
- Item 3
- Item 4


End
`;

      // Create mock plugin and service
      const mockPlugin = createMockPlugin(mockText);
      const service = new ContentReadingService(mockPlugin);

      // Access the private method using type assertion
      const findBlockBoundary = (service as any).findBlockBoundary.bind(service);

      // The line index of "End" is 9 (0-based), so we start from line 8 (the empty line above "End")
      const result = findBlockBoundary({
        startingLine: 6,
        direction: 'above',
        initialBlockType: 'list',
        inList: true,
        inCodeBlock: false,
      });

      // We expect it to find the empty line above the second list's items (line 4)
      expect(result).toEqual({
        lineNumber: 4,
        types: new Set(['list', 'paragraph']),
        inList: false,
        inCodeBlock: false,
      });
    });
  });
});
