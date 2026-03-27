import type StewardPlugin from 'src/main';
import { ToolName } from 'src/solutions/commands/ToolRegistry';
import { IntentResultStatus, type AgentHandlerParams } from 'src/solutions/commands/types';
import type { ToolCallPart } from 'src/solutions/commands/tools/types';
import type { ToolHandlerMiddlewareContext } from 'src/solutions/commands/agents/middleware/types';
import type { GuardrailsRule } from './types';
import { createGuardrailsMiddleware } from './guardrailsMiddleware';

function createParams(): AgentHandlerParams {
  return {
    title: 'conversation.md',
    intent: {
      type: 'test',
      query: 'test query',
    },
    lang: 'en',
    handlerId: 'handler-1',
    invocationCount: 0,
  };
}

function createToolCall(): ToolCallPart<Record<string, unknown>> {
  return {
    type: 'tool-call',
    toolName: ToolName.GREP,
    toolCallId: 'tool-call-1',
    input: {
      contentPattern: 'secret',
    },
  } as ToolCallPart<Record<string, unknown>>;
}

function createContext(params: {
  paths: string[];
  toolName?: ToolName;
}): ToolHandlerMiddlewareContext {
  const { paths, toolName = ToolName.GREP } = params;

  const toolCall = createToolCall();
  toolCall.toolName = toolName;

  return {
    params: createParams(),
    toolCall,
    agent: {
      getPathsForGuardrails: () => paths,
    },
  };
}

function createPluginMock(rules: GuardrailsRule[]): {
  plugin: StewardPlugin;
  getRulesForTool: jest.Mock;
  updateConversationNote: jest.Mock;
  serializeToolInvocation: jest.Mock;
} {
  const getRulesForTool = jest.fn(() => rules);
  const updateConversationNote = jest.fn().mockResolvedValue(undefined);
  const serializeToolInvocation = jest.fn().mockResolvedValue(undefined);

  const plugin = {
    guardrailsRuleService: {
      getRulesForTool,
    },
    conversationRenderer: {
      updateConversationNote,
      serializeToolInvocation,
    },
  } as unknown as StewardPlugin;

  return {
    plugin,
    getRulesForTool,
    updateConversationNote,
    serializeToolInvocation,
  };
}

describe('guardrailsMiddleware', () => {
  it('calls next when no rules apply to the tool', async () => {
    const { plugin, getRulesForTool, updateConversationNote, serializeToolInvocation } =
      createPluginMock([]);
    const middleware = createGuardrailsMiddleware(plugin);
    const next = jest.fn().mockResolvedValue({ status: IntentResultStatus.SUCCESS });
    const ctx = createContext({ paths: ['Secret/a.md'] });

    const result = await middleware(ctx, next);

    expect(getRulesForTool).toHaveBeenCalledWith(ToolName.GREP);
    expect(next).toHaveBeenCalledTimes(1);
    expect(updateConversationNote).not.toHaveBeenCalled();
    expect(serializeToolInvocation).not.toHaveBeenCalled();
    expect(result.status).toBe(IntentResultStatus.SUCCESS);
  });

  it('calls next when paths list is empty', async () => {
    const { plugin, updateConversationNote, serializeToolInvocation } = createPluginMock([
      {
        name: 'No Secret Access',
        path: 'Steward/Rules/no-secret-access.md',
        targets: ['Secret/'],
        actions: ['read'],
        enabled: true,
      },
    ]);
    const middleware = createGuardrailsMiddleware(plugin);
    const next = jest.fn().mockResolvedValue({ status: IntentResultStatus.SUCCESS });
    const ctx = createContext({ paths: [] });

    const result = await middleware(ctx, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(updateConversationNote).not.toHaveBeenCalled();
    expect(serializeToolInvocation).not.toHaveBeenCalled();
    expect(result.status).toBe(IntentResultStatus.SUCCESS);
  });

  it('returns STOP_PROCESSING when a matching rule has instruction', async () => {
    const { plugin, updateConversationNote, serializeToolInvocation } = createPluginMock([
      {
        name: 'No Secret Access',
        path: 'Steward/Rules/no-secret-access.md',
        targets: ['Secret/'],
        actions: ['read'],
        instruction: 'Never access Secret folder',
        enabled: true,
      },
    ]);
    const middleware = createGuardrailsMiddleware(plugin);
    const next = jest.fn().mockResolvedValue({ status: IntentResultStatus.SUCCESS });
    const ctx = createContext({ paths: ['Secret/roadmap.md'] });

    const result = await middleware(ctx, next);

    expect(next).not.toHaveBeenCalled();
    expect(updateConversationNote).toHaveBeenCalledTimes(1);
    expect(serializeToolInvocation).not.toHaveBeenCalled();
    expect(result.status).toBe(IntentResultStatus.STOP_PROCESSING);
  });

  it('serializes guardrails error when a matching rule has no instruction', async () => {
    const { plugin, updateConversationNote, serializeToolInvocation } = createPluginMock([
      {
        name: 'No Secret Access',
        path: 'Steward/Rules/no-secret-access.md',
        targets: ['Secret/'],
        actions: ['read'],
        enabled: true,
      },
    ]);
    const middleware = createGuardrailsMiddleware(plugin);
    const next = jest.fn().mockResolvedValue({ status: IntentResultStatus.SUCCESS });
    const ctx = createContext({ paths: ['Secret/roadmap.md'] });

    const result = await middleware(ctx, next);

    expect(next).not.toHaveBeenCalled();
    expect(updateConversationNote).not.toHaveBeenCalled();
    expect(serializeToolInvocation).toHaveBeenCalledTimes(1);
    expect(result.status).toBe(IntentResultStatus.SUCCESS);
  });

  it.skip('treats root path as full-vault and blocks guarded target', async () => {
    const { plugin, serializeToolInvocation } = createPluginMock([
      {
        name: 'No Secret Access',
        path: 'Steward/Rules/no-secret-access.md',
        targets: ['Secret/'],
        actions: ['read'],
        enabled: true,
      },
    ]);
    const middleware = createGuardrailsMiddleware(plugin);
    const next = jest.fn().mockResolvedValue({ status: IntentResultStatus.SUCCESS });
    const ctx = createContext({ paths: ['/'] });

    await middleware(ctx, next);

    expect(next).not.toHaveBeenCalled();
    expect(serializeToolInvocation).toHaveBeenCalledTimes(1);
  });
});
