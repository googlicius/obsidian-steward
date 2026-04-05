import type { StewardPluginSettings } from 'src/types/interfaces';

/** OpenAI-compatible chat base URL for DeepSeek */
const DEEPSEEK_DEFAULT_BASE = 'https://api.deepseek.com/v1';

/** OpenAI-compatible chat base URL for Groq */
const GROQ_DEFAULT_BASE = 'https://api.groq.com/openai/v1';

function isDeepseekOrGroqModel(model: string | undefined): boolean {
  if (!model || typeof model !== 'string') {
    return false;
  }
  const colonIndex = model.indexOf(':');
  if (colonIndex <= 0) {
    return false;
  }
  const prefix = model.slice(0, colonIndex);
  return prefix === 'deepseek' || prefix === 'groq';
}

/**
 * Presets for deepseek/groq were removed from LLM_MODELS; the model dropdown only shows
 * preset ids + customModels. Ensure the active model id remains selectable.
 */
function addDeepseekGroqModelToCustomModelsIfNeeded(
  model: string | undefined,
  customModels: string[] | undefined
): string[] {
  const list = customModels ? [...customModels] : [];
  if (!isDeepseekOrGroqModel(model) || !model) {
    return list;
  }
  if (!list.includes(model)) {
    list.push(model);
  }
  return list;
}

function migrateDeepseekGroqModelsIntoCustomLists(settings: StewardPluginSettings): void {
  if (!settings.llm?.chat) {
    return;
  }

  settings.llm.chat.customModels = addDeepseekGroqModelToCustomModelsIfNeeded(
    settings.llm.chat.model,
    settings.llm.chat.customModels
  );

  const compaction = settings.llm.agents?.compactionSummary;
  if (compaction?.model) {
    compaction.customModels = addDeepseekGroqModelToCustomModelsIfNeeded(
      compaction.model,
      compaction.customModels
    );
  }

  const conversationTitle = settings.llm.agents?.conversationTitle;
  if (conversationTitle?.model) {
    conversationTitle.customModels = addDeepseekGroqModelToCustomModelsIfNeeded(
      conversationTitle.model,
      conversationTitle.customModels
    );
  }
}

function collectReferencedProviderKeys(settings: StewardPluginSettings): Set<string> {
  const keys = new Set<string>();

  const addModel = (value: string | undefined) => {
    if (!value || typeof value !== 'string') {
      return;
    }
    const idx = value.indexOf(':');
    if (idx > 0) {
      keys.add(value.slice(0, idx));
    }
  };

  const addList = (list: string[] | undefined) => {
    if (!list) {
      return;
    }
    for (let i = 0; i < list.length; i++) {
      addModel(list[i]);
    }
  };

  addModel(settings.llm?.chat?.model);
  addList(settings.llm?.chat?.customModels);
  addModel(settings.llm?.image?.model);
  addList(settings.llm?.image?.customModels);
  addList(settings.llm?.modelFallback?.fallbackChain);
  addModel(settings.llm?.agents?.compactionSummary?.model);
  addList(settings.llm?.agents?.compactionSummary?.customModels);
  addModel(settings.llm?.agents?.conversationTitle?.model);
  addList(settings.llm?.agents?.conversationTitle?.customModels);
  addModel(settings.embedding?.model);
  addList(settings.embedding?.customModels);
  addModel(settings.llm?.speech?.model);
  addList(settings.llm?.speech?.customModels);

  return keys;
}

function providerLooksConfigured(
  cfg: StewardPluginSettings['providers'][string] | undefined
): boolean {
  if (!cfg) {
    return false;
  }
  if (cfg.baseUrl && cfg.baseUrl.trim() !== '') {
    return true;
  }
  if (cfg.apiKeySource === 'secret' && cfg.apiKey && cfg.apiKey.trim() !== '') {
    return true;
  }
  if (cfg.apiKey && cfg.apiKey.trim() !== '') {
    return true;
  }
  return false;
}

function migrateProviderToOpenAiCompatible(input: {
  settings: StewardPluginSettings;
  providerKey: 'deepseek' | 'groq';
  referencedKeys: Set<string>;
  defaultBaseUrl: string;
  displayName: string;
  description: string;
}): void {
  const { settings, providerKey, referencedKeys, defaultBaseUrl, displayName, description } = input;

  const cfg = settings.providers[providerKey];
  if (!cfg) {
    return;
  }

  const keep =
    referencedKeys.has(providerKey) || providerLooksConfigured(cfg) || cfg.isCustom === true;

  if (!keep) {
    delete settings.providers[providerKey];
    return;
  }

  const name = cfg.name && cfg.name.trim() !== '' ? cfg.name : displayName;
  const desc = cfg.description && cfg.description.trim() !== '' ? cfg.description : description;
  const baseUrl = cfg.baseUrl && cfg.baseUrl.trim() !== '' ? cfg.baseUrl : defaultBaseUrl;

  settings.providers[providerKey] = {
    ...cfg,
    isCustom: true,
    compatibility: 'openai',
    name,
    description: desc,
    baseUrl,
  };
}

/**
 * Convert legacy built-in DeepSeek/Groq rows into OpenAI-compatible custom providers,
 * and drop unused default stubs.
 */
export function migrateSettingsFrom1To2(settings: StewardPluginSettings): void {
  const referenced = collectReferencedProviderKeys(settings);

  migrateProviderToOpenAiCompatible({
    settings,
    providerKey: 'deepseek',
    referencedKeys: referenced,
    defaultBaseUrl: DEEPSEEK_DEFAULT_BASE,
    displayName: 'DeepSeek',
    description:
      'Capabilities: Text generation, reasoning. OpenAI-compatible API. https://platform.deepseek.com',
  });

  migrateProviderToOpenAiCompatible({
    settings,
    providerKey: 'groq',
    referencedKeys: referenced,
    defaultBaseUrl: GROQ_DEFAULT_BASE,
    displayName: 'Groq',
    description:
      'Capabilities: Text generation, reasoning. OpenAI-compatible API. https://console.groq.com',
  });

  migrateDeepseekGroqModelsIntoCustomLists(settings);
}
