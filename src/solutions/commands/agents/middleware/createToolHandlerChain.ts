import type { AgentResult } from '../../types';
import type { ToolHandlerMiddleware, ToolHandlerMiddlewareContext } from './types';

export function createToolHandlerChain(params: {
  middlewares: ToolHandlerMiddleware[];
  handler: (ctx: ToolHandlerMiddlewareContext) => Promise<AgentResult>;
}): (ctx: ToolHandlerMiddlewareContext) => Promise<AgentResult> {
  const { middlewares, handler } = params;

  return async function runChain(ctx: ToolHandlerMiddlewareContext): Promise<AgentResult> {
    let index = 0;

    const next = async (): Promise<AgentResult> => {
      if (index < middlewares.length) {
        return middlewares[index++](ctx, next);
      }
      return handler(ctx);
    };

    return next();
  };
}
