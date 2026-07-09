import type StewardPlugin from 'src/main';
import { LLMService } from 'src/services/LLMService/LLMService';
import { ReasoningService } from 'src/services/LLMService/ReasoningService';

function createMockPlugin(overrides?: {
  providers?: StewardPlugin['settings']['providers'];
}): StewardPlugin {
  const settings = {
    providers: {
      openai: { apiKey: 'test-key' },
      kimi: {
        apiKey: 'test-key',
        isCustom: true,
        compatibility: 'openai',
        name: 'kimi',
        baseUrl: 'https://api.moonshot.ai/v1',
      },
      zai: {
        apiKey: 'test-key',
        isCustom: true,
        compatibility: 'openai',
        name: 'zai',
        baseUrl: 'https://api.z.ai/api/paas/v4',
      },
      groq: {
        apiKey: 'test-key',
        isCustom: true,
        compatibility: 'openai',
        name: 'groq',
        baseUrl: 'https://api.groq.com/openai/v1',
      },
      ...overrides?.providers,
    },
    llm: {
      temperature: 0.2,
      chat: { model: 'openai:gpt-4o' },
    },
    models: [],
  };

  return {
    settings,
  } as unknown as StewardPlugin;
}

describe('ReasoningService', () => {
  let plugin: StewardPlugin;
  let llmService: LLMService;
  let reasoningService: ReasoningService;

  beforeEach(() => {
    LLMService['instance'] = null;
    plugin = createMockPlugin();
    llmService = LLMService.getInstance(plugin);
    reasoningService = llmService.reasoningService;
  });

  describe('getCapabilityForModel', () => {
    it('returns effort for built-in openai models', () => {
      expect(reasoningService.getCapabilityForModel('openai:gpt-5.4')).toBe('effort');
    });

    it('returns thinking-toggle for Kimi / Moonshot custom providers', () => {
      expect(reasoningService.getCapabilityForModel('kimi:k2')).toBe('thinking-toggle');
    });

    it('returns effort for Z.ai custom providers', () => {
      expect(reasoningService.getCapabilityForModel('zai:glm-4')).toBe('effort');
    });

    it('returns effort for Z.ai via local proxy base URL', () => {
      LLMService['instance'] = null;
      plugin = createMockPlugin({
        providers: {
          'z.ai': {
            apiKey: 'test-key',
            isCustom: true,
            compatibility: 'openai',
            name: 'z.ai',
            baseUrl: 'http://localhost:8080/https://api.z.ai/api/paas/v4',
          },
        },
      });
      llmService = LLMService.getInstance(plugin);
      reasoningService = llmService.reasoningService;

      expect(reasoningService.getCapabilityForModel('z.ai:GLM-5.2')).toBe('effort');
      expect(reasoningService.getUiMode('z.ai:GLM-5.2')).toBe('effort');
    });

    it('returns unsupported for unregistered openai-compatible gateways', () => {
      expect(reasoningService.getCapabilityForModel('groq:llama')).toBe('unsupported');
    });
  });

  describe('buildCallExtras', () => {
    it('returns openai reasoningEffort for built-in openai', () => {
      const extras = reasoningService.buildCallExtras('openai:gpt-5.4', 'high');
      expect(extras.providerOptions?.openai).toEqual({ reasoningEffort: 'high' });
    });

    it('returns thinking and reasoning_effort for Z.ai', () => {
      const extras = reasoningService.buildCallExtras('zai:glm-4', 'xhigh');
      expect(extras.providerOptions?.zai).toEqual({
        reasoningEffort: 'max',
        thinking: { type: 'enabled' },
      });
    });

    it('uses openai-compatible provider name segment for dotted custom providers', () => {
      LLMService['instance'] = null;
      plugin = createMockPlugin({
        providers: {
          'z.ai': {
            apiKey: 'test-key',
            isCustom: true,
            compatibility: 'openai',
            name: 'z.ai',
            baseUrl: 'https://api.z.ai/api/paas/v4',
          },
        },
      });
      llmService = LLMService.getInstance(plugin);
      reasoningService = llmService.reasoningService;

      const extras = reasoningService.buildCallExtras('z.ai:GLM-5.2', 'low');
      expect(extras.providerOptions?.z).toEqual({
        reasoningEffort: 'low',
        thinking: { type: 'enabled' },
      });
    });

    it('returns thinking only for Kimi without reasoning_effort', () => {
      const extras = reasoningService.buildCallExtras('kimi:k2', 'medium');
      expect(extras.providerOptions?.kimi).toEqual({
        thinking: { type: 'enabled' },
      });
      expect(extras.providerOptions?.kimi?.reasoningEffort).toBeUndefined();
    });

    it('returns empty extras when reasoning is none for built-in openai', () => {
      expect(reasoningService.buildCallExtras('openai:gpt-5.4', 'none')).toEqual({});
    });

    it('returns disabled thinking when reasoning is none for thinking-toggle providers', () => {
      expect(reasoningService.buildCallExtras('kimi:k2', 'none')).toEqual({
        providerOptions: {
          kimi: {
            thinking: { type: 'disabled' },
          },
        },
      });
    });

    it('returns disabled thinking when reasoning is none for Z.ai effort providers', () => {
      expect(reasoningService.buildCallExtras('zai:glm-4', 'none')).toEqual({
        providerOptions: {
          zai: {
            thinking: { type: 'disabled' },
          },
        },
      });
    });
  });

  describe('ui mapping', () => {
    it('maps thinking-toggle UI values to stored levels', () => {
      expect(reasoningService.uiValueToReasoningLevel('provider-default', 'thinking-toggle')).toBe(
        'provider-default'
      );
      expect(reasoningService.uiValueToReasoningLevel('enabled', 'thinking-toggle')).toBe('medium');
      expect(reasoningService.uiValueToReasoningLevel('none', 'thinking-toggle')).toBe('none');
      expect(reasoningService.uiValueToReasoningLevel('unknown', 'thinking-toggle')).toBe(
        'provider-default'
      );
      expect(reasoningService.reasoningLevelToUiValue('provider-default', 'thinking-toggle')).toBe(
        'provider-default'
      );
      expect(reasoningService.reasoningLevelToUiValue('medium', 'thinking-toggle')).toBe('enabled');
    });

    it('maps effort UI values including provider-default', () => {
      expect(reasoningService.uiValueToReasoningLevel('provider-default', 'effort')).toBe(
        'provider-default'
      );
      expect(reasoningService.uiValueToReasoningLevel('high', 'effort')).toBe('high');
      expect(reasoningService.uiValueToReasoningLevel('unknown', 'effort')).toBe(
        'provider-default'
      );
      expect(reasoningService.reasoningLevelToUiValue('provider-default', 'effort')).toBe(
        'provider-default'
      );
    });
  });

  describe('provider-default', () => {
    it('returns empty extras for all supported providers', () => {
      expect(reasoningService.buildCallExtras('openai:gpt-5.4', 'provider-default')).toEqual({});
      expect(reasoningService.buildCallExtras('kimi:k2', 'provider-default')).toEqual({});
      expect(reasoningService.buildCallExtras('zai:glm-4', 'provider-default')).toEqual({});
    });
  });
});
