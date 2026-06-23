import type StewardPlugin from 'src/main';
import type { LLMService } from 'src/services/LLMService/LLMService';
import { ModelRegistry } from 'src/services/ModelRegistry';
import { logger } from 'src/utils/logger';
import type { StewardPluginSettings } from 'src/types/interfaces';
import type { ReasoningCapability, ReasoningLevel } from 'src/types/models';
import type {
  ReasoningCallExtras,
  ReasoningProviderContext,
  ReasoningResolution,
  ReasoningUiMode,
  ReasoningUiOption,
} from './reasoningTypes';

type ReasoningFormatId =
  | 'openai-reasoning-effort'
  | 'openai-compatible-effort'
  | 'openai-compatible-thinking-toggle'
  | 'anthropic-thinking'
  | 'google-thinking';

interface ProviderReasoningEntry {
  formatId: ReasoningFormatId;
  capability: ReasoningCapability;
}

/**
 * Maps API hostnames and built-in provider ids to reasoning wire formats.
 * Hostname entries classify custom OpenAI-compatible gateways; built-in entries
 * classify first-party providers. {@link ReasoningProviderContext.providerName}
 * is always the `providerOptions` key at call time.
 */
class ProviderReasoningRegistry {
  private static readonly BUILTIN_ENTRIES: Record<string, ProviderReasoningEntry> = {
    openai: { formatId: 'openai-reasoning-effort', capability: 'effort' },
    anthropic: { formatId: 'anthropic-thinking', capability: 'effort' },
    google: { formatId: 'google-thinking', capability: 'effort' },
  };

  private static readonly HOSTNAME_ENTRIES: Record<string, ProviderReasoningEntry> = {
    'api.z.ai': { formatId: 'openai-compatible-effort', capability: 'effort' },
    'api.moonshot.ai': {
      formatId: 'openai-compatible-thinking-toggle',
      capability: 'thinking-toggle',
    },
  };

  /**
   * Look up a built-in provider entry by standard provider name.
   */
  public resolveBuiltin(standardName: string): ProviderReasoningEntry | undefined {
    return ProviderReasoningRegistry.BUILTIN_ENTRIES[standardName];
  }

  /**
   * Look up a custom provider entry when a known API hostname appears in the base URL.
   */
  public resolveFromBaseUrl(baseUrl: string): ProviderReasoningEntry | undefined {
    const normalized = baseUrl.trim().toLowerCase();
    if (!normalized) {
      return undefined;
    }

    for (const hostname of Object.keys(ProviderReasoningRegistry.HOSTNAME_ENTRIES)) {
      if (normalized.includes(hostname)) {
        return ProviderReasoningRegistry.HOSTNAME_ENTRIES[hostname];
      }
    }

    return undefined;
  }
}

/**
 * Resolves per-model reasoning levels into provider-specific AI SDK call extras.
 * Owned by {@link LLMService} and used by settings UI, executors, and test-model flows.
 */
export class ReasoningService {
  private readonly registry = new ProviderReasoningRegistry();

  /** Canonical stored level when thinking-toggle UI is set to "enabled". */
  public static readonly THINKING_ENABLED_LEVEL: ReasoningLevel = 'medium';

  public constructor(
    private readonly plugin: StewardPlugin,
    private readonly llmService: LLMService
  ) {}

  /**
   * Resolve reasoning capability for a full model id (`provider:modelId`).
   */
  public getCapabilityForModel(modelId: string): ReasoningCapability {
    const context = this.resolveProviderContext(modelId);
    if (!context) {
      return 'unsupported';
    }
    return this.getCapability(context);
  }

  /**
   * Settings UI mode for the add-custom-model flow.
   */
  public getUiMode(modelId: string): ReasoningUiMode {
    const capability = this.getCapabilityForModel(modelId);
    if (capability === 'effort') {
      return 'effort';
    }
    if (capability === 'thinking-toggle') {
      return 'thinking-toggle';
    }
    return 'hidden';
  }

  /**
   * Dropdown options for the current UI mode.
   */
  public getUiOptions(mode: ReasoningUiMode): ReasoningUiOption[] {
    if (mode === 'effort') {
      return ReasoningService.EFFORT_UI_OPTIONS;
    }
    if (mode === 'thinking-toggle') {
      return ReasoningService.THINKING_TOGGLE_UI_OPTIONS;
    }
    return [];
  }

