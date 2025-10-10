import { ArtifactManagerV2 } from './ArtifactManagerV2';
import type StewardPlugin from 'src/main';
import { App, TFile } from 'obsidian';
import { ConversationRenderer } from 'src/services/ConversationRenderer';
import { NoteContentService } from 'src/services/NoteContentService';

function createMockPlugin(fileContent = ''): jest.Mocked<StewardPlugin> {
  // Create mock file
  const mockFile = new TFile();

  const app = {
    vault: {
      getFileByPath: jest.fn().mockReturnValue(mockFile),
      read: jest.fn().mockResolvedValue(fileContent),
      cachedRead: jest.fn().mockResolvedValue(fileContent),
      modify: jest.fn(),
      process: jest.fn(),
      on: jest.fn().mockReturnValue({ events: [] }),
    },
    metadataCache: {
      getFileCache: jest.fn().mockReturnValue({
        frontmatter: {},
      }),
      getFirstLinkpathDest: jest.fn(),
    },
  } as unknown as App;

  // Create mock plugin structure first
  const mockPlugin = {
    settings: {
      stewardFolder: 'Steward',
    },
    app,
    searchService: {
      documentStore: {
        getDocumentsByIds: jest.fn(),
      },
    },
    registerEvent: jest.fn(),
  } as unknown as jest.Mocked<StewardPlugin>;

  // Initialize services with the mock plugin
  mockPlugin.noteContentService = NoteContentService.getInstance(mockPlugin);
  mockPlugin.conversationRenderer = ConversationRenderer.getInstance(mockPlugin);

  return mockPlugin;
}

describe('ArtifactManagerV2', () => {
  let artifactManager: ArtifactManagerV2;
  let mockPlugin: jest.Mocked<StewardPlugin>;

  describe('getAllArtifacts', () => {
    beforeEach(() => {
      jest.clearAllMocks();
    });

    it('should return an array of artifacts', async () => {
      const mockContent = [
        '<!--STW ID:abc123,ROLE:user-->',
        '>[!stw-user-message] id:abc123',
        '>/ Read content above',
        '',
        '<!--STW ID:def456,ROLE:steward,COMMAND:read,HISTORY:false-->',
        'I will help you with that',
        '',
        '<!--STW ID:mmmm,ROLE:assistant,TYPE:artifact,ARTIFACT_TYPE:read_content,HISTORY:false-->',
        '*Artifact read_content is created*',
        '```stw-artifact',
        '{"artifactType":"read_content","readingResult":{"blocks":[{"startLine":82,"endLine":82,"types":["paragraph"],"content":"testABC"}],"source":"cursor","file":{"path":"Steward/Conversations/Test Conversation.md","name":"Test Conversation.md"},"range":{"from":{"line":82,"ch":0},"to":{"line":82,"ch":7}}},"id":"mmmm"}',
        '```',
        '',
      ].join('\n');

      mockPlugin = createMockPlugin(mockContent);
      artifactManager = ArtifactManagerV2.getInstance(mockPlugin);

      // Get all artifacts
      const artifacts = await artifactManager.withTitle('Test Conversation').getAllArtifacts(true);

      expect(artifacts).toMatchObject([
        {
          id: 'mmmm',
          artifactType: 'read_content',
          readingResult: {
            blocks: [{ startLine: 82, endLine: 82, types: ['paragraph'], content: 'testABC' }],
            source: 'cursor',
            file: {
              path: 'Steward/Conversations/Test Conversation.md',
              name: 'Test Conversation.md',
            },
          },
        },
      ]);
    });

    it('should return an array of search results artifacts', async () => {
      const mockContent = [
        '<!--STW ID:abc123,ROLE:user-->',
        '>[!stw-user-message] id:abc123',
        '>/search #angular',
        '',
        '<!--STW ID:def456,ROLE:steward,COMMAND:search-->',
        '**Steward:** Searching for tags: #angular',
        '',
        'I found 1 result:',
        '',
        '<!--STW ID:3w307,ROLE:assistant,TYPE:artifact,ARTIFACT_TYPE:search_results,HISTORY:false-->',
        '*Artifact search_results is created*',
        '```stw-artifact',
        '[{"i":29,"s":1,"k":["#angular"]}]',
        '```',
        '',
      ].join('\n');

      // Mock document data that should be returned by documentStore.getDocumentsByIds
      const mockDocument = {
        id: 29,
        path: 'test/angular-note.md',
        name: 'angular-note.md',
        content: 'This is a note about Angular development',
        tags: ['#angular', '#javascript'],
      };

      mockPlugin = createMockPlugin(mockContent);

      // Mock the documentStore.getDocumentsByIds method
      const getDocumentsByIdsMock = jest.fn().mockResolvedValue([mockDocument]);
      (mockPlugin.searchService.documentStore.getDocumentsByIds as jest.Mock) =
        getDocumentsByIdsMock;

      artifactManager = ArtifactManagerV2.getInstance(mockPlugin);

      // Get all artifacts
      const artifacts = await artifactManager
        .withTitle('Search Test Conversation')
        .getAllArtifacts(true);

      // Verify that getDocumentsByIds was called with the correct document IDs
      expect(getDocumentsByIdsMock).toHaveBeenCalledWith([29]);

      expect(artifacts).toMatchObject([
        {
          artifactType: 'search_results',
          originalResults: [
            {
              document: mockDocument,
              score: 1,
              keywordsMatched: ['#angular'],
            },
          ],
        },
      ]);
    });

    it('should return an array of generated content artifacts', async () => {
      const mockContent = [
        '<!--STW ID:abc123,ROLE:user-->',
        'Help me create a table of Pokemon',
        '',
        '<!--STW ID:def456,ROLE:steward,COMMAND:generate,HISTORY:false-->',
        'Pokemon table:',
        '',
        '| Name | Type |',
        '|------|------|',
        '| Pikachu | Electric |',
        '| Charizard | Fire |',
        '| Blastoise | Water |',
        '',
        '<!--STW ID:3w307,ROLE:assistant,TYPE:artifact,ARTIFACT_TYPE:generated_content,HISTORY:false-->',
        '*Artifact generated_content is created*',
        '```stw-artifact',
        'messageRef:def456',
        '```',
        '',
      ].join('\n');

      mockPlugin = createMockPlugin(mockContent);

      artifactManager = ArtifactManagerV2.getInstance(mockPlugin);

      const artifacts = await artifactManager
        .withTitle('Generated Content Test Conversation')
        .getAllArtifacts(true);

      expect(artifacts).toMatchObject([
        {
          artifactType: 'generated_content',
          messageId: 'def456',
          content: [
            'Pokemon table:',
            '',
            '| Name | Type |',
            '|------|------|',
            '| Pikachu | Electric |',
            '| Charizard | Fire |',
            '| Blastoise | Water |',
          ].join('\n'),
        },
      ]);
    });
  });
});
