import { ConversationRenderer } from './ConversationRenderer';
import { TFile } from 'obsidian';
import type StewardPlugin from '../main';

// Mock StewardPlugin
jest.mock('../main');

/**
 * Creates a mock plugin for testing the ConversationRenderer
 * @param fileContent Optional content to be returned by vault.read
 * @param frontmatter Optional frontmatter to be returned by metadataCache.getFileCache
 */
function createMockPlugin(
  fileContent = '',
  frontmatter: Record<string, unknown> = {}
): jest.Mocked<StewardPlugin> {
  // Create mock file
  const mockFile = new TFile();

  // Create and return mock plugin
  return {
    settings: {
      stewardFolder: 'Steward',
    },
    app: {
      vault: {
        getFileByPath: jest.fn().mockReturnValue(mockFile),
        read: jest.fn().mockResolvedValue(fileContent),
        cachedRead: jest.fn().mockResolvedValue(fileContent),
        modify: jest.fn(),
      },
      metadataCache: {
        getFileCache: jest.fn().mockReturnValue({
          frontmatter,
        }),
      },
    },
  } as unknown as jest.Mocked<StewardPlugin>;
}

describe('ConversationRenderer', () => {
  let conversationRenderer: ConversationRenderer;

  beforeEach(() => {
    // Create a default mock plugin
    const mockPlugin = createMockPlugin();

    // Initialize the ConversationRenderer with the mock plugin
    conversationRenderer = ConversationRenderer.getInstance(mockPlugin);
  });

  describe('extractConversationHistory', () => {
    it('should extract a simple conversation with one user query and one steward response', async () => {
      // Mock conversation content as a raw string
      const mockContent = [
        '<!--STW ID:abc123,ROLE:user,COMMAND:search-->',
        '##### **User:** /search How to use React hooks',
        '',
        '<!--STW ID:def456,ROLE:steward,COMMAND:search-->',
        "**Steward:** Here's what I found about React hooks:",
        '',
        'React hooks are functions that let you use state and other React features without writing a class.',
      ].join('\n');

      // Create mock plugin with the conversation content
      const mockPlugin = createMockPlugin(mockContent);
      conversationRenderer = ConversationRenderer.getInstance(mockPlugin);

      // Call the method
      const history = await conversationRenderer.extractConversationHistory('test-conversation');

      // Use snapshot testing
      expect(history).toMatchSnapshot();
    });

    it('should extract a conversation with search results', async () => {
      // Mock conversation content with search results as a raw string
      const mockContent = [
        '<!--STW ID:abc123,ROLE:user,COMMAND:search-->',
        '##### **User:** /search #angular',
        '',
        '<!--STW ID:def456,ROLE:steward,COMMAND:search-->',
        '**Steward:** Searching for tags: #angular',
        '',
        'I found 2 results:',
        '',
        '**1.** [[Haiku About Angular.md]]',
        '',
        '**2.** [[Angular poem.md]]',
        '',
        '>[!stw-search-result] line:17,start:25,end:33',
        ">Angular's light, bright. ==#angular==",
        '',
        '<!--STW ID:ghi789,ROLE:system,COMMAND:search-->',
        '**System:** *Artifact search results is created*',
        '',
        '<!--STW ID:ghi789,ROLE:user,COMMAND: -->',
        '##### **User:** How do I use Angular?',
        '',
        '<!--STW ID:jkl012,ROLE:steward,COMMAND:read-->',
        "**Steward:** Angular is a platform for building web applications. Here's how to get started:",
        '',
        '1. Install Node.js and npm',
        '2. Install the Angular CLI: `npm install -g @angular/cli`',
        '3. Create a new project: `ng new my-app`',
        '4. Navigate to the project directory: `cd my-app`',
        '5. Start the development server: `ng serve`',
      ].join('\n');

      // Create mock plugin with the conversation content
      const mockPlugin = createMockPlugin(mockContent);
      conversationRenderer = ConversationRenderer.getInstance(mockPlugin);

      // Call the method
      const history = await conversationRenderer.extractConversationHistory('test-conversation');

      // Use snapshot testing
      expect(history).toMatchSnapshot();
    });

    it('should handle conversation with a message has multiple sections', async () => {
      const mockContent = [
        '<!--STW ID:keon4,ROLE:user,COMMAND: -->',
        '##### **User:** / Read the code block above and update it to not using todos as dependency',
        '',
        '<!--STW ID:88nm8,ROLE:steward,COMMAND:read,HISTORY:false-->',
        "**Steward:** I'll read the code block above to understand how it's using 'todos' as a dependency.",
        '',
        '<!--STW ID:w968m,ROLE:steward-->',
        "I've found 1 code block above.",
        '',
        '<!--STW ID:wqe5m,ROLE:steward-->',
        "I've updated the code to use a functional update with `setTodos`, which removes the need to include `todos` as a dependency in the `useCallback` hook.",
        '',
        '<!--STW ID:j62s2,ROLE:steward-->',
        '>[!stw-search-result]',
        '>',
        '>```typescript',
        '>const handleAddTodo = useCallback(text => {',
        '>  setTodos(prevTodos => {',
        '>    const newTodo = { id: nextId++, text };',
        '>    return [...prevTodos, newTodo];',
        '>  });',
        '>}, []);',
        '>```',
        '',
        '<!--STW ID:b34sn,ROLE:steward-->',
        'Would you like me to apply the changes?',
      ].join('\n');

      // Create mock plugin with the conversation content
      const mockPlugin = createMockPlugin(mockContent);
      conversationRenderer = ConversationRenderer.getInstance(mockPlugin);

      // Call the method
      const history = await conversationRenderer.extractConversationHistory('test-conversation');

      // Use snapshot testing
      expect(history).toMatchSnapshot();
    });

    it('should only include messages from the latest topic', async () => {
      // Mock conversation content with multiple topics
      const mockContent = [
        // First topic about React
        '<!--STW ID:abc123,ROLE:user,COMMAND:search-->',
        '##### **User:** /search React hooks',
        '',
        '<!--STW ID:def456,ROLE:steward,COMMAND:search-->',
        "**Steward:** Here's what I found about React hooks:",
        '',
        'React hooks are functions that let you use state and other React features without writing a class.',
        '',
        '<!--STW ID:ghi789,ROLE:user,COMMAND:confirm-->',
        '##### **User:** Thanks, that was helpful',
        '',
        '<!--STW ID:jkl012,ROLE:steward,COMMAND:thank_you-->',
        "**Steward:** You're welcome! Let me know if you have any other questions about React hooks.",
        '',
        // New topic about Angular (should be included)
        '<!--STW ID:mno345,ROLE:user,COMMAND:search-->',
        '##### **User:** /search Angular components',
        '',
        '<!--STW ID:pqr678,ROLE:steward,COMMAND:search-->',
        "**Steward:** Here's what I found about Angular components:",
        '',
        'Angular components are the building blocks of Angular applications.',
        '',
        '<!--STW ID:stu901,ROLE:user,COMMAND: -->',
        '##### **User:** Can you explain more about component lifecycle?',
        '',
        '<!--STW ID:vwx234,ROLE:steward,COMMAND:read-->',
        '**Steward:** Angular components have several lifecycle hooks:',
        '',
        '1. ngOnInit: Called after the component is initialized',
        '2. ngOnChanges: Called when input properties change',
        '3. ngOnDestroy: Called before the component is destroyed',
      ].join('\n');

      // Create mock plugin with the conversation content
      const mockPlugin = createMockPlugin(mockContent);
      conversationRenderer = ConversationRenderer.getInstance(mockPlugin);

      // Call the method
      const history = await conversationRenderer.extractConversationHistory('test-conversation');

      // Verify that only messages from the Angular topic are included
      expect(history).toMatchSnapshot();
    });
  });

  describe('getConversationProperty', () => {
    it('should get an existing property from frontmatter', async () => {
      // Create mock plugin with frontmatter
      const mockPlugin = createMockPlugin('', { lang: 'fr', model: 'gpt-4' });
      conversationRenderer = ConversationRenderer.getInstance(mockPlugin);

      const result = await conversationRenderer.getConversationProperty(
        'test-conversation',
        'lang'
      );

      expect(result).toBe('fr');
    });

    it('should return undefined for non-existent property', async () => {
      // Create mock plugin with frontmatter that doesn't have the property
      const mockPlugin = createMockPlugin('', { model: 'gpt-4' });
      conversationRenderer = ConversationRenderer.getInstance(mockPlugin);

      const result = await conversationRenderer.getConversationProperty(
        'test-conversation',
        'lang'
      );

      expect(result).toBeUndefined();
    });

    it('should return undefined when no frontmatter exists', async () => {
      // Create mock plugin with empty frontmatter
      const mockPlugin = createMockPlugin('', {});
      conversationRenderer = ConversationRenderer.getInstance(mockPlugin);

      const result = await conversationRenderer.getConversationProperty(
        'test-conversation',
        'lang'
      );

      expect(result).toBeUndefined();
    });

    it('should handle properties with complex values', async () => {
      // Create mock plugin with complex frontmatter
      const mockPlugin = createMockPlugin('', {
        tags: ['note', 'important'],
        date: '2023-05-15',
        model: 'gpt-4',
      });
      conversationRenderer = ConversationRenderer.getInstance(mockPlugin);

      const result = await conversationRenderer.getConversationProperty(
        'test-conversation',
        'tags'
      );

      expect(result).toEqual(['note', 'important']);
    });

    it('should return undefined when file does not exist', async () => {
      // Create mock plugin where getFileByPath returns null
      const mockPlugin = createMockPlugin();
      mockPlugin.app.vault.getFileByPath = jest.fn().mockReturnValue(null);
      conversationRenderer = ConversationRenderer.getInstance(mockPlugin);

      const result = await conversationRenderer.getConversationProperty(
        'non-existent-conversation',
        'lang'
      );

      expect(result).toBeUndefined();
    });
  });

  describe('updateMessageMetadata', () => {
    it('should update the metadata for a message', async () => {
      // Mock conversation content with a message that has metadata
      const mockContent = [
        '<!--STW ID:abc123,ROLE:user,COMMAND:search-->',
        '```stw-user-message',
        '/search React hooks',
        '```',
        '',
        '<!--STW ID:def456,ROLE:steward,COMMAND:search-->',
        "Here's what I found about React hooks:",
        '',
        'React hooks are functions that let you use state and other React features without writing a class.',
      ].join('\n');

      // Create mock plugin with the conversation content
      const mockPlugin = createMockPlugin(mockContent);

      // Spy on the vault.modify method
      const modifySpy = jest.spyOn(mockPlugin.app.vault, 'modify').mockResolvedValue(undefined);

      conversationRenderer = ConversationRenderer.getInstance(mockPlugin);

      // Call the method to update metadata for the steward message
      const result = await conversationRenderer.updateMessageMetadata(
        'test-conversation',
        'def456',
        { ID: 'def456', ROLE: 'steward', COMMAND: 'read', HISTORY: 'false' }
      );

      // Verify the result is true (success)
      expect(result).toBe(true);

      // Verify that vault.modify was called
      expect(modifySpy).toHaveBeenCalledTimes(1);

      // Verify that the content was modified correctly
      const modifiedContent = modifySpy.mock.calls[0][1];
      expect(modifiedContent).toContain(
        '<!--STW ID:def456,ROLE:steward,COMMAND:read,HISTORY:false-->'
      );
      expect(modifiedContent).not.toContain('<!--STW ID:def456,ROLE:steward,COMMAND:search-->');
    });

    it('should return false when the message ID is not found', async () => {
      // Mock conversation content
      const mockContent = [
        '<!--STW ID:abc123,ROLE:user,COMMAND:search-->',
        '##### **User:** /search React hooks',
      ].join('\n');

      // Create mock plugin with the conversation content
      const mockPlugin = createMockPlugin(mockContent);
      conversationRenderer = ConversationRenderer.getInstance(mockPlugin);

      // Call the method with a non-existent message ID
      const result = await conversationRenderer.updateMessageMetadata(
        'test-conversation',
        'non-existent-id',
        { ID: 'non-existent-id', ROLE: 'steward', COMMAND: 'read' }
      );

      // Verify the result is false (failure)
      expect(result).toBe(false);

      // Verify that vault.modify was not called
      expect(mockPlugin.app.vault.modify).not.toHaveBeenCalled();
    });

    it('should return false when the conversation file does not exist', async () => {
      // Create mock plugin where getFileByPath returns null
      const mockPlugin = createMockPlugin();
      mockPlugin.app.vault.getFileByPath = jest.fn().mockReturnValue(null);
      conversationRenderer = ConversationRenderer.getInstance(mockPlugin);

      // Call the method
      const result = await conversationRenderer.updateMessageMetadata(
        'non-existent-conversation',
        'abc123',
        { ID: 'abc123', ROLE: 'user', COMMAND: 'search' }
      );

      // Verify the result is false (failure)
      expect(result).toBe(false);
    });
  });
});
