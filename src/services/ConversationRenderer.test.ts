import { ConversationRenderer } from './ConversationRenderer';
import { App, TFile } from 'obsidian';
import type StewardPlugin from '../main';
import { NoteContentService } from './NoteContentService';
import { UserMessageService } from './UserMessageService';
import { uniqueID } from '../utils/uniqueID';
import { ReadContentArtifactImpl } from '../solutions/artifact/implements';
import { ArtifactType } from '../solutions/artifact/types';
import { ConversationMessage } from '../types/types';

// Mock the uniqueID function
jest.mock('../utils/uniqueID', () => ({
  uniqueID: jest.fn(() => 'mock-id-123'),
}));

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

  const app = {
    vault: {
      getFileByPath: jest.fn().mockReturnValue(mockFile),
      read: jest.fn().mockResolvedValue(fileContent),
      cachedRead: jest.fn().mockResolvedValue(fileContent),
      modify: jest.fn(),
      process: jest.fn(),
    },
    metadataCache: {
      getFileCache: jest.fn().mockReturnValue({
        frontmatter,
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
    get noteContentService() {
      return mockPlugin._noteContentService;
    },
    get userMessageService() {
      return mockPlugin._userMessageService;
    },
    userDefinedCommandService: {
      buildExtendedPrefixes: jest.fn().mockReturnValue(['/ ', '/search', '/image', '/speech']),
    },
    artifactManagerV2: {
      withTitle: jest.fn().mockReturnValue({
        getArtifactById: jest.fn().mockResolvedValue(null),
      }),
    },
  } as unknown as jest.Mocked<StewardPlugin>;

  // Initialize services with the mock plugin
  mockPlugin._noteContentService = NoteContentService.getInstance(mockPlugin);
  mockPlugin._userMessageService = UserMessageService.getInstance(mockPlugin);

  return mockPlugin;
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

    it('should extract a conversation with search results and not include history that is set to false', async () => {
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
        '<!--STW ID:ghi789,ROLE:assistant,COMMAND:search,HISTORY:false-->',
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

    it('should only include the summary message and messages after it', async () => {
      // Mock conversation content with a summary message in between
      const mockContent = [
        // First part of conversation
        '<!--STW ID:abc123,ROLE:user,COMMAND:search-->',
        '>[!stw-user-message]',
        '>/search React hooks',
        '',
        '<!--STW ID:def456,ROLE:steward,COMMAND:search-->',
        "Here's what I found about React hooks. React hooks let you use state and other React features without writing a class.",
        '',
        '<!--STW ID:ghi789,ROLE:user,COMMAND: -->',
        '>[!stw-user-message]',
        '>How do I use useState?',
        '',
        '<!--STW ID:jkl012,ROLE:steward,COMMAND:generate-->',
        'The useState hook lets you add state to functional components. It returns a state value and a function to update it.',
        '',
        // Summary message in the middle
        '<!--STW ID:mno345,ROLE:assistant,COMMAND:summary-->',
        '',
        '```stw-artifact',
        'This conversation discusses React hooks, particularly useState, which allows adding state to functional components.',
        '```',
        '',
        '<!--STW ID:pqr678,ROLE:user,COMMAND: -->',
        '>[!stw-user-message]',
        '>What about useEffect?',
        '',
        '<!--STW ID:stu901,ROLE:steward,COMMAND:generate-->',
        'The useEffect hook lets you perform side effects in function components. It runs after render and after every update by default.',
        '',
        '<!--STW ID:vwx234,ROLE:user,COMMAND: -->',
        '>[!stw-user-message]',
        '>How can I skip effects?',
        '',
        '<!--STW ID:yz456,ROLE:steward,COMMAND:generate-->',
        'You can skip effects by providing a dependency array as the second argument. The effect will only run when values in the array change.',
      ].join('\n');

      // Create mock plugin with the conversation content
      const mockPlugin = createMockPlugin(mockContent);
      conversationRenderer = ConversationRenderer.getInstance(mockPlugin);

      // Call the method
      const history = await conversationRenderer.extractConversationHistory('test-conversation');

      // Verify
      expect(history).toMatchSnapshot();
    });

    it('should extract conversation with summary in the second position', async () => {
      // Mock conversation with multiple summary messages
      const mockContent = [
        // First topic
        '<!--STW ID:abc123,ROLE:user,COMMAND: -->',
        '>[!stw-user-message]',
        '>/ React hooks',
        '',
        '<!--STW ID:def456,ROLE:steward,COMMAND:generate-->',
        "Here's what I found about React hooks",
        '',
        // First summary message (should be included)
        '<!--STW ID:sum001,ROLE:assistant,COMMAND:summary-->',
        '```stw-artifact',
        'First summary about React hooks',
        '```',
        '',
        // Second topic
        '<!--STW ID:ghi789,ROLE:user,COMMAND: -->',
        '>[!stw-user-message]',
        '>/ useState hook',
        '',
        '<!--STW ID:jkl012,ROLE:steward,COMMAND:generate-->',
        'useState is a React Hook that lets you add state to functional components',
        '',
        // Second summary message (should be ignored)
        '<!--STW ID:sum002,ROLE:system,COMMAND:summary-->',
        '```stw-artifact',
        'Second summary about useState hook',
        '```',
        '',
        // Third topic
        '<!--STW ID:mno345,ROLE:user,COMMAND: -->',
        '>[!stw-user-message]',
        '>/ useEffect hook',
        '',
        '<!--STW ID:pqr678,ROLE:steward,COMMAND:generate-->',
        'useEffect is a React Hook that lets you synchronize a component with an external system',
      ].join('\n');

      // Create mock plugin with the conversation content
      const mockPlugin = createMockPlugin(mockContent);
      conversationRenderer = ConversationRenderer.getInstance(mockPlugin);

      // Call the method with summaryPosition = 1 to get the second summary
      const history = await conversationRenderer.extractConversationHistory('test-conversation', {
        summaryPosition: 1,
      });

      // Verify that only messages after the second summary are included
      expect(history).toMatchSnapshot();
    });

    it('should remove the last user message', async () => {
      const mockContent = [
        '<!--STW ID:abc123,ROLE:user,COMMAND: -->',
        '>[!stw-user-message]',
        '>/ React hooks',
        '',
        '<!--STW ID:def456,ROLE:steward,COMMAND:generate-->',
        'React hooks are functions.',
        '',
        '<!--STW ID:ghi789,ROLE:user,COMMAND: -->',
        '>[!stw-user-message]',
        '>/ How do I use useState?',
      ].join('\n');

      const mockPlugin = createMockPlugin(mockContent);
      conversationRenderer = ConversationRenderer.getInstance(mockPlugin);

      const history = await conversationRenderer.extractConversationHistory('test-conversation');

      expect(history).toMatchSnapshot();
    });

    it('should extract conversation with tool invocations message', async () => {
      // Mock conversation content with tool invocations
      const mockContent = [
        '<!--STW ID:abc123,ROLE:user,COMMAND:search-->',
        '/search React hooks',
        '',
        '<!--STW ID:def456,ROLE:steward,COMMAND:search-->',
        "I'll search for information about React hooks.",
        '',
        '<!--STW ID:ghi789,ROLE:steward,COMMAND:search,TYPE:tool-invocation-->',
        " Here's what I found:",
        '',
        '```stw-artifact',
        JSON.stringify([
          {
            toolName: 'read',
            toolCallId: 'call_456',
            type: 'tool-call',
            input: { query: 'React Hooks' },
            output: {
              type: 'text',
              value: 'I found 1 result',
            },
          },
        ]),
        '```',
        '',
      ].join('\n');

      // Create mock plugin with the conversation content
      const mockPlugin = createMockPlugin(mockContent);
      conversationRenderer = ConversationRenderer.getInstance(mockPlugin);

      // Call the method
      const history = await conversationRenderer.extractConversationHistory('test-conversation');

      // Use snapshot testing
      expect(history).toMatchSnapshot();
    });

    it('should group reasoning content in the same assistant message as the tool invocation', async () => {
      // Mock conversation content with reasoning and tool invocation sharing same handlerId/step
      const mockContent = [
        '<!--STW ID:abc123,ROLE:user,COMMAND:super-->',
        '>[!stw-user-message]',
        '>/ Help me with React',
        '',
        '<!--STW ID:def456,ROLE:steward,COMMAND:super,TYPE:reasoning,HANDLER_ID:handler1,STEP:1-->',
        '```stw-thinking',
        'Let me think about this request...',
        '```',
        '',
        '<!--STW ID:ghi789,ROLE:steward,COMMAND:super,TYPE:tool-invocation,HANDLER_ID:handler1,STEP:1-->',
        '*Searching...*',
        '',
        '```stw-artifact',
        JSON.stringify([
          {
            toolName: 'search',
            toolCallId: 'call_123',
            type: 'tool-call',
            input: { query: 'React' },
            output: { type: 'text', value: 'Found results' },
          },
        ]),
        '```',
        '',
      ].join('\n');

      const mockPlugin = createMockPlugin(mockContent);
      conversationRenderer = ConversationRenderer.getInstance(mockPlugin);

      const history = await conversationRenderer.extractConversationHistory('test-conversation');

      expect(history).toMatchSnapshot();
    });

    it('should group messages by step', async () => {
      // Mock conversation with multiple messages in the same step
      const mockContent = [
        '<!--STW ID:abc123,ROLE:user,COMMAND:super-->',
        '>[!stw-user-message]',
        '>/ Do multiple things',
        '',
        // First step - text message
        '<!--STW ID:msg1,ROLE:steward,COMMAND:super,HANDLER_ID:handler1,STEP:1-->',
        'Starting the first step...',
        '',
        // Same step - another text message
        '<!--STW ID:msg2,ROLE:steward,COMMAND:super,HANDLER_ID:handler1,STEP:1-->',
        'Continuing the first step...',
        '',
        // Second step - different step number
        '<!--STW ID:msg3,ROLE:steward,COMMAND:super,HANDLER_ID:handler1,STEP:2-->',
        'Now on step 2',
        '',
        // Same second step
        '<!--STW ID:msg4,ROLE:steward,COMMAND:super,HANDLER_ID:handler1,STEP:2-->',
        'Still on step 2',
        '',
      ].join('\n');

      const mockPlugin = createMockPlugin(mockContent);
      conversationRenderer = ConversationRenderer.getInstance(mockPlugin);

      const history = await conversationRenderer.extractConversationHistory('test-conversation');

      expect(history).toMatchSnapshot();
    });

    it('should include reasoning for all steps in the last turn', async () => {
      const mockContent = [
        '<!--STW ID:ab9f7,ROLE:user-->',
        '>[!stw-user-message]',
        '>/ Do one more thing',
        '',
        '<!--STW ID:reasoning1,ROLE:steward,TYPE:reasoning,HANDLER_ID:handler1,STEP:1-->',
        '```stw-thinking',
        'Reasoning for turn 1 step 1',
        '```',
        '',
        '<!--STW ID:cd2e1,ROLE:steward,HANDLER_ID:handler1,STEP:1-->',
        'Turn 1.1',
        '',
        '<!--STW ID:ef83c,ROLE:user-->',
        '>[!stw-user-message]',
        '>/ Do multiple things',
        '',
        '<!--STW ID:reasoning2,ROLE:steward,TYPE:reasoning,HANDLER_ID:handler2,STEP:1-->',
        '```stw-thinking',
        'Reasoning for turn 2 step 1',
        '```',
        '',
        '<!--STW ID:de472,ROLE:steward,HANDLER_ID:handler2,STEP:1-->',
        'Turn 2.1',
        '',
        '<!--STW ID:reasoning3,ROLE:steward,TYPE:reasoning,HANDLER_ID:handler2,STEP:2-->',
        '```stw-thinking',
        'Reasoning for turn 2 step 2',
        '```',
        '',
        '<!--STW ID:f13d9,ROLE:steward,HANDLER_ID:handler2,STEP:2-->',
        'Turn 2.2',
        '',
        '<!--STW ID:reasoning4,ROLE:steward,TYPE:reasoning,HANDLER_ID:handler2,STEP:3-->',
        '```stw-thinking',
        'Reasoning for turn 2 step 3',
        '```',
        '',
        '<!--STW ID:bb901,ROLE:steward,HANDLER_ID:handler2,STEP:3-->',
        'Turn 2.3',
        '',
      ].join('\n');

      const mockPlugin = createMockPlugin(mockContent);
      conversationRenderer = ConversationRenderer.getInstance(mockPlugin);

      const history = await conversationRenderer.extractConversationHistory('test-conversation');

      expect(history).toMatchSnapshot();
    });

    it('should include path+image from the tool invocation as a user message', async () => {
      // Mock conversation with tool invocation that has image paths and the artifact
      const mockContent = [
        '<!--STW ID:abc123,ROLE:user,COMMAND:super-->',
        '>[!stw-user-message]',
        '>/ Read this image',
        '',
        // Artifact message in the conversation
        '<!--STW ID:artifact123,ROLE:assistant,TYPE:artifact,ARTIFACT_TYPE:read_content,HISTORY:false-->',
        '*Artifact read_content is created*',
        '```stw-artifact',
        JSON.stringify({
          artifactType: 'read_content',
          id: 'artifact123',
          readingResult: {
            blocks: [{ content: 'Some content with image ![[image.png]]' }],
            file: { path: 'notes/test.md' },
          },
        }),
        '```',
        '',
        '<!--STW ID:def456,ROLE:steward,COMMAND:super,TYPE:tool-invocation,HANDLER_ID:handler1,STEP:1-->',
        '*Reading content...*',
        '',
        '```stw-artifact',
        JSON.stringify([
          {
            toolName: 'read_content',
            toolCallId: 'call_789',
            type: 'tool-call',
            input: { source: 'selection' },
            output: { type: 'text', value: 'artifactRef:artifact123' },
          },
        ]),
        '```',
        '',
      ].join('\n');

      // Create mock plugin
      const mockPlugin = createMockPlugin(mockContent);

      // Create a proper ReadContentArtifactImpl instance with imagePaths
      const mockArtifact = new ReadContentArtifactImpl({
        artifactType: ArtifactType.READ_CONTENT,
        id: 'artifact123',
        readingResult: {
          source: 'cursor',
          blocks: [
            {
              startLine: 1,
              endLine: 1,
              sections: [],
              content: 'Some content with image ![[image.png]]',
            },
          ],
          file: { path: 'notes/test.md', name: 'test.md' },
        },
        imagePaths: ['path/to/image.png'],
      });

      // Mock the artifact manager to return the ReadContentArtifactImpl instance
      Object.defineProperty(mockPlugin, 'artifactManagerV2', {
        value: {
          withTitle: jest.fn().mockReturnValue({
            getArtifactById: jest.fn().mockResolvedValue(mockArtifact),
          }),
        },
        writable: true,
      });

      // Mock userMessageService.getImagePartsFromPaths
      mockPlugin.userMessageService.getImagePartsFromPaths = jest
        .fn()
        .mockResolvedValue([
          ['path/to/image.png', { type: 'image', image: 'base64data', mediaType: 'image/png' }],
        ]);

      conversationRenderer = ConversationRenderer.getInstance(mockPlugin);

      const history = await conversationRenderer.extractConversationHistory('test-conversation');

      expect(history).toMatchSnapshot();
    });

    it('should resolve the tool-invocation output as a message reference', async () => {});
  });

  describe('extractAllConversationMessages', () => {
    it('should remove the stw-hidden-from-user code block for user messages', async () => {
      // Mock conversation content with user message in stw-hidden-from-user code block
      const mockContent = [
        '<!--STW ID:abc123,ROLE:user,COMMAND:search-->',
        '```stw-hidden-from-user',
        '/search How to use React hooks',
        '```',
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
      const messages =
        await conversationRenderer.extractAllConversationMessages('test-conversation');

      // Verify that the user message content is extracted without the code block wrapper
      const userMessage = messages.find(msg => msg.role === 'user');
      expect(userMessage).toBeDefined();
      expect(userMessage?.content).toBe('/search How to use React hooks');
    });

    it('should unescape backticks when extracting content from stw-hidden-from-user code block', async () => {
      // Mock conversation content with user message containing escaped backticks (as they would be stored)
      const mockContent = [
        '<!--STW ID:abc123,ROLE:user,COMMAND:generate-->',
        '```stw-hidden-from-user',
        'Use \\`useState\\` and \\`useEffect\\` hooks',
        '```',
        '',
        '<!--STW ID:def456,ROLE:steward,COMMAND:generate-->',
        "**Steward:** Here's how to use React hooks:",
      ].join('\n');

      // Create mock plugin with the conversation content
      const mockPlugin = createMockPlugin(mockContent);
      conversationRenderer = ConversationRenderer.getInstance(mockPlugin);

      // Call the method
      const messages =
        await conversationRenderer.extractAllConversationMessages('test-conversation');

      // Verify that escaped backticks are properly unescaped
      const userMessage = messages.find(msg => msg.role === 'user');
      expect(userMessage).toBeDefined();
      expect(userMessage?.content).toBe('Use `useState` and `useEffect` hooks');
    });
  });

  describe('addUserMessage', () => {
    it('should add a user message to the conversation note with contentFormat default (callout)', async () => {
      // Mock initial conversation content
      const mockContent = [
        '<!--STW ID:abc123,ROLE:steward,COMMAND:search-->',
        "**Steward:** Here's what I found:",
        '',
        'React hooks are functions that let you use state.',
      ].join('\n');

      // Create mock plugin with the conversation content
      const mockPlugin = createMockPlugin(mockContent);
      conversationRenderer = ConversationRenderer.getInstance(mockPlugin);

      // Spy on the vault.process method
      let processedContent = '';
      const processSpy = jest
        .spyOn(mockPlugin.app.vault, 'process')
        .mockImplementation(async (file, processor) => {
          processedContent = processor(mockContent);
          return processedContent;
        });

      // Call the method with default format (callout)
      const messageId = await conversationRenderer.addUserMessage({
        path: 'test-conversation',
        newContent: '/search How to use React hooks',
      });

      // Verify that vault.process was called
      expect(processSpy).toHaveBeenCalledTimes(1);

      // Verify that messageId is returned
      expect(messageId).toBeDefined();

      // Verify the processed content
      expect(processedContent).toMatchSnapshot();
    });

    it('should add a user message to the conversation note with contentFormat hidden', async () => {
      // Mock initial conversation content
      const mockContent = [
        '<!--STW ID:abc123,ROLE:steward,COMMAND:search-->',
        "**Steward:** Here's what I found:",
        '',
        'React hooks are functions that let you use state.',
      ].join('\n');

      // Create mock plugin with the conversation content
      const mockPlugin = createMockPlugin(mockContent);
      conversationRenderer = ConversationRenderer.getInstance(mockPlugin);

      // Spy on the vault.process method
      let processedContent = '';
      const processSpy = jest
        .spyOn(mockPlugin.app.vault, 'process')
        .mockImplementation(async (file, processor) => {
          processedContent = processor(mockContent);
          return processedContent;
        });

      // Call the method with hidden format
      const messageId = await conversationRenderer.addUserMessage({
        path: 'test-conversation',
        newContent: '/search How to use React hooks',
        contentFormat: 'hidden',
      });

      // Verify that vault.process was called
      expect(processSpy).toHaveBeenCalledTimes(1);

      // Verify that messageId is returned
      expect(messageId).toBeDefined();

      // Verify the processed content contains the hidden code block
      expect(processedContent).toMatchSnapshot();
    });

    it('should preserve the loading indicator when contentFormat is hidden', async () => {
      // Mock initial conversation content with a loading indicator
      const mockContent = [
        '<!--STW ID:abc123,ROLE:steward,COMMAND:search-->',
        "**Steward:** Here's what I found:",
        '',
        '*Generating...*',
      ].join('\n');

      // Create mock plugin with the conversation content
      const mockPlugin = createMockPlugin(mockContent);
      conversationRenderer = ConversationRenderer.getInstance(mockPlugin);

      // Spy on the vault.process method
      let processedContent = '';
      const processSpy = jest
        .spyOn(mockPlugin.app.vault, 'process')
        .mockImplementation(async (file, processor) => {
          processedContent = processor(mockContent);
          return processedContent;
        });

      // Call the method with hidden format
      const messageId = await conversationRenderer.addUserMessage({
        path: 'test-conversation',
        newContent: '/search How to use React hooks',
        contentFormat: 'hidden',
      });

      // Verify that vault.process was called
      expect(processSpy).toHaveBeenCalledTimes(1);

      // Verify that messageId is returned
      expect(messageId).toBeDefined();
      expect(processedContent).toMatchSnapshot();
    });

    it('should store the selected model in the frontmatter if it is found in the new content', async () => {
      // Mock initial conversation content
      const mockContent = [
        '<!--STW ID:abc123,ROLE:steward,COMMAND:search-->',
        "**Steward:** Here's what I found:",
        '',
        'React hooks are functions that let you use state.',
      ].join('\n');

      // Create mock plugin with the conversation content
      const mockPlugin = createMockPlugin(mockContent);

      // Add fileManager mock to the app
      const processFrontMatterSpy = jest.fn().mockResolvedValue(undefined);
      mockPlugin.app.fileManager = {
        processFrontMatter: processFrontMatterSpy,
      } as unknown as typeof mockPlugin.app.fileManager;

      conversationRenderer = ConversationRenderer.getInstance(mockPlugin);

      // Spy on the vault.process method
      let processedContent = '';
      const processSpy = jest
        .spyOn(mockPlugin.app.vault, 'process')
        .mockImplementation(async (file, processor) => {
          processedContent = processor(mockContent);
          return processedContent;
        });

      // Call the method with content containing a selected model
      const messageId = await conversationRenderer.addUserMessage({
        path: 'test-conversation',
        newContent: '/ask m:openai:gpt-4 How to use React hooks',
      });

      // Verify that vault.process was called
      expect(processSpy).toHaveBeenCalledTimes(1);

      // Verify that messageId is returned
      expect(messageId).toBeDefined();

      // Verify that processFrontMatter was called with the correct model
      expect(processFrontMatterSpy).toHaveBeenCalledTimes(1);
      expect(processFrontMatterSpy).toHaveBeenCalledWith(expect.any(TFile), expect.any(Function));

      // Verify that the frontmatter update function sets the model correctly
      const frontmatter: Record<string, unknown> = {};
      const callback = processFrontMatterSpy.mock.calls[0][1];
      callback(frontmatter);
      expect(frontmatter.model).toBe('openai:gpt-4');
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

      let modifiedContent = '';

      // Spy on the vault.process method and simulate it calling the callback
      const processSpy = jest
        .spyOn(mockPlugin.app.vault, 'process')
        .mockImplementation(async (file, callback) => {
          modifiedContent = callback(mockContent);
          return Promise.resolve(modifiedContent);
        });

      conversationRenderer = ConversationRenderer.getInstance(mockPlugin);

      // Call the method to update metadata for the steward message
      const result = await conversationRenderer.updateMessageMetadata(
        'test-conversation',
        'def456',
        { ID: 'def456', ROLE: 'steward', COMMAND: 'read', HISTORY: 'false' }
      );

      // Verify the result is true (success)
      expect(result).toBe(true);

      // Verify that vault.process was called
      expect(processSpy).toHaveBeenCalledTimes(1);

      // Verify that the content was modified correctly
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

  describe('updateConversationNote', () => {
    // Mock conversation content with multiple messages
    const mockContent = [
      '<!--STW ID:abc123,ROLE:user,COMMAND:search-->',
      '>[!stw-user-message] id:abc123',
      '>/ React hooks',
      '',
      '<!--STW ID:def456,ROLE:steward,COMMAND:search-->',
      'React hooks are functions that let you use state and other React features without writing a class.',
      '',
      '<!--STW ID:mmmm,ROLE:system,COMMAND:summary-->',
      '<summaryPlaceholder>',
      '',
      '<!--STW ID:ghi789,ROLE:user,COMMAND: -->',
      '>[!stw-user-message] id:ghi789',
      '>/ How do I use useState?',
      '',
      '<!--STW ID:jkl012,ROLE:steward,COMMAND:read-->',
      'useState is a React Hook that lets you add state to functional components.',
    ].join('\n');

    it('should replace a specific message when replacePlaceHolder is provided', async () => {
      // Create mock plugin with the conversation content
      const mockPlugin = createMockPlugin(mockContent);
      conversationRenderer = ConversationRenderer.getInstance(mockPlugin);

      // Spy on the vault.process method
      const processSpy = jest
        .spyOn(mockPlugin.app.vault, 'process')
        .mockImplementation(async (file, processor) => {
          const result = processor(mockContent);
          return result;
        });

      // Call the method to replace the steward message with ID 'def456'
      await conversationRenderer.updateConversationNote({
        path: 'test-conversation',
        newContent: 'Summarized content',
        replacePlaceHolder: '<summaryPlaceholder>',
      });

      // Verify that vault.process was called
      expect(processSpy).toHaveBeenCalledTimes(1);

      // Get the processed content from the mock
      const processCall = processSpy.mock.calls[0];
      const processor = processCall[1];
      const processedContent = processor(mockContent);

      // Verify that only the target message was removed, others remain
      expect(processedContent).toMatchSnapshot();
    });

    it('should replace a specific message when replacePlaceHolder is provided and artifactContent is provided', async () => {
      // Create mock plugin with the conversation content
      const mockPlugin = createMockPlugin(mockContent);
      conversationRenderer = ConversationRenderer.getInstance(mockPlugin);

      // Spy on the vault.process method
      const processSpy = jest
        .spyOn(mockPlugin.app.vault, 'process')
        .mockImplementation(async (file, processor) => {
          const result = processor(mockContent);
          return result;
        });

      // Call the method to replace the steward message with ID 'def456'
      await conversationRenderer.updateConversationNote({
        path: 'test-conversation',
        newContent: '',
        artifactContent: 'Summarized content',
        replacePlaceHolder: '<summaryPlaceholder>',
      });

      // Verify that vault.process was called
      expect(processSpy).toHaveBeenCalledTimes(1);

      // Get the processed content from the mock
      const processCall = processSpy.mock.calls[0];
      const processor = processCall[1];
      const processedContent = processor(mockContent);

      // Verify that only the target message was removed, others remain
      expect(processedContent).toMatchSnapshot();
    });

    it('should not show label when role is System and showLabel is false', async () => {
      // Mock uniqueID to return predictable values for testing
      const mockUniqueID = uniqueID as jest.MockedFunction<typeof uniqueID>;
      mockUniqueID.mockClear().mockReturnValueOnce('msg-001').mockReturnValueOnce('msg-002');

      // Create mock plugin with the conversation content
      const mockPlugin = createMockPlugin('');
      // Set showPronouns to true to show the label by default.
      mockPlugin.settings.showPronouns = true;
      conversationRenderer = ConversationRenderer.getInstance(mockPlugin);

      const processSpy = jest
        .spyOn(mockPlugin.app.vault, 'process')
        .mockImplementation(async (file, processor) => {
          const result = processor('');
          return result;
        });

      await conversationRenderer.updateConversationNote({
        path: 'test-conversation',
        newContent: 'This message has a role label',
        role: 'Steward',
      });

      await conversationRenderer.updateConversationNote({
        path: 'test-conversation',
        newContent: 'This message does not have a role label',
        role: {
          name: 'System',
          showLabel: false,
        },
      });

      // Verify that uniqueID was called for each message
      expect(mockUniqueID).toHaveBeenCalledTimes(2);

      // Verify that vault.process was called
      expect(processSpy).toHaveBeenCalledTimes(2);

      // Get the processed content from the mocks
      for (const processCall of processSpy.mock.calls) {
        const processor = processCall[1];
        const processedContent = processor('');

        // Verify that the label is not shown
        expect(processedContent.trim()).toMatchSnapshot();
      }
    });
  });

  describe('getGeneratingIndicator', () => {
    it('should get the generating indicator from the content', () => {
      const content = 'This is a message\n\n*Generating...*';
      const indicator = conversationRenderer.getGeneratingIndicator(content);
      expect(indicator).toEqual('\n\n*Generating...*');
    });

    it('should return an empty string if no indicator is found', () => {
      const content = 'This is a message';
      const indicator = conversationRenderer.getGeneratingIndicator(content);
      expect(indicator).toEqual('');
    });
  });

  describe('serializeToolInvocation', () => {
    it('should keep indicator when there is an indicator but no visible text is being added', async () => {
      // Mock conversation content with generating indicator
      const mockContent = 'Some existing content\n\n*Generating...*';

      // Create mock plugin with the conversation content
      const mockPlugin = createMockPlugin(mockContent);
      conversationRenderer = ConversationRenderer.getInstance(mockPlugin);

      // Spy on the vault.process method
      let processedContent = '';
      const processSpy = jest
        .spyOn(mockPlugin.app.vault, 'process')
        .mockImplementation(async (file, processor) => {
          processedContent = processor(mockContent);
          return processedContent;
        });

      // Call serializeToolInvocation without text parameter
      await conversationRenderer.serializeToolInvocation({
        path: 'test-conversation',
        toolInvocations: [
          {
            toolName: 'read',
            toolCallId: 'call_123',
            type: 'tool-result',
            output: {
              type: 'text',
              value: 'test result',
            },
          },
        ],
      });

      // Verify that vault.process was called
      expect(processSpy).toHaveBeenCalledTimes(1);

      // Verify that the indicator is kept in the processed content
      expect(processedContent).toContain('*Generating...*');
    });

    it('should not keep indicator when there is an indicator and visible text is being added', async () => {
      // Mock conversation content with generating indicator
      const mockContent = 'Some existing content\n\n*Generating...*';

      // Create mock plugin with the conversation content
      const mockPlugin = createMockPlugin(mockContent);
      conversationRenderer = ConversationRenderer.getInstance(mockPlugin);

      // Spy on the vault.process method
      let processedContent = '';
      const processSpy = jest
        .spyOn(mockPlugin.app.vault, 'process')
        .mockImplementation(async (file, processor) => {
          processedContent = processor(mockContent);
          return processedContent;
        });

      // Call serializeToolInvocation with text parameter
      await conversationRenderer.serializeToolInvocation({
        path: 'test-conversation',
        text: 'Here are the results:',
        toolInvocations: [
          {
            toolName: 'read',
            toolCallId: 'call_123',
            type: 'tool-result',
            output: {
              type: 'text',
              value: 'test result',
            },
          },
        ],
      });

      // Verify that vault.process was called
      expect(processSpy).toHaveBeenCalledTimes(1);

      // Verify that the indicator is NOT kept in the processed content
      expect(processedContent).not.toContain('*Generating...*');
      // Verify that the text is present
      expect(processedContent).toContain('Here are the results:');
    });
  });

  describe('deserializeToolInvocations', () => {
    it('should deserialize a tool-call with input and output', async () => {
      const mockPlugin = createMockPlugin();
      conversationRenderer = ConversationRenderer.getInstance(mockPlugin);

      const message: ConversationMessage = {
        id: 'msg123',
        role: 'assistant',
        content: [
          'Some text before',
          '',
          '```stw-artifact',
          JSON.stringify([
            {
              toolName: 'search',
              toolCallId: 'call_456',
              type: 'tool-call',
              input: { query: 'React hooks' },
              output: {
                type: 'text',
                value: 'Found 5 results',
              },
            },
          ]),
          '```',
          '',
          'Some text after',
        ].join('\n'),
        intent: 'search',
        type: 'tool-invocation',
      };

      const result = await conversationRenderer.deserializeToolInvocations({
        message,
        conversationTitle: 'test-conversation',
      });

      expect(result).toMatchSnapshot();
    });

    it('should deserialize a tool-call with args and result (backward compatibility)', async () => {
      const mockPlugin = createMockPlugin();
      conversationRenderer = ConversationRenderer.getInstance(mockPlugin);

      const message: ConversationMessage = {
        id: 'msg123',
        role: 'assistant',
        content: [
          'Some text before',
          '',
          '```stw-artifact',
          JSON.stringify([
            {
              toolName: 'read',
              toolCallId: 'call_789',
              type: 'tool-call',
              args: { query: 'TypeScript types' },
              result: 'Found documentation',
            },
          ]),
          '```',
          '',
          'Some text after',
        ].join('\n'),
        intent: 'read',
        type: 'tool-invocation',
      };

      const result = await conversationRenderer.deserializeToolInvocations({
        message,
        conversationTitle: 'test-conversation',
      });

      expect(result).toMatchSnapshot();
    });

    it('should deserialize a tool-result type with inline output', async () => {
      const mockPlugin = createMockPlugin();
      conversationRenderer = ConversationRenderer.getInstance(mockPlugin);

      const message: ConversationMessage = {
        id: 'msg123',
        role: 'assistant',
        content: [
          '```stw-artifact',
          JSON.stringify([
            {
              toolName: 'activate',
              toolCallId: 'call_111',
              type: 'tool-result',
              output: {
                type: 'text',
                value: 'Tools activated successfully',
              },
            },
          ]),
          '```',
        ].join('\n'),
        intent: 'activate',
        type: 'tool-invocation',
      };

      const result = await conversationRenderer.deserializeToolInvocations({
        message,
        conversationTitle: 'test-conversation',
      });

      expect(result).toMatchSnapshot();
    });

    it('should deserialize a tool-result with object output', async () => {
      const mockPlugin = createMockPlugin();
      conversationRenderer = ConversationRenderer.getInstance(mockPlugin);

      const message: ConversationMessage = {
        id: 'msg123',
        role: 'assistant',
        content: [
          '```stw-artifact',
          JSON.stringify([
            {
              toolName: 'activate',
              toolCallId: 'call_222',
              type: 'tool-result',
              output: {
                type: 'json',
                value: { status: 'success', tools: ['read', 'write'] },
              },
            },
          ]),
          '```',
        ].join('\n'),
        intent: 'activate',
        type: 'tool-invocation',
      };

      const result = await conversationRenderer.deserializeToolInvocations({
        message,
        conversationTitle: 'test-conversation',
      });

      expect(result).toMatchSnapshot();
    });

    it('should resolve artifactRef to the artifact', async () => {
      const mockPlugin = createMockPlugin();
      const mockArtifact = {
        id: 'artifact123',
        artifactType: 'read_content',
        readingResult: {
          source: 'cursor',
          blocks: [{ startLine: 1, endLine: 1, sections: [], content: 'Test content' }],
        },
      };

      Object.defineProperty(mockPlugin, 'artifactManagerV2', {
        value: {
          withTitle: jest.fn().mockReturnValue({
            getArtifactById: jest.fn().mockResolvedValue(mockArtifact),
          }),
        },
        writable: true,
      });

      conversationRenderer = ConversationRenderer.getInstance(mockPlugin);

      const message: ConversationMessage = {
        id: 'msg123',
        role: 'assistant',
        content: [
          '```stw-artifact',
          JSON.stringify([
            {
              toolName: 'read',
              toolCallId: 'call_333',
              type: 'tool-result',
              output: {
                type: 'text',
                value: 'artifactRef:artifact123',
              },
            },
          ]),
          '```',
        ].join('\n'),
        intent: 'read',
        type: 'tool-invocation',
      };

      const result = await conversationRenderer.deserializeToolInvocations({
        message,
        conversationTitle: 'test-conversation',
      });

      expect(result).toMatchSnapshot();
    });

    it('should resolve artifactRef to deleted artifact to not sending the artifact data', async () => {
      const mockPlugin = createMockPlugin();
      const mockArtifact = {
        id: 'artifact456',
        artifactType: 'read_content',
        readingResult: {
          source: 'cursor',
          blocks: [{ startLine: 1, endLine: 1, sections: [], content: 'Not sending this content' }],
        },
        deleteReason: 'User deleted',
      };

      Object.defineProperty(mockPlugin, 'artifactManagerV2', {
        value: {
          withTitle: jest.fn().mockReturnValue({
            getArtifactById: jest.fn().mockResolvedValue(mockArtifact),
          }),
        },
        writable: true,
      });

      conversationRenderer = ConversationRenderer.getInstance(mockPlugin);

      const message: ConversationMessage = {
        id: 'msg123',
        role: 'assistant',
        content: [
          '```stw-artifact',
          JSON.stringify([
            {
              toolName: 'read',
              toolCallId: 'call_444',
              type: 'tool-result',
              output: {
                type: 'text',
                value: 'artifactRef:artifact456',
              },
            },
          ]),
          '```',
        ].join('\n'),
        intent: 'read',
        type: 'tool-invocation',
      };

      const result = await conversationRenderer.deserializeToolInvocations({
        message,
        conversationTitle: 'test-conversation',
      });

      expect(result).toMatchSnapshot();
    });

    it('should return error-text when artifactRef points to non-existent artifact', async () => {
      const mockPlugin = createMockPlugin();

      Object.defineProperty(mockPlugin, 'artifactManagerV2', {
        value: {
          withTitle: jest.fn().mockReturnValue({
            getArtifactById: jest.fn().mockResolvedValue(undefined),
          }),
        },
        writable: true,
      });

      conversationRenderer = ConversationRenderer.getInstance(mockPlugin);

      const message: ConversationMessage = {
        id: 'msg123',
        role: 'assistant',
        content: [
          '```stw-artifact',
          JSON.stringify([
            {
              toolName: 'read',
              toolCallId: 'call_555',
              type: 'tool-result',
              output: {
                type: 'text',
                value: 'artifactRef:nonexistent',
              },
            },
          ]),
          '```',
        ].join('\n'),
        intent: 'read',
        type: 'tool-invocation',
      };

      const result = await conversationRenderer.deserializeToolInvocations({
        message,
        conversationTitle: 'test-conversation',
      });

      expect(result).toMatchSnapshot();
    });

    it('should resolve messageRef to the message content', async () => {
      const mockContent = [
        '<!--STW ID:refMsg123,ROLE:assistant,COMMAND:edit-->',
        'Updated file content here',
        '',
      ].join('\n');

      const mockPlugin = createMockPlugin(mockContent);
      conversationRenderer = ConversationRenderer.getInstance(mockPlugin);

      const message: ConversationMessage = {
        id: 'msg123',
        role: 'assistant',
        content: [
          '```stw-artifact',
          JSON.stringify([
            {
              toolName: 'edit',
              toolCallId: 'call_666',
              type: 'tool-result',
              output: {
                type: 'text',
                value: 'messageRef:refMsg123',
              },
            },
          ]),
          '```',
        ].join('\n'),
        intent: 'edit',
        type: 'tool-invocation',
      };

      const result = await conversationRenderer.deserializeToolInvocations({
        message,
        conversationTitle: 'test-conversation',
      });

      expect(result).toMatchSnapshot();
    });

    it('should return error-text when messageRef points to non-existent message', async () => {
      const mockPlugin = createMockPlugin();
      conversationRenderer = ConversationRenderer.getInstance(mockPlugin);

      const message: ConversationMessage = {
        id: 'msg123',
        role: 'assistant',
        content: [
          '```stw-artifact',
          JSON.stringify([
            {
              toolName: 'edit',
              toolCallId: 'call_777',
              type: 'tool-result',
              output: {
                type: 'text',
                value: 'messageRef:nonexistent',
              },
            },
          ]),
          '```',
        ].join('\n'),
        intent: 'edit',
        type: 'tool-invocation',
      };

      const result = await conversationRenderer.deserializeToolInvocations({
        message,
        conversationTitle: 'test-conversation',
      });

      expect(result).toMatchSnapshot();
    });

    it('should include image parts when artifact has imagePaths', async () => {
      const mockPlugin = createMockPlugin();
      const mockArtifact = new ReadContentArtifactImpl({
        artifactType: ArtifactType.READ_CONTENT,
        id: 'artifact789',
        readingResult: {
          source: 'cursor',
          blocks: [{ startLine: 1, endLine: 1, sections: [], content: 'Content with image' }],
        },
        imagePaths: ['path/to/image1.png', 'path/to/image2.jpg'],
      });

      Object.defineProperty(mockPlugin, 'artifactManagerV2', {
        value: {
          withTitle: jest.fn().mockReturnValue({
            getArtifactById: jest.fn().mockResolvedValue(mockArtifact),
          }),
        },
        writable: true,
      });

      mockPlugin.userMessageService.getImagePartsFromPaths = jest.fn().mockResolvedValue([
        ['path/to/image1.png', { type: 'image', image: 'base64data1', mediaType: 'image/png' }],
        ['path/to/image2.jpg', { type: 'image', image: 'base64data2', mediaType: 'image/jpeg' }],
      ]);

      conversationRenderer = ConversationRenderer.getInstance(mockPlugin);

      const message: ConversationMessage = {
        id: 'msg123',
        role: 'assistant',
        content: [
          '```stw-artifact',
          JSON.stringify([
            {
              toolName: 'read',
              toolCallId: 'call_888',
              type: 'tool-result',
              output: {
                type: 'text',
                value: 'artifactRef:artifact789',
              },
            },
          ]),
          '```',
        ].join('\n'),
        intent: 'read',
        type: 'tool-invocation',
      };

      const result = await conversationRenderer.deserializeToolInvocations({
        message,
        conversationTitle: 'test-conversation',
      });

      expect(result).toMatchSnapshot();
    });

    it('should return null when no stw-artifact blocks are found', async () => {
      const mockPlugin = createMockPlugin();
      conversationRenderer = ConversationRenderer.getInstance(mockPlugin);

      const message: ConversationMessage = {
        id: 'msg123',
        role: 'assistant',
        content: 'This message has no tool invocations',
        intent: 'search',
        type: 'tool-invocation',
      };

      const result = await conversationRenderer.deserializeToolInvocations({
        message,
        conversationTitle: 'test-conversation',
      });

      expect(result).toBeNull();
    });

    it('should handle tool-call type with both input and output', async () => {
      const mockPlugin = createMockPlugin();
      conversationRenderer = ConversationRenderer.getInstance(mockPlugin);

      const message: ConversationMessage = {
        id: 'msg123',
        role: 'assistant',
        content: [
          '```stw-artifact',
          JSON.stringify([
            {
              toolName: 'search',
              toolCallId: 'call_999',
              type: 'tool-call',
              input: { query: 'test query' },
              output: {
                type: 'text',
                value: 'Search results here',
              },
            },
          ]),
          '```',
        ].join('\n'),
        intent: 'search',
        type: 'tool-invocation',
      };

      const result = await conversationRenderer.deserializeToolInvocations({
        message,
        conversationTitle: 'test-conversation',
      });

      expect(result).toMatchSnapshot();
    });

    it('should handle tool-result type with input included', async () => {
      const mockPlugin = createMockPlugin();
      conversationRenderer = ConversationRenderer.getInstance(mockPlugin);

      const message: ConversationMessage = {
        id: 'msg123',
        role: 'assistant',
        content: [
          '```stw-artifact',
          JSON.stringify([
            {
              toolName: 'activate',
              toolCallId: 'call_aaa',
              type: 'tool-result',
              input: { tools: ['read', 'write'] },
              output: {
                type: 'json',
                value: { status: 'activated' },
              },
            },
          ]),
          '```',
        ].join('\n'),
        intent: 'activate',
        type: 'tool-invocation',
      };

      const result = await conversationRenderer.deserializeToolInvocations({
        message,
        conversationTitle: 'test-conversation',
      });

      expect(result).toMatchSnapshot();
    });
  });
});
