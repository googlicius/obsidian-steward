import type { AgentHandlerContext } from '../AgentHandlerContext';
import type { AgentHandlerParams, Intent } from '../../types';
import { IntentResultStatus } from '../../types';
import { ToolName } from '../../toolNames';
import type StewardPlugin from 'src/main';
import { WidgetService, type WidgetJsValidationError } from 'src/services/WidgetService';
import { createTestHandlerInvocationContext } from './testUtils';
import { ShowWidget, type ShowWidgetArgs } from './ShowWidget';
import type { ToolCallPart } from '../../tools/types';

function createMockPlugin(): StewardPlugin {
  const plugin: Record<string, unknown> = {
    settings: { stewardFolder: 'Steward' },
    app: {
      workspace: {
        onLayoutReady: jest.fn((callback: () => void) => {
          callback();
          return { events: [] };
        }),
      },
      vault: {
        getFileByPath: jest.fn(),
        read: jest.fn(),
        create: jest.fn(),
        modify: jest.fn(),
        on: jest.fn().mockReturnValue({ events: [] }),
      },
    },
    obsidianAPITools: {
      ensureFolderExists: jest.fn().mockResolvedValue(undefined),
      getFilesFromFolder: jest.fn().mockReturnValue([]),
    },
    registerEvent: jest.fn(),
    mediaTools: {
      findFileByNameOrPath: jest.fn(),
    },
    artifactManagerV2: {
      withTitle: jest.fn(),
    },
  };

  plugin.widgetService = WidgetService.getInstance(plugin as unknown as StewardPlugin);
  return plugin as unknown as StewardPlugin;
}

function createProjectToolCall(input: Partial<ShowWidgetArgs> = {}): ToolCallPart<ShowWidgetArgs> {
  return {
    type: 'tool-call',
    toolCallId: 'call-1',
    toolName: ToolName.SHOW_WIDGET,
    input: {
      type: 'html',
      widgetName: 'Tic Tac Toe',
      files: [
        {
          name: 'index.html',
          content: '<script src="main.js"></script>',
        },
        {
          name: 'main.js',
          content: 'const game = {};',
        },
      ],
      ...input,
    },
  };
}

function setupHandleProjectWidget(params?: { validateWrittenJsFiles?: WidgetJsValidationError[] }) {
  const plugin = createMockPlugin();
  const widgetService = plugin.widgetService;
  const projectPath = 'Steward/Widgets/Tic-Tac-Toe-abc12';

  jest.spyOn(widgetService, 'buildWidgetId').mockReturnValue('Tic-Tac-Toe-abc12');
  const createProject = jest.spyOn(widgetService, 'createProject').mockResolvedValue({
    projectPath,
    entry: 'index.html',
  });
  const validateWrittenJsFiles = jest
    .spyOn(widgetService, 'validateWrittenJsFiles')
    .mockResolvedValue(params?.validateWrittenJsFiles ?? []);

  const artifactManager = {
    storeArtifact: jest.fn().mockResolvedValue('artifact-1'),
  };
  plugin.artifactManagerV2.withTitle = jest.fn().mockReturnValue(artifactManager);

  const serializeInvocation = jest.fn().mockResolvedValue(undefined);
  const updateConversationNote = jest.fn().mockResolvedValue('msg-1');

  const agentHandlerParams: AgentHandlerParams = {
    title: 'chat-1',
    intent: { type: 'super', query: 'widget' } as Intent,
    handlerId: 'handler-1',
    invocationCount: 0,
  };

  const agent = {
    plugin,
    renderer: {
      serializeToolInvocation: serializeInvocation,
    },
  } as unknown as AgentHandlerContext;

  const ctx = createTestHandlerInvocationContext({ agent, agentHandlerParams });
  ctx.updateConversationNote = updateConversationNote;
  ctx.serializeInvocation = jest.fn(async invocationParams => {
    await serializeInvocation({
      path: ctx.title,
      command: invocationParams.command,
      handlerId: ctx.handlerId,
      step: ctx.step,
      toolInvocations: [
        {
          ...invocationParams.toolCall,
          type: 'tool-result',
          output: invocationParams.result,
        },
      ],
    });
  });

  const showWidget = new ShowWidget(agent);
  const handleProjectWidget = showWidget['handleProjectWidget'].bind(showWidget);

  return {
    handleProjectWidget,
    ctx,
    createProject,
    validateWrittenJsFiles,
    projectPath,
  };
}

describe('ShowWidget', () => {
  beforeEach(() => {
    (WidgetService as unknown as { instance?: WidgetService }).instance = undefined;
  });

  describe('handleProjectWidget', () => {
    it('creates the project before linting and serializes json with success when JavaScript is valid', async () => {
      const { handleProjectWidget, ctx, createProject, validateWrittenJsFiles, projectPath } =
        setupHandleProjectWidget();

      const result = await handleProjectWidget(ctx, createProjectToolCall());

      expect(createProject.mock.invocationCallOrder[0]).toBeLessThan(
        validateWrittenJsFiles.mock.invocationCallOrder[0]
      );
      expect(ctx.serializeInvocation).toHaveBeenCalledWith(
        expect.objectContaining({
          result: {
            type: 'json',
            value: expect.objectContaining({
              success: true,
              type: 'html',
              widgetId: 'Tic-Tac-Toe-abc12',
              projectPath,
            }),
          },
        })
      );
      expect(result.status).toBe(IntentResultStatus.SUCCESS);
    });

    it('serializes error-json with lintError when written JavaScript is invalid', async () => {
      const projectPath = 'Steward/Widgets/Tic-Tac-Toe-abc12';
      const { handleProjectWidget, ctx } = setupHandleProjectWidget({
        validateWrittenJsFiles: [
          {
            filePath: `${projectPath}/main.js`,
            message: 'Unexpected token',
            line: 1,
            column: 1,
          },
        ],
      });

      const result = await handleProjectWidget(
        ctx,
        createProjectToolCall({
          files: [
            { name: 'index.html', content: '<script src="main.js"></script>' },
            { name: 'main.js', content: 'const game = {' },
          ],
        })
      );

      expect(ctx.serializeInvocation).toHaveBeenCalledWith(
        expect.objectContaining({
          result: {
            type: 'error-json',
            value: expect.objectContaining({
              lintError: expect.stringContaining('Invalid JavaScript in widget project'),
              type: 'html',
              widgetId: 'Tic-Tac-Toe-abc12',
              projectPath,
            }),
          },
        })
      );
      expect(result.status).toBe(IntentResultStatus.SUCCESS);
    });
  });
});
