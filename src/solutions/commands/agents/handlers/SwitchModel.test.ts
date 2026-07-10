import { SwitchModel } from './SwitchModel';
import { IntentResultStatus } from '../../types';
import { ToolName } from '../../ToolRegistry';

describe('SwitchModel', () => {
  it('switches to a valid model and mutates intent.model', async () => {
    const switchToModel = jest.fn().mockResolvedValue(true);
    const serializeInvocation = jest.fn().mockResolvedValue(undefined);

    const agent = {
      plugin: {
        modelFallbackService: {
          getState: jest.fn().mockResolvedValue(null),
          switchToModel,
        },
      },
    };

    const ctx = {
      title: 'child-conv',
      lang: 'en',
      agentHandlerParams: {
        title: 'child-conv',
        intent: {
          type: ' ',
          query: 'test',
          model: 'deepseek:deepseek-chat',
          models: ['deepseek:deepseek-chat', 'google:gemini-2.5-flash'],
        },
      },
      serializeInvocation,
    };

    const handler = new SwitchModel(agent as never);
    const result = await handler.handle(ctx as never, {
      toolCall: {
        toolName: ToolName.SWITCH_MODEL,
        toolCallId: 'call-1',
        type: 'tool-call',
        input: { model: 'google:gemini-2.5-flash', reason: 'Need vision for image read' },
      },
    });

    expect(result.status).toBe(IntentResultStatus.SUCCESS);
    expect(switchToModel).toHaveBeenCalledWith('child-conv', 'google:gemini-2.5-flash');
    expect(ctx.agentHandlerParams.intent.model).toBe('google:gemini-2.5-flash');
    expect(serializeInvocation).toHaveBeenCalledWith(
      expect.objectContaining({
        command: ToolName.SWITCH_MODEL,
        result: expect.objectContaining({
          type: 'text',
          value: expect.stringContaining('google:gemini-2.5-flash'),
        }),
      })
    );
  });

  it('returns error result when model is not in the allowed list', async () => {
    const serializeInvocation = jest.fn().mockResolvedValue(undefined);

    const agent = {
      plugin: {
        modelFallbackService: {
          getState: jest.fn().mockResolvedValue(null),
        },
      },
    };

    const ctx = {
      title: 'child-conv',
      lang: 'en',
      agentHandlerParams: {
        title: 'child-conv',
        intent: {
          type: ' ',
          query: 'test',
          model: 'deepseek:deepseek-chat',
          models: ['deepseek:deepseek-chat', 'google:gemini-2.5-flash'],
        },
      },
      serializeInvocation,
    };

    const handler = new SwitchModel(agent as never);
    const result = await handler.handle(ctx as never, {
      toolCall: {
        toolName: ToolName.SWITCH_MODEL,
        toolCallId: 'call-2',
        type: 'tool-call',
        input: { model: 'openai:gpt-4o', reason: 'Try another model' },
      },
    });

    expect(result.status).toBe(IntentResultStatus.SUCCESS);
    expect(serializeInvocation).toHaveBeenCalledWith(
      expect.objectContaining({
        result: expect.objectContaining({
          type: 'error-text',
          value: expect.stringContaining('deepseek:deepseek-chat'),
        }),
      })
    );
  });
});
