import { generateText } from 'ai';
import type StewardPlugin from 'src/main';
import type { ConversationRenderer } from 'src/services/ConversationRenderer';
import type { AgentHandlerParams } from '../types';
import { ToolRegistry, ToolName } from '../ToolRegistry';
import {
  generateActiveSkillPrompts,
  generateSkillCatalogPrompt,
  generateTodoListPrompt,
} from './agentUtils';

type GenerateTextToolSet = NonNullable<Parameters<typeof generateText>[0]['tools']> & {
  [s: string]: unknown;
};

type AgentGenerateTextParams = AgentHandlerParams & {
  activeTools: ToolName[];
  inactiveTools: ToolName[];
  activeSkills: string[];
  tools: GenerateTextToolSet;
  coreSystemPrompt: string;
};

interface AgentGenerateTextExecutorContext {
  plugin: StewardPlugin;
  renderer: ConversationRenderer;
}

function asAgentGenerateTextExecutorContext(
  instance: AgentGenerateTextExecutor
): AgentGenerateTextExecutorContext {
  return instance as unknown as AgentGenerateTextExecutorContext;
}

export class AgentGenerateTextExecutor {
  protected getToolSubset(params: {
    activeTools: ToolName[];
    inactiveTools?: ToolName[];
    tools: GenerateTextToolSet;
  }): Partial<GenerateTextToolSet> {
    const selected = new Set<string>([...params.activeTools, ...(params.inactiveTools || [])]);
    if (selected.size === 0) {
      return params.tools;
    }

    return Object.fromEntries(
      Object.entries(params.tools).filter(([name]) => selected.has(name))
    ) as Partial<GenerateTextToolSet>;
  }

  protected buildToolInstructionsSystemPrompt(
    registry: ToolRegistry<Partial<GenerateTextToolSet>>
  ): string {
    const guidelines = registry.generateGuidelinesSection();
    const inactiveTools = registry.generateOtherToolsSection('No inactive tools available.');

    return `TOOLS GUIDELINES:
${guidelines}

OPTIONAL INACTIVE TOOLS:
${inactiveTools}

Use ${ToolName.ACTIVATE} to activate optional inactive tools only when needed for pre-check or verification.`;
  }

  protected async executeGenerateText<TToolCalls = unknown>(
    params: AgentGenerateTextParams
  ): Promise<{
    toolCalls: TToolCalls;
  }> {
    const agent = asAgentGenerateTextExecutorContext(this);
    const conversationHistory = await agent.renderer.extractConversationHistory(params.title);
    const llmConfig = await agent.plugin.llmService.getLLMConfig({
      overrideModel: params.intent.model,
      generateType: 'text',
    });

    const shouldUseTools = params.intent.use_tool !== false;
    const activeToolNames = shouldUseTools ? params.activeTools : [];
    const selectedTools = this.getToolSubset({
      activeTools: params.activeTools,
      inactiveTools: params.inactiveTools,
      tools: params.tools,
    });

    const registry = ToolRegistry.buildFromTools(selectedTools)
      .setActive(activeToolNames)
      .setAdditionalGuidelines(agent.plugin.guardrailsRuleService.getInstructionsByTool());

    const messages = [...conversationHistory];
    if (!params.invocationCount) {
      messages.push({ role: 'user', content: params.intent.query });
    }

    agent.plugin.llmService.validateImageSupport(
      params.intent.model || agent.plugin.settings.llm.chat.model,
      messages,
      params.lang
    );

    const todoListPrompt = activeToolNames.includes(ToolName.TODO_LIST_UPDATE)
      ? await generateTodoListPrompt({
          renderer: agent.renderer,
          title: params.title,
        })
      : '';
    const skillCatalogPrompt = generateSkillCatalogPrompt({
      plugin: agent.plugin,
    });
    const activeSkillPrompts = generateActiveSkillPrompts({
      plugin: agent.plugin,
      activeSkillNames: params.activeSkills || [],
    });

    const additionalSystemPrompts = params.intent.systemPrompts
      ? [...params.intent.systemPrompts]
      : [];
    if (llmConfig.systemPrompt) {
      additionalSystemPrompts.push(llmConfig.systemPrompt);
    }

    if (todoListPrompt) {
      additionalSystemPrompts.push(todoListPrompt);
    }

    if (skillCatalogPrompt) {
      additionalSystemPrompts.push(skillCatalogPrompt);
    }

    if (activeSkillPrompts.length > 0) {
      additionalSystemPrompts.push(...activeSkillPrompts);
    }

    if (shouldUseTools) {
      additionalSystemPrompts.push(this.buildToolInstructionsSystemPrompt(registry));
    }

    if (additionalSystemPrompts.length > 0) {
      for (const item of additionalSystemPrompts) {
        messages.unshift({ role: 'system', content: item });
      }
    }

    type RepairToolCall = Parameters<typeof generateText>[0]['experimental_repairToolCall'];

    const result = await generateText({
      model: llmConfig.model,
      temperature: llmConfig.temperature,
      maxOutputTokens: llmConfig.maxOutputTokens,
      abortSignal: agent.plugin.abortService.createAbortController(),
      system: params.coreSystemPrompt,
      messages,
      tools: registry.getToolsObject() as NonNullable<Parameters<typeof generateText>[0]['tools']>,
      experimental_repairToolCall: llmConfig.repairToolCall as RepairToolCall,
    });

    if (result.text && result.text.trim().length > 0) {
      await agent.renderer.updateConversationNote({
        path: params.title,
        newContent: result.text,
        lang: params.lang,
        handlerId: params.handlerId,
        step: params.invocationCount,
      });
    }

    return {
      toolCalls: result.toolCalls as TToolCalls,
    };
  }
}
