import { getLanguage, normalizePath, PluginSettingTab, Setting } from 'obsidian';
import { logger } from './utils/logger';
import {
  LLM_MODELS,
  EMBEDDING_MODELS,
  SPEECH_MODELS,
  IMAGE_MODELS,
  DEFAULT_VOICES,
} from './constants';
import { getTranslation } from './i18n';
import type StewardPlugin from './main';
import { StewardPluginSettings } from './types/interfaces';
import { FolderSuggest } from './settings/FolderSuggest';
import { ModelSetting } from './settings/ModelSetting';
import { ModelFallbackSetting } from './settings/ModelFallbackSetting';
import { DeleteBehaviorSetting } from './settings/DeleteBehaviorSetting';
import { applyMixins } from './utils/applyMixins';
import { ApiKeySetting } from './settings/ApiKeySetting';

const lang = getLanguage();
const t = getTranslation(lang);

// Define interface that combines all mixins
interface StewardSettingTab
  extends PluginSettingTab,
    ApiKeySetting,
    ModelSetting,
    ModelFallbackSetting,
    DeleteBehaviorSetting {}

class StewardSettingTab extends PluginSettingTab {
  private providerBaseUrlSetting: Setting;

  constructor(protected plugin: StewardPlugin) {
    super(plugin.app, plugin);
  }

  /**
   * Get the default base URL for a provider
   * @param provider - The provider name
   * @returns The default base URL
   */
  private getDefaultBaseUrl(provider: string): string {
    const defaultUrls: Record<string, string> = {
      openai: 'Default OpenAI base URL',
      deepseek: 'Default DeepSeek base URL',
      google: 'Default Google base URL',
      groq: 'Default Groq base URL',
      ollama: 'http://localhost:11434',
      anthropic: 'Default Anthropic base URL',
    };

    return defaultUrls[provider] || '';
  }

  private createProviderBaseUrlSetting(containerEl: HTMLElement) {
    const setting = new Setting(containerEl)
      .setName(t('settings.providerBaseUrl'))
      .setDesc(t('settings.providerBaseUrlDesc'))
      .addText(text => {
        // Initialize input with current values
        const currentProvider = this.plugin.settings.llm.chat.model.split(':')[0];
        if (currentProvider) {
          if (!this.plugin.settings.llm.providerConfigs) {
            this.plugin.settings.llm.providerConfigs = {};
          }

          const currentBaseUrl =
            this.plugin.settings.llm.providerConfigs[currentProvider]?.baseUrl || '';
          const defaultBaseUrl = this.getDefaultBaseUrl(currentProvider);

          text.setValue(currentBaseUrl);
          text.setPlaceholder(defaultBaseUrl);
        }

        text.onChange(async value => {
          const currentProvider = this.plugin.settings.llm.chat.model.split(':')[0];
          if (!currentProvider) return;

          // Ensure providerConfigs exists
          if (!this.plugin.settings.llm.providerConfigs) {
            this.plugin.settings.llm.providerConfigs = {};
          }

          // Initialize provider config if it doesn't exist
          if (!this.plugin.settings.llm.providerConfigs[currentProvider]) {
            this.plugin.settings.llm.providerConfigs[currentProvider] = {};
          }

          this.plugin.settings.llm.providerConfigs[currentProvider].baseUrl = value;
          await this.plugin.saveSettings();
        });
      });

    this.providerBaseUrlSetting = setting;

    return setting;
  }

  private updateProviderBaseUrlVisibility(): void {
    const currentProvider = this.plugin.settings.llm.chat.model.split(':')[0];

    if (currentProvider) {
      // Ensure providerConfigs exists
      if (!this.plugin.settings.llm.providerConfigs) {
        this.plugin.settings.llm.providerConfigs = {};
      }

      // Update the input value and placeholder when switching models
      const currentBaseUrl =
        this.plugin.settings.llm.providerConfigs[currentProvider]?.baseUrl || '';
      const defaultBaseUrl = this.getDefaultBaseUrl(currentProvider);

      const textInput = this.providerBaseUrlSetting.settingEl.querySelector(
        'input[type="text"]'
      ) as HTMLInputElement;
      if (textInput) {
        textInput.value = currentBaseUrl;
        textInput.placeholder = defaultBaseUrl;
      }
    }
  }

