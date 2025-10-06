import { Notice, PluginSettingTab, setIcon, Setting, setTooltip } from 'obsidian';
import { logger } from './utils/logger';
import {
  LLM_MODELS,
  EMBEDDING_MODELS,
  SPEECH_MODELS,
  IMAGE_MODELS,
  DEFAULT_VOICES,
  ProviderNeedApiKey,
} from './constants';
import { getTranslation } from './i18n';
import { getObsidianLanguage } from './utils/getObsidianLanguage';
import type StewardPlugin from './main';
import { capitalizeString } from './utils/capitalizeString';
import { DeleteBehavior, StewardPluginSettings } from './types/interfaces';
import { get } from './utils/lodash-like';

// Get the current language and translation function
const lang = getObsidianLanguage();
const t = getTranslation(lang);

export default class StewardSettingTab extends PluginSettingTab {
  private providerBaseUrlSetting: Setting;

  constructor(private plugin: StewardPlugin) {
    super(plugin.app, plugin);
  }

  /**
   * Get the default base URL for a provider
   * @param provider - The provider name
   * @returns The default base URL
   */
  private getDefaultBaseUrl(provider: string): string {
    const defaultUrls: Record<string, string> = {
      openai: 'Default OpenAI Base URL',
      deepseek: 'Default DeepSeek Base URL',
      google: 'Default Google Base URL',
      groq: 'Default Groq Base URL',
      ollama: 'http://localhost:11434',
      anthropic: 'Default Anthropic Base URL',
    };

    return defaultUrls[provider] || '';
  }

  /**
   * Helper function to create API key settings
   * @param containerEl - The container element
   * @param provider - The provider name (e.g., 'openai', 'groq')
   * @param displayName - The display name for the setting
   * @param description - The description for the setting
   */
  private createApiKeySetting(
    containerEl: HTMLElement,
    provider: ProviderNeedApiKey,
    displayName: string
  ): void {
    const lang = getObsidianLanguage();
    const t = getTranslation(lang);

    new Setting(containerEl)
      .setName(displayName)
      .addText(text => {
        // Get the current API key (decrypted) with error handling
        let placeholder = t('settings.enterApiKey');
        try {
          const currentKey = this.plugin.getDecryptedApiKey(provider);
          if (currentKey) {
            placeholder = t('settings.apiKeyPlaceholder');
          }
        } catch (error) {
          // If decryption fails, we'll show a special message
          placeholder = t('settings.errorReenterKey');
          logger.error(`Error decrypting ${provider} API key in settings:`, error);
        }

        text
          .setPlaceholder(placeholder)
          // Only show value if editing
          .setValue('')
          .onChange(async value => {
            if (value) {
              try {
                // If a value is entered, encrypt and save it
                await this.plugin.setEncryptedApiKey(provider, value);

                // Update the placeholder to show that a key is saved
                text.setPlaceholder(t('settings.apiKeyPlaceholder'));
                // Clear the input field for security
                text.setValue('');
              } catch (error) {
                new Notice(t('settings.failedToSaveApiKey'));
                logger.error(`Error setting ${provider} API key:`, error);
              }
            }
          });

        // Add password type to protect API key
        text.inputEl.setAttribute('type', 'password');
      })
      .addExtraButton(button => {
        button
          .setIcon('cross')
          .setTooltip(t('settings.clearApiKey'))
          .onClick(async () => {
            try {
              await this.plugin.setEncryptedApiKey(provider, '');
              // Force refresh of the settings
              this.display();
            } catch (error) {
              new Notice(t('settings.failedToClearApiKey'));
              logger.error(`Error clearing ${provider} API key:`, error);
            }
          });
      });
  }

