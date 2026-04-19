import { ToolName } from '../../ToolRegistry';

/**
 * Mixin: resolves declared intent tools into allowed / active tool sets for Super Agent and SubAgent executors.
 * Apply with `applyMixins(StreamTextExecutor, [ToolIntentResolution])` or `applyMixins(GenerateTextExecutor, [ToolIntentResolution])`.
 */
export class ToolIntentResolution {
  /** Declared tool count at or below this uses an all-active registry surface (Super Agent). */
  protected get declaredToolsSmallThreshold(): number {
    return 5;
  }

  protected normalizeDeclaredTools(
    declared: ToolName[] | undefined,
    validKeys: ReadonlySet<ToolName>
  ): ToolName[] | null {
    if (!declared || declared.length === 0) {
      return null;
    }
    const out: ToolName[] = [];
    const seen = new Set<ToolName>();
    for (let i = 0; i < declared.length; i++) {
      const t = declared[i];
      if (!validKeys.has(t) || seen.has(t)) {
        continue;
      }
      seen.add(t);
      out.push(t);
    }
    if (out.length === 0) {
      return null;
    }
    return out;
  }

  /**
   * Super Agent: adds `switch_agent_capacity` when the declared list is non-empty and length <= threshold
   * (so the user can unlock the full tool set). Adds `activate_tools` when declared length > threshold.
   * When `declaredNormalized` is null (full tool set), returns [] — callers use all keys excluding switch.
   */
  protected expandSuperAgentDeclaredTools(declaredNormalized: ToolName[] | null): ToolName[] {
    if (declaredNormalized === null) {
      return [];
    }
    const set = new Set(declaredNormalized);
    if (
      declaredNormalized.length <= this.declaredToolsSmallThreshold &&
      !set.has(ToolName.SWITCH_AGENT_CAPACITY)
    ) {
      set.add(ToolName.SWITCH_AGENT_CAPACITY);
    }
    if (
      declaredNormalized.length > this.declaredToolsSmallThreshold &&
      !set.has(ToolName.ACTIVATE)
    ) {
      set.add(ToolName.ACTIVATE);
    }
    return Array.from(set);
  }

  /** SubAgent: only adds `activate_tools` when declared length > threshold (no switch tool on subagents). */
  protected expandSubagentDeclaredTools(declaredNormalized: ToolName[] | null): ToolName[] {
    if (declaredNormalized === null) {
      return [];
    }
    const set = new Set(declaredNormalized);
    if (
      declaredNormalized.length > this.declaredToolsSmallThreshold &&
      !set.has(ToolName.ACTIVATE)
    ) {
      set.add(ToolName.ACTIVATE);
    }
    return Array.from(set);
  }

  protected isSwitchAgentCapacityOnly(declaredExpanded: ToolName[]): boolean {
    return declaredExpanded.length === 1 && declaredExpanded[0] === ToolName.SWITCH_AGENT_CAPACITY;
  }

