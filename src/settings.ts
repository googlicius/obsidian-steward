import { Notice, PluginSettingTab, Setting } from 'obsidian';
import { logger } from './utils/logger';
import { LLM_MODELS, EMBEDDING_MODELS, ProviderNeedApiKey } from './constants';
import { getTranslation } from './i18n';
import { getObsidianLanguage } from './utils/getObsidianLanguage';
import type StewardPlugin from './main';
import { capitalizeString } from './utils/capitalizeString';

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
          const currentProvider = LLM_MODELS.find(
            model => model.id === this.plugin.settings.llm.model
          )?.provider;

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
          const currentProvider = LLM_MODELS.find(
            model => model.id === this.plugin.settings.llm.model
          )?.provider;

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
    const currentProvider = LLM_MODELS.find(
      model => model.id === this.plugin.settings.llm.model
    )?.provider;

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

  private createChatModelSetting(containerEl: HTMLElement) {
    new Setting(containerEl)
      .setName(t('settings.chatModel'))
      .setDesc(t('settings.chatModelDesc'))
      .addDropdown(dropdown => {
        // Group models by provider
        const modelsByProvider = LLM_MODELS.reduce<Record<string, typeof LLM_MODELS>>(
          (acc, model) => {
            if (!acc[model.provider]) {
              acc[model.provider] = [];
            }
            acc[model.provider].push(model);
            return acc;
          },
          {}
        );

        // Add models grouped by provider
        for (const [provider, models] of Object.entries(modelsByProvider)) {
          // Create optgroup for each provider
          const optgroup = dropdown.selectEl.createEl('optgroup');
          optgroup.setAttribute('label', capitalizeString(provider));
          optgroup.setAttribute('data-provider', provider);

          // Add models under this provider
          for (const model of models) {
            const option = optgroup.createEl('option');
            option.textContent = model.name;
            option.value = model.id;
            option.setAttribute('data-provider', model.provider);
          }
        }

        dropdown.setValue(this.plugin.settings.llm.model).onChange(async value => {
          this.plugin.settings.llm.model = value;
          await this.plugin.saveSettings();

          // Update provider base URL settings visibility based on selected model
          this.updateProviderBaseUrlVisibility();
        });
      });
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

    // Add bordered input toggle (on top, not under a heading)
    new Setting(containerEl)
      .setName(t('settings.borderedInput'))
      .setDesc(t('settings.borderedInputDesc'))
      .addToggle(toggle =>
        toggle.setValue(this.plugin.settings.borderedInput).onChange(async value => {
          this.plugin.settings.borderedInput = value;
          await this.plugin.saveSettings();
          document.body.classList.toggle('stw-bordered-input', value);
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

    // Chat Model selection with provider automatically determined
    this.createChatModelSetting(containerEl);

    this.createProviderBaseUrlSetting(containerEl);

    // Embedding Model setting
    new Setting(containerEl)
      .setName(t('settings.embeddingModel'))
      .setDesc(t('settings.embeddingModelDesc'))
      .addDropdown(dropdown => {
        // Add embedding models
        for (const model of EMBEDDING_MODELS) {
          dropdown.addOption(model.id, model.name);
        }

        dropdown.setValue(this.plugin.settings.llm.embeddingModel).onChange(async value => {
          this.plugin.settings.llm.embeddingModel = value;
          await this.plugin.saveSettings();
        });
      });

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

    // Add Search settings section
    new Setting(containerEl).setName(t('settings.searchSettings')).setHeading();

    // Without LLM setting
    new Setting(containerEl)
      .setName(t('settings.withoutLLM'))
      .setDesc(t('settings.withoutLLMDesc'))
      .addDropdown(dropdown => {
        dropdown
          .addOption('exact', t('settings.exactMatch'))
          .addOption('relevant', t('settings.relevantScoring'))
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

        // Set input type to number
        text.inputEl.setAttribute('type', 'number');
        text.inputEl.setAttribute('min', '1');
        text.inputEl.setAttribute('max', '100');
      });
  }
}