  private createProviderBaseUrlSetting(containerEl: HTMLElement) {
    const setting = new Setting(containerEl)
      .setName(t('settings.providerBaseUrl'))
      .setDesc(t('settings.providerBaseUrlDesc'))
      .addText(text => {
        const updateBaseUrlInput = () => {
          const currentProvider = this.plugin.settings.llm.chat.model.split(':')[0];

          if (currentProvider) {
            // Ensure providerConfigs exists
            if (!this.plugin.settings.llm.providerConfigs) {
              this.plugin.settings.llm.providerConfigs = {};
            }

            const currentBaseUrl =
              this.plugin.settings.llm.providerConfigs[currentProvider]?.baseUrl || '';
            const defaultBaseUrl = this.getDefaultBaseUrl(currentProvider);

            text.setValue(currentBaseUrl);
            text.setPlaceholder(defaultBaseUrl);
          }
        };

        updateBaseUrlInput();

        text.onChange(async value => {
          const currentProvider = this.plugin.settings.llm.chat.model.split(':')[0];

          if (currentProvider) {
            // Ensure providerConfigs exists
            if (!this.plugin.settings.llm.providerConfigs) {
              this.plugin.settings.llm.providerConfigs = {};
            }

            // Initialize provider config if it doesn't exist
            if (!this.plugin.settings.llm.providerConfigs[currentProvider]) {
              this.plugin.settings.llm.providerConfigs[currentProvider] = {};
            }

            const providerConfig = this.plugin.settings.llm.providerConfigs[currentProvider];
            if (providerConfig) {
              providerConfig.baseUrl = value || undefined;
              await this.plugin.saveSettings();
            }
          }
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
      .addText(text =>
        text
          .setPlaceholder('Steward')
          .setValue(this.plugin.settings.stewardFolder)
          .onChange(async value => {
            this.plugin.settings.stewardFolder = value || 'Steward';
            await this.plugin.saveSettings();
          })
      );

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

    // If we have encryption issues, show instructions for resetting
    if (
      this.plugin.settings.apiKeys.openai ||
      this.plugin.settings.apiKeys.elevenlabs ||
      this.plugin.settings.apiKeys.deepseek ||
      this.plugin.settings.apiKeys.google ||
      this.plugin.settings.apiKeys.groq ||
      this.plugin.settings.apiKeys.anthropic
    ) {
      try {
        this.plugin.getDecryptedApiKey('openai');
        this.plugin.getDecryptedApiKey('elevenlabs');
        this.plugin.getDecryptedApiKey('deepseek');
        this.plugin.getDecryptedApiKey('google');
        this.plugin.getDecryptedApiKey('groq');
        this.plugin.getDecryptedApiKey('anthropic');
      } catch (error) {
        containerEl.createEl('div', {
          text: t('settings.decryptionErrorNote'),
          cls: 'setting-item-description mod-warning',
        });
      }
    }

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

  private createDeleteBehaviorSetting(containerEl: HTMLElement): void {
    const lang = getObsidianLanguage();
    const t = getTranslation(lang);

    // Create the main setting first
    const setting = new Setting(containerEl)
      .setName(t('settings.deleteBehavior'))
      .setDesc(t('settings.deleteBehaviorDesc'));

    let currentInputWrapper: HTMLElement | null = null;

    // Function to create delete behavior dropdown
    const createDeleteBehaviorDropdown = () => {
      // Create wrapper div
      const wrapper = setting.controlEl.createEl('div', {
        cls: 'stw-setting-wrapper',
      });
      currentInputWrapper = wrapper;

      // Create select element directly
      const select = wrapper.createEl('select', {
        cls: 'dropdown',
      });

      select.addEventListener('change', async e => {
        const target = e.target as HTMLSelectElement;
        this.plugin.settings.deleteBehavior.behavior = target.value as DeleteBehavior['behavior'];
        await this.plugin.saveSettings();
      });

      // Add options
      const options = [
        {
          id: 'stw_trash',
          name: t('settings.moveToTrash', {
            folder: `${this.plugin.settings.stewardFolder}/Trash`,
          }),
        },
        {
          id: 'obsidian_trash',
          name: t('settings.useObsidianDeletedFiles'),
        },
      ];

      // Add options to select
      for (const option of options) {
        const optionEl = select.createEl('option');
        optionEl.textContent = option.name;
        optionEl.value = option.id;
      }

      // Initialize with current value
      select.value = this.plugin.settings.deleteBehavior.behavior;

      // Add "Cleanup policy" link (initially hidden if not stw_trash)
      wrapper
        .createEl('a', {
          text: t('settings.cleanupPolicy'),
          href: '#',
          cls: 'stw-custom-model-link caret-right',
        })
        .addEventListener('click', e => {
          e.preventDefault();
          recreateInput('cleanup');
        });
    };

    // Function to create cleanup policy dropdown
    const createCleanupPolicyDropdown = () => {
      // Create wrapper div
      const wrapper = setting.controlEl.createEl('div', {
        cls: 'stw-setting-wrapper',
      });
      currentInputWrapper = wrapper;

      // Add "Back" link
      const backLink = wrapper.createEl('a', {
        text: t('settings.back'),
        href: '#',
        cls: 'stw-custom-model-link caret-left',
      });

      backLink.addEventListener('click', e => {
        e.preventDefault();
        recreateInput('deleteBehavior');
      });

      // Create select element directly
      const select = wrapper.createEl('select', {
        cls: 'dropdown',
      });

      // Add options
      const options = [
        { id: 'never', name: t('settings.never') },
        { id: '7days', name: t('settings.days7') },
        { id: '30days', name: t('settings.days30') },
        { id: '90days', name: t('settings.days90') },
        { id: '1year', name: t('settings.year1') },
      ];

      // Add options to select
      for (const option of options) {
        const optionEl = select.createEl('option');
        optionEl.textContent = option.name;
        optionEl.value = option.id;
      }

      // Initialize with current value
      select.value = this.plugin.settings.deleteBehavior.cleanupPolicy || 'never';

      select.addEventListener('change', async e => {
        const target = e.target as HTMLSelectElement;
        this.plugin.settings.deleteBehavior.cleanupPolicy =
          target.value as DeleteBehavior['cleanupPolicy'];
        await this.plugin.saveSettings();
      });
    };

    // Function to remove current input and create new one
    const recreateInput = (mode: 'deleteBehavior' | 'cleanup') => {
      // Remove current wrapper if it exists
      if (currentInputWrapper) {
        currentInputWrapper.remove();
        currentInputWrapper = null;
      }

      // Create new input based on current mode
      if (mode === 'cleanup') {
        createCleanupPolicyDropdown();
      } else {
        createDeleteBehaviorDropdown();
      }
    };

    // Initialize with delete behavior dropdown
    recreateInput('deleteBehavior');
  }

  private createModelSetting(
    setting: Setting,
    options: {
      validationPattern?: RegExp;
      presetModels: Array<{ id: string; name?: string }>;
      customModelsField: string;
      currentModelField: string;
      placeholder: string;
      onSelectChange: (modelId: string) => Promise<void>;
      onAddModel: (modelId: string) => Promise<void>;
      onDeleteModel: (modelId: string) => Promise<void>;
    }
  ): void {
    const { validationPattern = /^[a-zA-Z0-9_.-]+:[^\s]+$/ } = options;
    let currentInputWrapper: HTMLElement | null = null;

    // Validation function for custom model format
    const validateModelFormat = (model: string): boolean => {
      return validationPattern.test(model);
    };

    // Function to get custom models from settings
    const getCustomModels = (): string[] => {
      return get(this.plugin.settings, options.customModelsField) as string[];
    };

    // Function to get current model from settings
    const getCurrentModel = (): string => {
      return get(this.plugin.settings, options.currentModelField) as string;
    };

    // Function to create dropdown
    const createDropdown = () => {
      // Create wrapper div
      const wrapper = setting.controlEl.createEl('div', {
        cls: 'stw-setting-wrapper',
      });
      currentInputWrapper = wrapper;

      // Create select element directly
      const select = wrapper.createEl('select', {
        cls: 'dropdown',
      });

      // Combine preset models and custom models
      const allModels = [
        ...options.presetModels.map(model => ({
          id: model.id,
          name: model.name || model.id,
        })),
        ...getCustomModels().map(model => {
          const [, id] = model.split(':');
          return {
            id: model,
            name: id,
          };
        }),
      ];

      // Group models by provider
      const modelsByProvider = allModels.reduce<Record<string, typeof allModels>>((acc, model) => {
        const provider = model.id.split(':')[0];
        if (!acc[provider]) {
          acc[provider] = [];
        }
        acc[provider].push(model);
        return acc;
      }, {});

      // Add models grouped by provider
      for (const [provider, models] of Object.entries(modelsByProvider)) {
        // Create optgroup for each provider
        const optgroup = select.createEl('optgroup');
        optgroup.setAttribute('label', capitalizeString(provider));

        // Add models under this provider
        for (const model of models) {
          const option = optgroup.createEl('option');
          option.textContent = model.name;
          option.value = model.id;
        }
      }

      // Initialize with current value or default
      const currentModel = getCurrentModel();
      select.value = currentModel;

      select.addEventListener('change', async e => {
        const target = e.target as HTMLSelectElement;
        await options.onSelectChange(target.value);
      });

      // Add "Add new model" link
      const addNewModelLink = wrapper.createEl('a', {
        text: `${t('settings.addNewModel')}`,
        href: '#',
        cls: 'stw-custom-model-link caret-right',
      });

      addNewModelLink.addEventListener('click', e => {
        e.preventDefault();
        recreateInput('add');
      });

      // Add delete link below the select box (only if there are custom models)
      const customModels = getCustomModels();
      if (customModels.length > 0) {
        const deleteLink = wrapper.createEl('a', {
          text: t('settings.deleteCustomModels'),
          href: '#',
          cls: 'stw-custom-model-link caret-right',
        });

        deleteLink.addEventListener('click', e => {
          e.preventDefault();
          recreateInput('delete');
        });
      }
    };

    // Function to create text input
    const createTextInput = () => {
      // Create wrapper div
      const wrapper = setting.controlEl.createEl('div', {
        cls: 'stw-setting-wrapper',
      });
      currentInputWrapper = wrapper;

      // Add "Back" link
      const backLink = wrapper.createEl('a', {
        text: t('settings.back'),
        href: '#',
        cls: 'stw-custom-model-link caret-left',
      });

      backLink.addEventListener('click', e => {
        e.preventDefault();
        recreateInput('dropdown');
      });

      // Create text input directly
      const textInput = wrapper.createEl('input', {
        type: 'text',
        placeholder: options.placeholder,
        cls: 'text-input',
      });
      textInput.focus();

      // Add change handler for validation
      textInput.addEventListener('input', e => {
        const target = e.target as HTMLInputElement;
        const value = target.value;

        // Only validate format, don't save yet
        if (value && !validateModelFormat(value)) {
          target.addClass('is-invalid');
          return;
        }
        target.removeClass('is-invalid');
      });

      // Add Add button next to the text input
      const addButton = wrapper.createEl('button', {
        text: t('settings.add'),
      });

      // Add button click handler
      addButton.addEventListener('click', async () => {
        const inputValue = textInput.value.trim();

        if (!inputValue) {
          return;
        }

        if (!validateModelFormat(inputValue)) {
          textInput.addClass('is-invalid');
          return;
        }

        textInput.removeClass('is-invalid');

        await options.onAddModel(inputValue);
        recreateInput('dropdown');
      });
    };

    // Function to create delete interface
    const createDeleteInterface = () => {
      // Create wrapper div
      const wrapper = setting.controlEl.createEl('div', {
        cls: 'stw-setting-wrapper',
      });
      currentInputWrapper = wrapper;

      // Add "Back" link
      const backLink = wrapper.createEl('a', {
        text: t('settings.back'),
        href: '#',
        cls: 'stw-custom-model-link caret-left',
      });

      backLink.addEventListener('click', e => {
        e.preventDefault();
        recreateInput('dropdown');
      });

      const customModels = getCustomModels();

      if (customModels.length === 0) {
        wrapper.createEl('div', {
          text: t('settings.customModels') + ': ' + t('settings.noCustomModels'),
          cls: 'stw-no-models',
        });
        return null;
      }

      // Create models list
      const modelsList = wrapper.createEl('div', {
        cls: 'stw-custom-models-list',
      });

      for (const modelId of customModels) {
        const modelItem = modelsList.createEl('div', {
          cls: 'stw-custom-model-item',
        });

        modelItem.createEl('span', { text: modelId });

        const deleteButton = modelItem.createEl('button');
        setIcon(deleteButton, 'trash');
        setTooltip(deleteButton, t('settings.delete'));
        deleteButton.classList.add('clickable-icon');

        deleteButton.addEventListener('click', async () => {
          await options.onDeleteModel(modelId);
          // Recreate the interface to reflect changes
          recreateInput('delete');
        });
      }
    };

    // Function to remove current input and create new one
    const recreateInput = (mode: 'delete' | 'add' | 'dropdown') => {
      // Remove current wrapper if it exists
      if (currentInputWrapper) {
        currentInputWrapper.remove();
        currentInputWrapper = null;
      }

      // Create new input based on current mode
      if (mode === 'delete') {
        createDeleteInterface();
      } else if (mode === 'add') {
        createTextInput();
      } else {
        createDropdown();
      }
    };

    // Initialize with dropdown mode
    recreateInput('dropdown');
  }
}