  protected filterToolsObject<T extends Record<string, unknown>>(
    tools: T,
    allowed: ReadonlySet<ToolName>
  ): Partial<T> {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(tools)) {
      if (allowed.has(key as ToolName)) {
        out[key] = tools[key as keyof T];
      }
    }
    return out as Partial<T>;
  }

  protected buildSuperAgentEffectiveAllowedNames(params: {
    declaredNormalized: ToolName[] | null;
    expandedDeclared: ToolName[];
    conversationActiveTools: ToolName[];
    allToolKeys: readonly ToolName[];
    toolsThatEnableConclude: ReadonlySet<ToolName>;
    hasConcludeEligibleDeclaredTool: boolean;
    hasCompactionContext: boolean;
  }): ToolName[] {
    const {
      declaredNormalized,
      expandedDeclared,
      conversationActiveTools,
      allToolKeys,
      hasConcludeEligibleDeclaredTool,
      hasCompactionContext,
    } = params;
    const allSet = new Set(allToolKeys);

    if (declaredNormalized === null) {
      return allToolKeys.filter(name => name !== ToolName.SWITCH_AGENT_CAPACITY);
    }
    const effective = new Set<ToolName>(expandedDeclared);
    for (let i = 0; i < conversationActiveTools.length; i++) {
      const activeToolName = conversationActiveTools[i];
      if (!allSet.has(activeToolName)) {
        continue;
      }
      effective.add(activeToolName);
    }

    if (hasConcludeEligibleDeclaredTool && allSet.has(ToolName.CONCLUDE)) {
      effective.add(ToolName.CONCLUDE);
    }
    if (hasCompactionContext && allSet.has(ToolName.RECALL_COMPACTED_CONTEXT)) {
      effective.add(ToolName.RECALL_COMPACTED_CONTEXT);
    }
    return Array.from(effective);
  }

  /**
   * Resolve the active tool names for stream-based execution.
   * Active tools are immediately available in the registry, while inactive tools require explicit activation.
   */
  protected resolveStreamActiveToolNames(params: {
    /** Normalized declared tools from intent (null means full tool set) */
    declaredNormalized: ToolName[] | null;
    /** Expanded declared tools with auto-added management tools (activate_tools, switch_agent_capacity) */
    expandedDeclared: ToolName[];
    /** Final set of tools allowed for this execution after all filters applied */
    effectiveAllowed: ReadonlySet<ToolName>;
    /** Tools that were active in the conversation (from previous turns) */
    conversationActiveTools: ToolName[];
    /** Set of tool names that enable conclude (e.g., edit, create, delete - tools that modify vault) */
    toolsThatEnableConclude: ReadonlySet<ToolName>;
    /** Whether compacted context is available for recall */
    hasCompactionContext: boolean;
  }): ToolName[] {
    // Check if any conclude-eligible tool is currently active in the conversation
    const hasConcludeEligibleActive = params.conversationActiveTools.some(t =>
      params.toolsThatEnableConclude.has(t)
    );

    // No declared tools restriction: use full active set with management tools
    if (params.declaredNormalized === null) {
      return this.uniqueToolNames([
        ...params.conversationActiveTools,
        ToolName.ACTIVATE,
        ...(hasConcludeEligibleActive ? [ToolName.CONCLUDE] : []),
        ...(params.hasCompactionContext ? [ToolName.RECALL_COMPACTED_CONTEXT] : []),
      ]);
    }

    // Only switch_agent_capacity declared: activate it alone
    if (this.isSwitchAgentCapacityOnly(params.expandedDeclared)) {
      return [ToolName.SWITCH_AGENT_CAPACITY];
    }

    // Small declared set: activate all effective tools immediately (no progressive activation)
    // Use original declared count — expanded may include auto-added switch_agent_capacity
    if (params.declaredNormalized.length <= this.declaredToolsSmallThreshold) {
      return this.uniqueToolNames([...params.effectiveAllowed]);
    }

    // Large declared set: use progressive activation strategy
    // Keep previously active conversation tools + management tools
    const filteredConversation = params.conversationActiveTools.filter(t =>
      params.effectiveAllowed.has(t)
    );
    return this.uniqueToolNames([
      ...filteredConversation,
      ...(params.effectiveAllowed.has(ToolName.ACTIVATE) ? [ToolName.ACTIVATE] : []),
      ...(hasConcludeEligibleActive && params.effectiveAllowed.has(ToolName.CONCLUDE)
        ? [ToolName.CONCLUDE]
        : []),
      ...(params.hasCompactionContext &&
      params.effectiveAllowed.has(ToolName.RECALL_COMPACTED_CONTEXT)
        ? [ToolName.RECALL_COMPACTED_CONTEXT]
        : []),
    ]);
  }

  protected uniqueToolNames(items: ToolName[]): ToolName[] {
    return Array.from(new Set(items));
  }
}
