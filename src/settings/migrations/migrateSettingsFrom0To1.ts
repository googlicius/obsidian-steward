import { DEFAULT_SETTINGS, SEARCH_DB_NAME_PREFIX } from 'src/constants';
import type StewardPlugin from 'src/main';
import { LLMService } from 'src/services/LLMService';
import { StewardPluginSettings } from 'src/types/interfaces';
import { getBundledLib } from 'src/utils/bundledLibs';
import { uniqueID } from 'src/utils/uniqueID';

export interface MigrateSettingsFrom0To1Input {
  plugin: StewardPlugin;
  settings: StewardPluginSettings;
}

/**
 * Migrate the lag
 * @param input
 */
export async function migrateSettingsFrom0To1(input: MigrateSettingsFrom0To1Input): Promise<void> {
  if (!input.settings.search) {
    input.settings.search = DEFAULT_SETTINGS.search;
  }

  if (!input.settings.search.searchDbName) {
    if (input.settings.searchDbName) {
      input.settings.search.searchDbName = input.settings.searchDbName;
    } else if (input.settings.searchDbPrefix) {
      input.settings.search.searchDbName = input.settings.searchDbPrefix;
    } else {
      const vaultName = input.plugin.app.vault.getName();
      input.settings.search.searchDbName = `${SEARCH_DB_NAME_PREFIX}${vaultName}_${uniqueID()}`;
    }

    input.settings.searchDbName = undefined;
    input.settings.searchDbPrefix = undefined;
  }

  if (!input.settings.saltKeyId) {
    const aiLib = await getBundledLib('ai');
    input.settings.saltKeyId = aiLib.generateId();
  }

  if (!input.settings.encryptionVersion) {
    input.settings.encryptionVersion = 1;
  }

  if (!input.settings.providers) {
    input.settings.providers = {};
  }

  if (input.settings.apiKeys) {
    const legacyApiKeys = input.settings.apiKeys;
    const providersToMigrate: Array<keyof typeof legacyApiKeys> = [
      'openai',
      'elevenlabs',
      'deepseek',
      'google',
      'groq',
      'anthropic',
    ];

    for (const provider of providersToMigrate) {
      if (!input.settings.providers[provider]) {
        input.settings.providers[provider] = {
          apiKey: '',
        };
      }

      if (!legacyApiKeys[provider]) {
        continue;
      }

      if (!input.settings.providers[provider].apiKey) {
        input.settings.providers[provider].apiKey = legacyApiKeys[provider];
      }
    }

    delete input.settings.apiKeys;
  }

  if (input.settings.llm.providerConfigs) {
    for (const [provider, config] of Object.entries(input.settings.llm.providerConfigs)) {
      if (!config?.baseUrl) {
        continue;
      }

      if (!input.settings.providers[provider]) {
        input.settings.providers[provider] = {
          apiKey: '',
        };
      }

      if (!input.settings.providers[provider].baseUrl) {
        input.settings.providers[provider].baseUrl = config.baseUrl;
      }
    }
  }

  if (!input.settings.llm.providerConfigs) {
    input.settings.llm.providerConfigs = {};
  }

  if (!input.settings.llm.chat) {
    input.settings.llm.chat = DEFAULT_SETTINGS.llm.chat;
  }

  if (input.settings.llm.model) {
    const provider = await LLMService.getInstance(input.plugin).getProviderFromModel(
      input.settings.llm.model
    );
    input.settings.llm.chat.model = `${provider.name}:${provider.modelId}`;
    input.settings.llm.model = undefined;
  }

  if (!input.settings.embedding) {
    input.settings.embedding = DEFAULT_SETTINGS.embedding;
  }

  if (input.settings.llm.embedding) {
    input.settings.embedding.model = input.settings.llm.embedding.model;
    input.settings.embedding.customModels = input.settings.llm.embedding.customModels || [];

    if (input.settings.embedding.enabled === undefined) {
      input.settings.embedding.enabled = true;
    }

    input.settings.llm.embedding = undefined;
  }

  if (input.settings.llm.embeddingModel) {
    input.settings.embedding.model = input.settings.llm.embeddingModel;
    input.settings.llm.embeddingModel = undefined;
  }

  if (!input.settings.llm.speech) {
    input.settings.llm.speech = DEFAULT_SETTINGS.llm.speech;
    input.settings.audio = undefined;
  }

  if (!input.settings.llm.image?.model) {
    input.settings.llm.image = DEFAULT_SETTINGS.llm.image;
  }

  if (!input.settings.llm.agents) {
    input.settings.llm.agents = DEFAULT_SETTINGS.llm.agents;
  } else {
    if (!input.settings.llm.agents.compactionSummary) {
      input.settings.llm.agents.compactionSummary = DEFAULT_SETTINGS.llm.agents.compactionSummary;
    }

    if (!input.settings.llm.agents.conversationTitle) {
      input.settings.llm.agents.conversationTitle = DEFAULT_SETTINGS.llm.agents.conversationTitle;
    }
  }

  if (input.settings.llm.ollamaBaseUrl) {
    if (!input.settings.providers.ollama) {
      input.settings.providers.ollama = {
        apiKey: '',
      };
    }

    if (!input.settings.providers.ollama.baseUrl) {
      input.settings.providers.ollama.baseUrl = input.settings.llm.ollamaBaseUrl;
    }

    if (!input.settings.llm.providerConfigs.ollama) {
      input.settings.llm.providerConfigs.ollama = {};
    }

    if (!input.settings.llm.providerConfigs.ollama.baseUrl) {
      input.settings.llm.providerConfigs.ollama.baseUrl = input.settings.llm.ollamaBaseUrl;
    }

    input.settings.llm.ollamaBaseUrl = undefined;
  }

  if (typeof input.settings.deleteBehavior === 'string') {
    input.settings.deleteBehavior = {
      behavior: input.settings.deleteBehavior as 'stw_trash' | 'obsidian_trash',
      cleanupPolicy: 'never',
    };
  }
}
