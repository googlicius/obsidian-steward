import type { AgentHandlerParams } from '../../types';
import { ToolRegistry, ToolName } from '../../ToolRegistry';
import { applyMixins } from 'src/utils/applyMixins';
import { ToolIntentResolution } from './ToolIntentResolution';
import { SystemPromptComposer } from './SystemPromptComposer';
import { MarkdownBuilder } from 'src/utils/MarkdownBuilder';
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

// eslint-disable-next-line @typescript-eslint/no-unsafe-declaration-merging -- intentional mixin pattern
export interface GenerateTextExecutor extends ToolIntentResolution, SystemPromptComposer {}

// eslint-disable-next-line @typescript-eslint/no-unsafe-declaration-merging -- intentional mixin pattern
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

    return Object.fromEntries(Object.entries(params.tools).filter(([name]) => selected.has(name)));
  }

  protected buildToolInstructionsSystemPrompt(
    registry: ToolRegistry<Record<string, unknown>>,
    memorySourcePath: string
  ): string {
    const otherToolsExclude = ToolRegistry.buildCatalogExcludeSet();
    const inactiveToolCount = registry.listInactiveToolNames(otherToolsExclude).length;
    const toolSection = registry.generateToolSectionBody({
      inactiveToolCount,
      otherToolsExclude,
      otherToolsEmptyLabel: 'No inactive tools available.',
      memorySourcePath,
    });
    const activateHint = `Use ${ToolName.ACTIVATE} to activate optional inactive tools only when needed for pre-check or verification.`;

    const toolBody = toolSection ? `${toolSection}\n\n${activateHint}` : activateHint;
    return new MarkdownBuilder().addSection('## Tool', toolBody).build();
  }

  protected async executeGenerateText<TToolCalls = unknown>(
    params: GenerateTextExecutorParams
  ): Promise<{
    toolCalls: TToolCalls;
    usage: LanguageModelUsage | undefined;
    totalUsage: LanguageModelUsage;
  }> {
    const agent = asAgent(this);
    const historyResult = await agent.renderer.extractConversationHistory(params.title);
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
      activeForSubset = expanded;
      inactiveForSubset = [];
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
    const runCommandAvailable = shouldUseTools && allActiveToolNames.includes(ToolName.RUN_COMMAND);
    const toolsForRegistry = {
      ...selectedTools,
      ...(shouldUseTools ? inactiveMcpTools : {}),
      ...(shouldUseTools ? activeMcpTools : {}),
    };

    const toolInstructionService = agent.plugin.toolInstructionService;
    const memorySourcePath = toolInstructionService.getToolInstructionsRelativePath();

    const registry = ToolRegistry.buildFromTools(toolsForRegistry)
      .setActive(allActiveToolNames)
      .setSupplementalGuidelines({
        guardrails: agent.plugin.guardrailsRuleService.getInstructionsByTool(),
        memory: toolInstructionService.getInstructionsByTool(),
      });

    const messages = [...historyResult.messages];
    if (!params.invocationCount) {
      messages.push({ role: 'user', content: params.intent.query });
    }

    const includeCatalogSections = agent.includesDelegatedCatalogSections();
    const includeSkillCatalog =
      includeCatalogSections &&
      (!params.intent.tools ||
        params.intent.tools.length === 0 ||
        params.intent.tools.includes(ToolName.CONTENT_READING));
    const includeSubAgentCatalog =
      includeCatalogSections &&
      (!params.intent.tools ||
        params.intent.tools.length === 0 ||
        params.intent.tools.includes(ToolName.CONTENT_READING));
    const skillSectionBody = includeSkillCatalog
      ? this.buildSkillSectionBody({ plugin: agent.plugin, activeTools: allActiveToolNames })
      : '';
    const subAgentSectionBody = includeSubAgentCatalog
      ? this.buildSubAgentSectionBody({ plugin: agent.plugin })
      : '';
    const userDefinedCommandSectionBody = includeCatalogSections
      ? this.buildUserDefinedCommandSectionBody({
          plugin: agent.plugin,
          runCommandAvailable,
        })
      : '';

    const additionalSystemPrompts = params.intent.systemPrompts
      ? [...params.intent.systemPrompts]
      : [];
    if (llmConfig.systemPrompt) {
      additionalSystemPrompts.push(llmConfig.systemPrompt);
    }

    if (skillSectionBody) {
      additionalSystemPrompts.push(this.wrapPromptSection('## Skill', skillSectionBody));
    }

    if (subAgentSectionBody) {
      additionalSystemPrompts.push(this.wrapPromptSection('## Sub-agent', subAgentSectionBody));
    }

    if (userDefinedCommandSectionBody) {
      additionalSystemPrompts.push(
        this.wrapPromptSection('## User-defined command', userDefinedCommandSectionBody)
      );
    }

    if (params.intent.models && params.intent.models.length > 1) {
      additionalSystemPrompts.push(
        this.wrapPromptSection(
          '## Model',
          this.buildModelSectionBody({
            models: params.intent.models,
            currentModel: params.intent.model,
          })
        )
      );
    }

    if (shouldUseTools) {
      additionalSystemPrompts.push(
        this.buildToolInstructionsSystemPrompt(registry, memorySourcePath)
      );
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
      ...(llmConfig.temperature !== undefined ? { temperature: llmConfig.temperature } : {}),
      maxOutputTokens: llmConfig.maxOutputTokens,
      abortSignal: agent.plugin.abortService.createAbortController(params.title),
      system: agent.buildCorePrompt(),
      messages,
      ...(llmConfig.reasoningCallExtras?.providerOptions
        ? { providerOptions: llmConfig.reasoningCallExtras.providerOptions }
        : {}),
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
      usage: result.usage,
      totalUsage: result.totalUsage,
    };
  }
}

applyMixins(GenerateTextExecutor, [ToolIntentResolution, SystemPromptComposer]);