  /**
   * Update the voice input field based on the selected speech model
   */
  private updateVoiceInput(): void {
    const voiceInput = document.getElementById('stw-voice-input') as HTMLInputElement;
    if (!voiceInput) return;

    const currentSpeechModel = this.plugin.settings.llm.speech.model;
    const provider = currentSpeechModel.split(':')[0];

    const currentVoice =
      this.plugin.settings.llm.speech.voices[
        provider as keyof StewardPluginSettings['llm']['speech']['voices']
      ] || DEFAULT_VOICES[provider];
    voiceInput.value = currentVoice || '';
  }

  display(): void {
    const { containerEl } = this;

    containerEl.empty();

    // Add setting for conversation folder
    new Setting(containerEl)
      .setName(t('settings.stewardFolder'))
      .setDesc(t('settings.stewardFolderDesc'))
      .addText(text => {
        text
          .setPlaceholder('Steward')
          .setValue(this.plugin.settings.stewardFolder)
          .onChange(async value => {
            this.plugin.settings.stewardFolder = normalizePath(value) ?? 'Steward';
            await this.plugin.saveSettings();
          });

        new FolderSuggest(this.app, text.inputEl);
      });

    // Add show role labels toggle
    new Setting(containerEl)
      .setName(t('settings.showRoleLabels'))
      .setDesc(t('settings.showRoleLabelsDesc'))
      .addToggle(toggle =>
        toggle.setValue(this.plugin.settings.showPronouns).onChange(async value => {
          this.plugin.settings.showPronouns = value;
          await this.plugin.saveSettings();
        })
      );

    // Add debug mode toggle
    new Setting(containerEl)
      .setName(t('settings.debugMode'))
      .setDesc(t('settings.debugModeDesc'))
      .addToggle(toggle =>
        toggle.setValue(this.plugin.settings.debug).onChange(async value => {
          this.plugin.settings.debug = value;
          await this.plugin.saveSettings();
          logger.setDebug(value);
        })
      );

    // Add delete behavior setting
    this.createDeleteBehaviorSetting(containerEl);

    // Create API Keys section
    new Setting(containerEl).setName(t('settings.apiKeys')).setHeading();

    this.createApiKeySetting(containerEl, 'openai', t('settings.openaiApiKey'));

    this.createApiKeySetting(containerEl, 'elevenlabs', t('settings.elevenlabsApiKey'));

    this.createApiKeySetting(containerEl, 'deepseek', t('settings.deepseekApiKey'));

    this.createApiKeySetting(containerEl, 'google', t('settings.googleApiKey'));

    this.createApiKeySetting(containerEl, 'groq', t('settings.groqApiKey'));

    this.createApiKeySetting(containerEl, 'anthropic', t('settings.anthropicApiKey'));

    containerEl.createEl('div', {
      text: `${t('settings.note')}:`,
      cls: 'setting-item-description',
    });

    containerEl.createEl('div', {
      text: t('settings.apiKeyNote1'),
      cls: 'setting-item-description',
    });

    containerEl.createEl('div', {
      text: t('settings.apiKeyNote2'),
      cls: 'setting-item-description',
    });

    // Add LLM settings section
    new Setting(containerEl).setName(t('settings.llm')).setHeading();

    // Chat Model setting
    this.createModelSetting(
      new Setting(containerEl)
        .setName(t('settings.chatModel'))
        .setDesc(t('settings.chatModelDesc')),
      {
        currentModelField: 'llm.chat.model',
        customModelsField: 'llm.chat.customModels',
        placeholder: 'e.g., openai:gpt-5',
        presetModels: LLM_MODELS,
        onSelectChange: async (modelId: string) => {
          this.plugin.settings.llm.chat.model = modelId;
          await this.plugin.saveSettings();
          // Update provider base URL settings visibility based on selected model
          this.updateProviderBaseUrlVisibility();
        },
        onAddModel: async (modelId: string) => {
          this.plugin.settings.llm.chat.model = modelId;

          // Add to custom models if not already present and not a preset model
          const isPresetModel = LLM_MODELS.some(model => model.id === modelId);
          const customModels = this.plugin.settings.llm.chat.customModels || [];

          if (!isPresetModel && !customModels.includes(modelId)) {
            customModels.push(modelId);
            this.plugin.settings.llm.chat.customModels = customModels;
          }

          await this.plugin.saveSettings();
          // Update provider base URL settings visibility based on selected model
          this.updateProviderBaseUrlVisibility();
        },
        onDeleteModel: async (modelId: string) => {
          this.plugin.settings.llm.chat.customModels =
            this.plugin.settings.llm.chat.customModels.filter(id => id !== modelId);

          // If this was the selected model, switch to default
          if (this.plugin.settings.llm.chat.model === modelId) {
            this.plugin.settings.llm.chat.model = LLM_MODELS[0].id;
          }

          await this.plugin.saveSettings();
          // Update provider base URL settings visibility based on selected model
          this.updateProviderBaseUrlVisibility();
        },
      }
    );

    this.createProviderBaseUrlSetting(containerEl);

    // Temperature setting
    new Setting(containerEl)
      .setName(t('settings.temperature'))
      .setDesc(t('settings.temperatureDesc'))
      .addSlider(slider => {
        slider
          .setLimits(0, 1, 0.1)
          .setValue(this.plugin.settings.llm.temperature)
          .setDynamicTooltip()
          .onChange(async value => {
            this.plugin.settings.llm.temperature = value;
            await this.plugin.saveSettings();
          });
      });

    // Max Generation Tokens setting
    new Setting(containerEl)
      .setName(t('settings.maxGenerationTokens'))
      .setDesc(t('settings.maxGenerationTokensDesc'))
      .addText(text => {
        text
          .setPlaceholder('2048')
          .setValue(String(this.plugin.settings.llm.maxGenerationTokens || 2048))
          .onChange(async value => {
            // Convert to number and validate
            const numValue = Number(value);
            if (!isNaN(numValue) && numValue > 0) {
              this.plugin.settings.llm.maxGenerationTokens = numValue;
              await this.plugin.saveSettings();
            }
          });

        // Set input type to number
        text.inputEl.setAttribute('type', 'number');
        text.inputEl.setAttribute('min', '1');
      });

    // Show Extraction Explanation setting
    new Setting(containerEl)
      .setName(t('settings.showExtractionExplanation'))
      .setDesc(t('settings.showExtractionExplanationDesc'))
      .addToggle(toggle => {
        toggle
          .setValue(this.plugin.settings.llm.showExtractionExplanation ?? false)
          .onChange(async value => {
            this.plugin.settings.llm.showExtractionExplanation = value;
            await this.plugin.saveSettings();
          });
      });

    // Enable Model Fallback setting
    new Setting(containerEl)
      .setName(t('settings.modelFallbackEnabled'))
      .setDesc(t('settings.modelFallbackEnabledDesc'))
      .addToggle(toggle => {
        toggle
          .setValue(this.plugin.settings.llm.modelFallback?.enabled ?? false)
          .onChange(async value => {
            // Initialize modelFallback if it doesn't exist
            if (!this.plugin.settings.llm.modelFallback) {
              this.plugin.settings.llm.modelFallback = {
                enabled: false,
                fallbackChain: [],
              };
            }
            this.plugin.settings.llm.modelFallback.enabled = value;
            await this.plugin.saveSettings();
          });
      });

    // Fallback Chain setting
    this.createModelFallbackSetting(
      new Setting(containerEl)
        .setName(t('settings.fallbackChain'))
        .setDesc(t('settings.fallbackChainDesc'))
    );

    // Intent classification settings section
    new Setting(containerEl).setName(t('settings.intentClassification')).setHeading();

    // Intent classification Enable/Disable setting
    new Setting(containerEl)
      .setName(t('settings.classificationEnabled'))
      .setDesc(t('settings.classificationEnabledDesc'))
      .addToggle(toggle => {
        toggle.setValue(this.plugin.settings.embedding.enabled ?? true).onChange(async value => {
          this.plugin.settings.embedding.enabled = value;
          await this.plugin.saveSettings();
        });
      });

    // Embedding Model setting
    this.createModelSetting(
      new Setting(containerEl)
        .setName(t('settings.embeddingModel'))
        .setDesc(t('settings.embeddingModelDesc')),
      {
        currentModelField: 'embedding.model',
        customModelsField: 'embedding.customModels',
        placeholder: 'e.g., openai:text-embedding-ada-002',
        presetModels: EMBEDDING_MODELS,
        onSelectChange: async (modelId: string) => {
          this.plugin.settings.embedding.model = modelId;
          await this.plugin.saveSettings();
          this.updateVoiceInput();
        },
        onAddModel: async (modelId: string) => {
          this.plugin.settings.embedding.model = modelId;

          // Add to custom models if not already present and not a preset model
          const isPresetModel = EMBEDDING_MODELS.some(model => model.id === modelId);
          const customModels = this.plugin.settings.embedding.customModels || [];

          if (!isPresetModel && !customModels.includes(modelId)) {
            customModels.push(modelId);
            this.plugin.settings.embedding.customModels = customModels;
          }

          await this.plugin.saveSettings();
        },
        onDeleteModel: async (modelId: string) => {
          this.plugin.settings.embedding.customModels =
            this.plugin.settings.embedding.customModels.filter(id => id !== modelId);

          // If this was the selected model, switch to default
          if (this.plugin.settings.embedding.model === modelId) {
            this.plugin.settings.embedding.model = EMBEDDING_MODELS[0].id;
          }

          await this.plugin.saveSettings();
        },
      }
    );

    // Embedding Similarity Threshold setting
    new Setting(containerEl)
      .setName(t('settings.embeddingSimilarityThreshold'))
      .setDesc(t('settings.embeddingSimilarityThresholdDesc'))
      .addSlider(slider => {
        slider
          .setLimits(0.7, 0.99, 0.01)
          .setValue(this.plugin.settings.embedding.similarityThreshold ?? 0.85)
          .setDynamicTooltip()
          .onChange(async value => {
            this.plugin.settings.embedding.similarityThreshold = value;
            await this.plugin.saveSettings();
          });
      });

    // Speech settings section
    new Setting(containerEl).setName(t('settings.speech')).setHeading();

    // Create speech model setting
    this.createModelSetting(
      new Setting(containerEl)
        .setName(t('settings.speechModel'))
        .setDesc(t('settings.speechModelDesc')),
      {
        currentModelField: 'llm.speech.model',
        customModelsField: 'llm.speech.customModels',
        placeholder: 'e.g., openai:tts-1',
        presetModels: SPEECH_MODELS,
        onSelectChange: async (modelId: string) => {
          this.plugin.settings.llm.speech.model = modelId;
          await this.plugin.saveSettings();
          this.updateVoiceInput();
        },
        onAddModel: async (modelId: string) => {
          this.plugin.settings.llm.speech.model = modelId;
          // Add to custom models if not already present and not a preset model
          const isPresetModel = SPEECH_MODELS.some(model => model.id === modelId);
          const customModels = this.plugin.settings.llm.speech.customModels || [];

          if (!isPresetModel && !customModels.includes(modelId)) {
            customModels.push(modelId);
            this.plugin.settings.llm.speech.customModels = customModels;
          }
          await this.plugin.saveSettings();
        },
        onDeleteModel: async (modelId: string) => {
          this.plugin.settings.llm.speech.customModels =
            this.plugin.settings.llm.speech.customModels.filter(id => id !== modelId);

          // If this was the selected model, switch to default
          if (this.plugin.settings.llm.speech.model === modelId) {
            this.plugin.settings.llm.speech.model = 'openai:tts-1';
          }

          await this.plugin.saveSettings();
          this.updateVoiceInput();
        },
      }
    );

    // Voice ID setting
    new Setting(containerEl)
      .setName(t('settings.voiceId'))
      .setDesc(t('settings.voiceIdDesc'))
      .addText(text => {
        text.inputEl.id = 'stw-voice-input';

        // Initialize the voice input
        this.updateVoiceInput();

        text.onChange(async value => {
          const currentSpeechModel = this.plugin.settings.llm.speech.model;
          const provider = currentSpeechModel.split(':')[0];

          this.plugin.settings.llm.speech.voices[
            provider as keyof StewardPluginSettings['llm']['speech']['voices']
          ] = value;
          await this.plugin.saveSettings();
        });
      });

    // Add Image section
    new Setting(containerEl).setName(t('settings.image')).setHeading();

    // Image Model setting
    this.createModelSetting(
      new Setting(containerEl)
        .setName(t('settings.imageModel'))
        .setDesc(t('settings.imageModelDesc')),
      {
        currentModelField: 'llm.image.model',
        customModelsField: 'llm.image.customModels',
        placeholder: 'e.g., openai:dall-e-3',
        presetModels: IMAGE_MODELS,
        onSelectChange: async (modelId: string) => {
          this.plugin.settings.llm.image.model = modelId;
          await this.plugin.saveSettings();
        },
        onAddModel: async (modelId: string) => {
          this.plugin.settings.llm.image.model = modelId;

          // Add to custom models if not already present and not a preset model
          const isPresetModel = IMAGE_MODELS.some(model => model.id === modelId);
          const customModels = this.plugin.settings.llm.image.customModels || [];

          if (!isPresetModel && !customModels.includes(modelId)) {
            customModels.push(modelId);
            this.plugin.settings.llm.image.customModels = customModels;
          }

          await this.plugin.saveSettings();
        },
        onDeleteModel: async (modelId: string) => {
          this.plugin.settings.llm.image.customModels =
            this.plugin.settings.llm.image.customModels.filter(id => id !== modelId);

          // If this was the selected model, switch to default
          if (this.plugin.settings.llm.image.model === modelId) {
            this.plugin.settings.llm.image.model = IMAGE_MODELS[0].id;
          }

          await this.plugin.saveSettings();
        },
      }
    );

    // Image Size setting
    new Setting(containerEl)
      .setName(t('settings.imageSize'))
      .setDesc(t('settings.imageSizeDesc'))
      .addText(text => {
        text.setValue(this.plugin.settings.llm.image.size);
        text.setPlaceholder('e.g., 1024x1024');
        text.onChange(async value => {
          this.plugin.settings.llm.image.size = value;
          await this.plugin.saveSettings();
        });
      });

    // Add Search settings section
    new Setting(containerEl).setName(t('settings.searchSettings')).setHeading();

    // Without LLM setting
    new Setting(containerEl)
      .setName(t('settings.withoutLLM'))
      .setDesc(t('settings.withoutLLMDesc'))
      .addDropdown(dropdown => {
        dropdown
          .addOption('relevant', t('settings.relevantScoring'))
          .addOption('exact', t('settings.exactMatch'))
          .setValue(this.plugin.settings.search.withoutLLM)
          .onChange(async value => {
            this.plugin.settings.search.withoutLLM = value as 'exact' | 'relevant';
            await this.plugin.saveSettings();
          });
      });

    // Results per page setting
    new Setting(containerEl)
      .setName(t('settings.resultsPerPage'))
      .setDesc(t('settings.resultsPerPageDesc'))
      .addText(text => {
        text
          .setPlaceholder('10')
          .setValue(String(this.plugin.settings.search.resultsPerPage))
          .onChange(async value => {
            // Convert to number and validate
            const numValue = Number(value);
            if (!isNaN(numValue) && numValue > 0) {
              this.plugin.settings.search.resultsPerPage = numValue;
              await this.plugin.saveSettings();
            }
          });

        text.inputEl.setAttribute('type', 'number');
        text.inputEl.setAttribute('min', '1');
        text.inputEl.setAttribute('max', '100');
      });
  }
}

// Apply mixins to the class
applyMixins(StewardSettingTab, [
  ApiKeySetting,
  ModelSetting,
  ModelFallbackSetting,
  DeleteBehaviorSetting,
]);

// Export the final class
export default StewardSettingTab;
