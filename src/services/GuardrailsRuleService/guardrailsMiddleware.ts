import { normalizePath } from 'obsidian';
import { getTranslation } from 'src/i18n';
import { IntentResultStatus } from 'src/solutions/commands/types';
import type { AgentResult } from 'src/solutions/commands/types';
import type {
  ToolHandlerMiddleware,
  ToolHandlerMiddlewareContext,
} from 'src/solutions/commands/agents/middleware/types';
import type StewardPlugin from 'src/main';
import { ToolName } from 'src/solutions/commands/toolNames';

function pathMatchesTarget(path: string, target: string): boolean {
  const normalizedPath = normalizePath(path);
  const normalizedTarget = normalizePath(target);
  const trimmedPath = path.trim();

  // Root scope may normalize differently depending on runtime context.
  if (trimmedPath === '/' || normalizedPath === '/' || normalizedPath === '') {
    return true;
  }

  if (normalizedTarget.endsWith('/')) {
    const prefix = normalizedTarget.replace(/\/+$/, '');
    return normalizedPath === prefix || normalizedPath.startsWith(prefix + '/');
  }

  if (normalizedTarget.startsWith('*')) {
    const suffix = normalizedTarget.slice(1);
    return normalizedPath.endsWith(suffix);
  }

  return normalizedPath === normalizedTarget || normalizedPath.startsWith(normalizedTarget + '/');
}

export function createGuardrailsMiddleware(plugin: StewardPlugin): ToolHandlerMiddleware {
  return async function guardrailsMiddleware(
    ctx: ToolHandlerMiddlewareContext,
    next: () => Promise<AgentResult>
  ): Promise<AgentResult> {
    const toolName = ctx.toolCall.toolName as ToolName;
    const rules = plugin.guardrailsRuleService.getRulesForTool(toolName);
    if (rules.length === 0) {
      return next();
    }

    const paths = ctx.agent?.getPathsForGuardrails(toolName, ctx.toolCall.input) ?? [];
    if (paths.length === 0) {
      return next();
    }

    const violatedRules: string[] = [];
    let stopProcessing = false;

    for (const rule of rules) {
      for (const path of paths) {
        for (const target of rule.targets) {
          if (pathMatchesTarget(path, target)) {
            violatedRules.push(rule.name);
            if (rule.instruction) stopProcessing = true;
            break;
          }
        }
      }
    }

    if (violatedRules.length === 0) {
      return next();
    }

    const t = getTranslation(ctx.params.lang);
    const uniqueViolated = [...new Set(violatedRules)];
    const blockedActions = [
      ...new Set(
        rules.filter(rule => uniqueViolated.includes(rule.name)).flatMap(rule => rule.actions)
      ),
    ];

    if (stopProcessing) {
      const humanMessage = t('guardrails.violationHuman', {
        rules: uniqueViolated.join(', '),
        paths: paths.join(', '),
      });
      await plugin.conversationRender.updateConversationNote({
        path: ctx.params.title,
        newContent: `*${humanMessage}*`,
        command: 'guardrails',
        lang: ctx.params.lang,
        handlerId: ctx.params.handlerId,
        step: ctx.params.invocationCount,
        includeHistory: false,
      });

      return {
        status: IntentResultStatus.STOP_PROCESSING,
        reason: humanMessage,
      };
    }

    const message = t('guardrails.violation', {
      rules: uniqueViolated.join(', '),
      paths: paths.join(', '),
      actions: blockedActions.join(', '),
    });

    await plugin.conversationRender.serializeToolInvocation({
      path: ctx.params.title,
      command: 'guardrails',
      handlerId: ctx.params.handlerId ?? '',
      step: ctx.params.invocationCount,
      toolInvocations: [
        {
          ...ctx.toolCall,
          type: 'tool-result',
          output: {
            type: 'error-text',
            value: message,
          },
        },
      ],
    });

    return { status: IntentResultStatus.SUCCESS };
  };
}
