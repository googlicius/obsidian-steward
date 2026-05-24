import { ZodError } from 'zod/v3';
import type { AgentHandlerContext } from '../AgentHandlerContext';
import { HandlerInvocationContext } from '../HandlerInvocationContext';
import type { AgentHandlerParams } from '../../types';

export function createTestHandlerInvocationContext(params: {
  agent: AgentHandlerContext;
  agentHandlerParams: AgentHandlerParams;
}): HandlerInvocationContext {
  const { agentHandlerParams } = params;
  const handlerId = agentHandlerParams.handlerId ?? 'test-handler-id';

  return new HandlerInvocationContext({
    title: agentHandlerParams.title,
    handlerId,
    step: agentHandlerParams.invocationCount ?? 0,
    lang: agentHandlerParams.lang,
    intent: agentHandlerParams.intent,
    agent: params.agent,
    agentHandlerParams,
  });
}

export function expectZodIssuesContaining(params: {
  fn: () => unknown;
  path: (string | number)[];
  messageSubstring: string;
}): void {
  try {
    params.fn();
    throw new Error('expected ZodError');
  } catch (e) {
    expect(e).toBeInstanceOf(ZodError);
    const err = e as ZodError;
    const match = err.issues.some(
      issue =>
        issue.message.includes(params.messageSubstring) &&
        JSON.stringify(issue.path) === JSON.stringify(params.path)
    );
    expect(match).toBe(true);
  }
}
