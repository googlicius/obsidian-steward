import { generateId } from 'ai';
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
import { ModelSetting } from './settings/ModelSetting';
import { ModelFallbackSetting } from './settings/ModelFallbackSetting';
import { DeleteBehaviorSetting } from './settings/DeleteBehaviorSetting';
import { applyMixins } from './utils/applyMixins';
import { ProviderSetting } from './settings/ProviderSetting';
import { getClassifier } from './lib/modelfusion';
import { FolderSuggest } from './settings/FolderSuggest';

const lang = getLanguage();
const t = getTranslation(lang);

// Define interface that combines all mixins
interface StewardSettingTab
  extends PluginSettingTab,
    ProviderSetting,
    ModelSetting,
    ModelFallbackSetting,
    DeleteBehaviorSetting {}

class StewardSettingTab extends PluginSettingTab {
  constructor(protected plugin: StewardPlugin) {
    super(plugin.app, plugin);
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

  /**
   * Clear cached embeddings for a given embedding model
   * @param embeddingSettings The embedding settings containing the model to clear
   */
  private async clearCachedEmbeddings(
    embeddingSettings: StewardPluginSettings['embedding']
  ): Promise<void> {
    try {
      const classifier = getClassifier(embeddingSettings);
      await classifier.clearCachedEmbeddings();
      logger.log(`Cleared cached embeddings for model: ${embeddingSettings.model}`);
    } catch (error) {
      logger.error('Error clearing cached embeddings:', error);
    }
  }

  /**
   * Refresh the settings display and keep the scroll position
   */
  public async refreshSettingTab(delay?: number): Promise<void> {
    if (delay) {
      await sleep(delay);
    }
    const currentScrollPosition = this.containerEl.scrollTop;
    this.display();
    this.containerEl.scrollTop = currentScrollPosition;
  }

  private addNewSettingGroup(): { settingGroup: HTMLElement; settingItems: HTMLElement } {
    const settingGroup = this.containerEl.createEl('div', {
      cls: 'setting-group',
    });

    let _settingItems: HTMLElement | null = null;

    return {
      settingGroup,

      /**
       * Only create setting-items when accessed.
       */
      get settingItems() {
        if (!_settingItems) {
          _settingItems = settingGroup.createEl('div', {
            cls: 'setting-items',
          });
        }
        return _settingItems;
      },
    };
  }

  display(): void {
    const { containerEl } = this;

    containerEl.empty();

    const commonSettingGroup = this.addNewSettingGroup();

    // Add setting for conversation folder
    new Setting(commonSettingGroup.settingItems)
      .setName(t('settings.stewardFolder'))
      .setDesc(t('settings.stewardFolderDesc'))
      .addText(text => {
        text
          .setPlaceholder('Steward')
          .setValue(this.plugin.settings.stewardFolder)
          .onChange(async value => {
            this.plugin.settings.stewardFolder = normalizePath(value);
            await this.plugin.saveSettings();
          });

        text.inputEl.addEventListener('focus', () => {
          new FolderSuggest(this.app, text.inputEl);
        });
      });

    // Add show role labels toggle
    new Setting(commonSettingGroup.settingItems)
      .setName(t('settings.showRoleLabels'))
      .setDesc(t('settings.showRoleLabelsDesc'))
      .addToggle(toggle =>
        toggle.setValue(this.plugin.settings.showPronouns).onChange(async value => {
          this.plugin.settings.showPronouns = value;
          await this.plugin.saveSettings();
        })
      );

    // Add auto-scroll toggle
    new Setting(commonSettingGroup.settingItems)
      .setName(t('settings.autoScroll'))
      .setDesc(t('settings.autoScrollDesc'))
      .addToggle(toggle =>
        toggle.setValue(this.plugin.settings.autoScroll).onChange(async value => {
          this.plugin.settings.autoScroll = value;
          await this.plugin.saveSettings();
        })
      );

    // Add debug mode toggle
    new Setting(commonSettingGroup.settingItems)
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
    this.createDeleteBehaviorSetting(commonSettingGroup.settingItems);

    const providerSettingGroup = this.addNewSettingGroup();

    // Create Providers section
    new Setting(providerSettingGroup.settingGroup)
      .setName(t('settings.providers.providersHeader'))
      .setHeading();

    // Display built-in providers
    this.createProviderSetting(providerSettingGroup.settingItems, 'openai');
    this.createProviderSetting(providerSettingGroup.settingItems, 'deepseek');
    this.createProviderSetting(providerSettingGroup.settingItems, 'google');
    this.createProviderSetting(providerSettingGroup.settingItems, 'groq');
    this.createProviderSetting(providerSettingGroup.settingItems, 'anthropic');
    this.createProviderSetting(providerSettingGroup.settingItems, 'ollama');
    this.createProviderSetting(providerSettingGroup.settingItems, 'elevenlabs');
    this.createProviderSetting(providerSettingGroup.settingItems, 'hume');

    // Display custom providers
    const customProviders = Object.keys(this.plugin.settings.providers).filter(
      key => this.plugin.settings.providers[key]?.isCustom === true
    );

    for (const providerKey of customProviders) {
      this.createProviderSetting(providerSettingGroup.settingItems, providerKey, {
        apiKeyPlaceholder: t('settings.enterApiKeyOptional'),
      });
    }

    // Add "Add new provider" button
    new Setting(providerSettingGroup.settingItems)
      .setName(t('settings.addNewProvider'))
      .setDesc(t('settings.addNewProviderDesc'))
      .addButton(button => {
        button
          .setButtonText(t('settings.addNewProvider'))
          .setCta()
          .onClick(async () => {
            // Generate a unique provider key using generateId
            let providerKey: string;
            do {
              providerKey = `provider-${generateId()}`;
            } while (this.plugin.settings.providers[providerKey]);

            // Initialize the custom provider
            this.plugin.settings.providers[providerKey] = {
              apiKey: '',
              isCustom: true,
              compatibility: 'openai',
              name: '',
            };

            await this.plugin.saveSettings();

            await this.refreshSettingTab(200);
          });
      });

    providerSettingGroup.settingGroup.createEl('div', {
      text: `${t('settings.note')}:`,
      cls: 'setting-item-description',
    });

    providerSettingGroup.settingGroup.createEl('div', {
      text: t('settings.apiKeyNote1'),
      cls: 'setting-item-description',
    });

    providerSettingGroup.settingGroup.createEl('div', {
      text: t('settings.apiKeyNote2'),
      cls: 'setting-item-description',
    });

    const modelSettingGroup = this.addNewSettingGroup();

    // Add Models settings section
    new Setting(modelSettingGroup.settingGroup).setName(t('settings.models')).setHeading();

    // Chat Model setting
    this.createModelSetting(
      new Setting(modelSettingGroup.settingItems)
        .setName(t('settings.chatModel'))
        .setDesc(t('settings.chatModelDesc')),
      {
        currentModelField: 'llm.chat.model',
        customModelsField: 'llm.chat.customModels',
        placeholder: 'provider:model, e.g., openai:gpt-5',
        presetModels: LLM_MODELS,
        onSelectChange: async (modelId: string) => {
          this.plugin.settings.llm.chat.model = modelId;
          await this.plugin.saveSettings();
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
        },
        onDeleteModel: async (modelId: string) => {
          this.plugin.settings.llm.chat.customModels =
            this.plugin.settings.llm.chat.customModels.filter(id => id !== modelId);

          // If this was the selected model, switch to default
          if (this.plugin.settings.llm.chat.model === modelId) {
            this.plugin.settings.llm.chat.model = LLM_MODELS[0].id;
          }

          await this.plugin.saveSettings();
        },
      }
    );

    // Temperature setting
    new Setting(modelSettingGroup.settingItems)
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
    new Setting(modelSettingGroup.settingItems)
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

    // Enable Model Fallback setting
    new Setting(modelSettingGroup.settingItems)
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
      new Setting(modelSettingGroup.settingItems)
        .setName(t('settings.fallbackChain'))
        .setDesc(t('settings.fallbackChainDesc'))
    );

    const intentClassificationSettingGroup = this.addNewSettingGroup();

    // Intent classification settings section
    new Setting(intentClassificationSettingGroup.settingGroup)
      .setName(t('settings.intentClassification'))
      .setHeading();

    // Intent classification Enable/Disable setting
    new Setting(intentClassificationSettingGroup.settingItems)
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
      new Setting(intentClassificationSettingGroup.settingItems)
        .setName(t('settings.embeddingModel'))
        .setDesc(t('settings.embeddingModelDesc')),
      {
        currentModelField: 'embedding.model',
        customModelsField: 'embedding.customModels',
        placeholder: 'provider:model, e.g., openai:text-embedding-ada-002',
        presetModels: EMBEDDING_MODELS,
        onSelectChange: async (modelId: string) => {
          const oldModelId = this.plugin.settings.embedding.model;

          // Clear cached embeddings if the model is changing
          if (oldModelId !== modelId) {
            await this.clearCachedEmbeddings({
              ...this.plugin.settings.embedding,
              model: oldModelId,
            });
          }

          this.plugin.settings.embedding.model = modelId;
          await this.plugin.saveSettings();
          this.updateVoiceInput();
        },
        onAddModel: async (modelId: string) => {
          const oldModelId = this.plugin.settings.embedding.model;

          // Clear cached embeddings if the model is changing
          if (oldModelId !== modelId) {
            await this.clearCachedEmbeddings({
              ...this.plugin.settings.embedding,
              model: oldModelId,
            });
          }

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
            const newModelId = EMBEDDING_MODELS[0].id;

            // Clear cached embeddings for the old model
            await this.clearCachedEmbeddings({
              ...this.plugin.settings.embedding,
              model: modelId,
            });

            this.plugin.settings.embedding.model = newModelId;
          }

          await this.plugin.saveSettings();
        },
      }
    );

    // Embedding Similarity Threshold setting
    new Setting(intentClassificationSettingGroup.settingItems)
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

    const speechSettingGroup = this.addNewSettingGroup();

    // Speech settings section
    new Setting(speechSettingGroup.settingGroup).setName(t('settings.speech')).setHeading();

    // Create speech model setting
    this.createModelSetting(
      new Setting(speechSettingGroup.settingItems)
        .setName(t('settings.speechModel'))
        .setDesc(t('settings.speechModelDesc')),
      {
        currentModelField: 'llm.speech.model',
        customModelsField: 'llm.speech.customModels',
        placeholder: 'provider:model, e.g., openai:tts-1',
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
    new Setting(speechSettingGroup.settingItems)
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

    const imageSettingGroup = this.addNewSettingGroup();

    // Add Image section
    new Setting(imageSettingGroup.settingGroup).setName(t('settings.image')).setHeading();

    // Image Model setting
    this.createModelSetting(
      new Setting(imageSettingGroup.settingItems)
        .setName(t('settings.imageModel'))
        .setDesc(t('settings.imageModelDesc')),
      {
        currentModelField: 'llm.image.model',
        customModelsField: 'llm.image.customModels',
        placeholder: 'provider:model, e.g., openai:dall-e-3',
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
    new Setting(imageSettingGroup.settingItems)
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

    const searchSettingGroup = this.addNewSettingGroup();

    // Add Search settings section
    new Setting(searchSettingGroup.settingGroup).setName(t('settings.searchSettings')).setHeading();

    // Without LLM setting
    new Setting(searchSettingGroup.settingItems)
      .setName(t('settings.searchMatchingPreference'))
      .setDesc(t('settings.searchMatchingPreferenceDesc'))
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
    new Setting(searchSettingGroup.settingItems)
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
  ProviderSetting,
  ModelSetting,
  ModelFallbackSetting,
  DeleteBehaviorSetting,
]);

// Export the final class
export default StewardSettingTab;
