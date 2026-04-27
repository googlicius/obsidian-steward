import type { AgentHandlerParams } from '../../types';
import { ToolRegistry, ToolName } from '../../ToolRegistry';
import { applyMixins } from 'src/utils/applyMixins';
import { ToolIntentResolution } from './ToolIntentResolution';
import { SystemPromptComposer } from './SystemPromptComposer';
import { Agent } from '../../Agent';
import { getBundledLib } from 'src/utils/bundledLibs';
import type { generateText, LanguageModelUsage } from 'ai';

type AiGenerateTextParams = Parameters<typeof generateText>[0];

type GenerateTextToolSet = NonNullable<AiGenerateTextParams['tools']> & {
  [s: string]: unknown;
};

type GenerateTextExecutorParams = AgentHandlerParams & {
  activeTools: ToolName[];
  inactiveTools: ToolName[];
  tools: GenerateTextToolSet;
};

function asAgent(instance: GenerateTextExecutor) {
  return instance as unknown as Agent;
}

// eslint-disable-next-line @typescript-eslint/no-empty-interface -- declaration merge: adds mixin types to class instance
export interface GenerateTextExecutor extends ToolIntentResolution, SystemPromptComposer {}

export class GenerateTextExecutor {
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
    registry: ToolRegistry<Record<string, unknown>>
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
    params: GenerateTextExecutorParams
  ): Promise<{
    toolCalls: TToolCalls;
    totalUsage: LanguageModelUsage;
  }> {
    const agent = asAgent(this);
    const conversationHistory = await agent.renderer.extractConversationHistory(params.title);
    const llmConfig = await agent.plugin.llmService.getLLMConfig({
      overrideModel: params.intent.model,
      generateType: 'text',
    });

    const declared = this.normalizeDeclaredTools(params.intent.tools, agent.getValidToolNames());
    let toolsForModel = params.tools;
    let activeForSubset = params.activeTools;
    let inactiveForSubset = params.inactiveTools || [];

    if (declared !== null) {
      const expanded = this.expandSubagentDeclaredTools(declared);
      toolsForModel = this.filterToolsObject(
        params.tools,
        new Set(expanded)
      ) as GenerateTextToolSet;
      if (declared.length <= this.declaredToolsSmallThreshold) {
        activeForSubset = expanded;
        inactiveForSubset = [];
      } else {
        activeForSubset = params.activeTools.filter(t => expanded.includes(t));
      }
    }

    const expandedForSwitchCheck =
      declared === null ? [] : this.expandSubagentDeclaredTools(declared);
    const switchOnly = declared !== null && this.isSwitchAgentCapacityOnly(expandedForSwitchCheck);
    const shouldUseTools = !switchOnly;
    const activeToolNames = shouldUseTools ? activeForSubset : [];
    const selectedTools = this.getToolSubset({
      activeTools: activeForSubset,
      inactiveTools: inactiveForSubset,
      tools: toolsForModel,
    });
    let activeMcpTools: Record<string, unknown> = {};
    let inactiveMcpTools: Record<string, unknown> = {};
    if (shouldUseTools) {
      const mcpTools = await agent.plugin.mcpService.getMcpToolsForConversation(params.title);
      activeMcpTools = mcpTools.active;
      inactiveMcpTools = mcpTools.inactive;
    }
    const allActiveToolNames = shouldUseTools
      ? [...activeToolNames, ...Object.keys(activeMcpTools)]
      : [];
    const toolsForRegistry = {
      ...selectedTools,
      ...(shouldUseTools ? inactiveMcpTools : {}),
      ...(shouldUseTools ? activeMcpTools : {}),
    };

    const registry = ToolRegistry.buildFromTools(toolsForRegistry)
      .setActive(allActiveToolNames)
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

    const includeSkillCatalog =
      !params.intent.tools ||
      params.intent.tools.length === 0 ||
      params.intent.tools.includes(ToolName.CONTENT_READING);
    const skillCatalogPrompt = includeSkillCatalog
      ? this.generateSkillCatalogPrompt({
          plugin: agent.plugin,
        })
      : '';

    const additionalSystemPrompts = params.intent.systemPrompts
      ? [...params.intent.systemPrompts]
      : [];
    if (llmConfig.systemPrompt) {
      additionalSystemPrompts.push(llmConfig.systemPrompt);
    }

    if (skillCatalogPrompt) {
      additionalSystemPrompts.push(skillCatalogPrompt);
    }

    if (shouldUseTools) {
      additionalSystemPrompts.push(this.buildToolInstructionsSystemPrompt(registry));
    }

    if (additionalSystemPrompts.length > 0) {
      for (const item of additionalSystemPrompts) {
        messages.unshift({ role: 'system', content: item });
      }
    }

    type RepairToolCall = AiGenerateTextParams['experimental_repairToolCall'];

    const { generateText } = await getBundledLib('ai');

    const result = await generateText({
      model: llmConfig.model,
      temperature: llmConfig.temperature,
      maxOutputTokens: llmConfig.maxOutputTokens,
      abortSignal: agent.plugin.abortService.createAbortController(),
      system: agent.buildCorePrompt(),
      messages,
      tools: registry.getToolsObject() as NonNullable<AiGenerateTextParams['tools']>,
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
      totalUsage: result.totalUsage,
    };
  }
}

applyMixins(GenerateTextExecutor, [ToolIntentResolution, SystemPromptComposer]);