  /**
   * Map a settings dropdown value to a stored {@link ReasoningLevel}.
   */
  public uiValueToReasoningLevel(uiValue: string, mode: ReasoningUiMode): ReasoningLevel {
    if (mode === 'thinking-toggle') {
      if (uiValue === 'enabled') {
        return ReasoningService.THINKING_ENABLED_LEVEL;
      }
      return 'none';
    }
    if (ReasoningService.EFFORT_LEVELS.includes(uiValue as ReasoningLevel)) {
      return uiValue as ReasoningLevel;
    }
    return 'provider-default';
  }

  /**
   * Map a stored level back to a settings dropdown value.
   */
  public reasoningLevelToUiValue(level: ReasoningLevel, mode: ReasoningUiMode): string {
    if (mode === 'thinking-toggle') {
      return level === 'none' ? 'none' : 'enabled';
    }
    return level;
  }

  /**
   * Build AI SDK extras for a model using registry-stored reasoning (or override).
   */
  public buildCallExtrasForModel(
    modelId: string,
    reasoningOverride?: ReasoningLevel
  ): ReasoningCallExtras {
    const registry = ModelRegistry.getInstance(this.plugin);
    const level = reasoningOverride ?? registry.resolveReasoning(modelId);
    return this.buildCallExtras(modelId, level);
  }

  /**
   * Build AI SDK extras for an explicit reasoning level.
   */
  public buildCallExtras(modelId: string, level: ReasoningLevel): ReasoningCallExtras {
    if (level === 'provider-default') {
      return {};
    }

    const context = this.resolveProviderContext(modelId);
    if (!context) {
      return {};
    }

    const entry = this.resolveEntry(context);
    if (!entry || entry.capability === 'unsupported') {
      if (level !== 'none') {
        logger.warn(
          `Reasoning level "${level}" ignored for unsupported provider "${context.providerName}"`
        );
      }
      return {};
    }

    return this.buildExtrasForFormat(entry.formatId, level, context);
  }

  /**
   * Full resolution: capability, level, and call extras for a model.
   */
  public resolveForModel(modelId: string): ReasoningResolution {
    const registry = ModelRegistry.getInstance(this.plugin);
    const level = registry.resolveReasoning(modelId);
    const context = this.resolveProviderContext(modelId);
    const capability = context ? this.getCapability(context) : 'unsupported';
    return {
      capability,
      level,
      extras: this.buildCallExtras(modelId, level),
    };
  }

  /**
   * Determine reasoning capability from provider context.
   */
  public getCapability(context: ReasoningProviderContext): ReasoningCapability {
    const entry = this.resolveEntry(context);
    return entry?.capability ?? 'unsupported';
  }

  private resolveEntry(context: ReasoningProviderContext): ProviderReasoningEntry | undefined {
    if (context.isCustom && context.baseUrl) {
      const hostEntry = this.registry.resolveFromBaseUrl(context.baseUrl);
      if (hostEntry) {
        return hostEntry;
      }
    }

    if (!context.isCustom) {
      return this.registry.resolveBuiltin(context.standardName);
    }

    return undefined;
  }

  private resolveProviderContext(modelId: string): ReasoningProviderContext | null {
    const trimmed = modelId?.trim() ?? '';
    if (!trimmed) {
      return null;
    }

    const { provider: providerName } = this.llmService.parseModel(trimmed);
    if (!providerName) {
      return null;
    }

    const providerConfig = this.getProviderConfig(providerName);
    if (!providerConfig) {
      return null;
    }

    const isCustom = providerConfig.isCustom === true;
    const standardName =
      isCustom && providerConfig.compatibility ? providerConfig.compatibility : providerName;
    const configuredName = providerConfig.name?.trim() ?? '';

    return {
      providerName,
      standardName,
      openAICompatibleName: configuredName || providerName,
      baseUrl: providerConfig.baseUrl,
      isCustom,
    };
  }

  private getProviderConfig(
    providerName: string
  ): StewardPluginSettings['providers'][string] | undefined {
    const providers = this.plugin.settings.providers;
    if (providers[providerName]) {
      return providers[providerName];
    }

    const entries = Object.entries(providers);
    for (let i = entries.length - 1; i >= 0; i--) {
      const [, config] = entries[i];
      if (config.isCustom && config.name?.toLowerCase() === providerName.toLowerCase()) {
        return config;
      }
    }

    return undefined;
  }

  private buildExtrasForFormat(
    formatId: ReasoningFormatId,
    level: ReasoningLevel,
    context: ReasoningProviderContext
  ): ReasoningCallExtras {
    const optionsKey = this.resolveProviderOptionsKey(context);

    if (level === 'none') {
      if (
        formatId === 'openai-compatible-thinking-toggle' ||
        formatId === 'openai-compatible-effort'
      ) {
        return {
          providerOptions: {
            [optionsKey]: {
              thinking: { type: 'disabled' },
            },
          },
        };
      }
      return {};
    }

    switch (formatId) {
      case 'openai-reasoning-effort':
        return {
          providerOptions: {
            [optionsKey]: {
              reasoningEffort: level,
            },
          },
        };

      case 'openai-compatible-effort':
        return {
          providerOptions: {
            [optionsKey]: {
              reasoningEffort: ReasoningService.mapEffortWireValue(level),
              thinking: { type: 'enabled' },
            },
          },
        };

      case 'openai-compatible-thinking-toggle':
        return {
          providerOptions: {
            [optionsKey]: {
              thinking: { type: 'enabled' },
            },
          },
        };

      case 'anthropic-thinking':
        return {
          providerOptions: {
            [optionsKey]: {
              thinking: {
                type: 'enabled',
                budgetTokens: ReasoningService.mapAnthropicBudget(level),
              },
            },
          },
        };

      case 'google-thinking':
        return {
          providerOptions: {
            [optionsKey]: {
              thinkingConfig: {
                thinkingLevel: ReasoningService.mapGoogleThinkingLevel(level),
              },
            },
          },
        };

      default:
        return {};
    }
  }

  /**
   * `providerOptions` key for AI SDK calls.
   * Built-ins use the standard provider id; custom OpenAI-compatible providers use the
   * same name as `createOpenAICompatible({ name })`, first segment before `.` per SDK.
   */
  private resolveProviderOptionsKey(context: ReasoningProviderContext): string {
    if (!context.isCustom) {
      return context.standardName;
    }

    const compatibleName = context.openAICompatibleName.trim() || context.providerName;
    const segment = compatibleName.split('.')[0].trim();
    return segment || context.providerName;
  }

  private static readonly EFFORT_LEVELS: ReasoningLevel[] = [
    'provider-default',
    'none',
    'minimal',
    'low',
    'medium',
    'high',
    'xhigh',
  ];

  private static readonly EFFORT_UI_OPTIONS: ReasoningUiOption[] = [
    { value: 'provider-default', labelKey: 'settings.reasoningLevel.providerDefault' },
    { value: 'none', labelKey: 'settings.reasoningLevel.none' },
    { value: 'minimal', labelKey: 'settings.reasoningLevel.minimal' },
    { value: 'low', labelKey: 'settings.reasoningLevel.low' },
    { value: 'medium', labelKey: 'settings.reasoningLevel.medium' },
    { value: 'high', labelKey: 'settings.reasoningLevel.high' },
    { value: 'xhigh', labelKey: 'settings.reasoningLevel.xhigh' },
  ];

  private static readonly THINKING_TOGGLE_UI_OPTIONS: ReasoningUiOption[] = [
    { value: 'none', labelKey: 'settings.reasoningThinkingDisabled' },
    { value: 'enabled', labelKey: 'settings.reasoningThinkingEnabled' },
  ];

  /**
   * Map Steward reasoning levels to Z.ai / openai-compatible effort wire values.
   */
  private static mapEffortWireValue(level: ReasoningLevel): string {
    if (level === 'xhigh') {
      return 'max';
    }
    return level;
  }

  /**
   * Map Steward reasoning levels to Anthropic thinking token budgets.
   */
  private static mapAnthropicBudget(level: ReasoningLevel): number {
    switch (level) {
      case 'minimal':
        return 1024;
      case 'low':
        return 4096;
      case 'medium':
        return 8192;
      case 'high':
        return 16384;
      case 'xhigh':
        return 32768;
      default:
        return 8192;
    }
  }

  /**
   * Map Steward reasoning levels to Google thinking levels.
   */
  private static mapGoogleThinkingLevel(
    level: ReasoningLevel
  ): 'minimal' | 'low' | 'medium' | 'high' {
    if (level === 'xhigh') {
      return 'high';
    }
    if (level === 'minimal' || level === 'low' || level === 'medium' || level === 'high') {
      return level;
    }
    return 'medium';
  }
}
