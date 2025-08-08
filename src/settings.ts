import { App, Notice, PluginSettingTab, Setting } from 'obsidian';
import { logger } from './utils/logger';
import { LLM_MODELS, ProviderNeedApiKey } from './constants';
import { getTranslation } from './i18n';
import { getObsidianLanguage } from './utils/getObsidianLanguage';

import type StewardPlugin from './main';

export default class StewardSettingTab extends PluginSettingTab {
  plugin: StewardPlugin;

  constructor(app: App, plugin: StewardPlugin) {
    super(app, plugin);
    this.plugin = plugin;
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

  display(): void {
    const { containerEl } = this;

    containerEl.empty();

    // Get the current language and translation function
    const lang = getObsidianLanguage();
    const t = getTranslation(lang);

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
      this.plugin.settings.apiKeys.groq
    ) {
      try {
        this.plugin.getDecryptedApiKey('openai');
        this.plugin.getDecryptedApiKey('elevenlabs');
        this.plugin.getDecryptedApiKey('deepseek');
        this.plugin.getDecryptedApiKey('google');
        this.plugin.getDecryptedApiKey('groq');
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
    new Setting(containerEl)
      .setName(t('settings.chatModel'))
      .setDesc(t('settings.chatModelDesc'))
      .addDropdown(dropdown => {
        // Add all models from the constants
        LLM_MODELS.forEach(model => {
          dropdown.addOption(model.id, `${model.name} (${model.provider})`);
        });

        dropdown.setValue(this.plugin.settings.llm.model).onChange(async value => {
          this.plugin.settings.llm.model = value;
          await this.plugin.saveSettings();

          // Update Ollama settings visibility based on selected model
          updateOllamaSettingsVisibility();
        });
      });

    // Embedding Model setting (hard-coded to GPT-4)
    new Setting(containerEl)
      .setName(t('settings.embeddingModel'))
      .setDesc(t('settings.embeddingModelDesc'))
      .addText(text => {
        text.setValue('GPT-4').setDisabled(true);
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

    // Ollama Base URL setting (only shown when Ollama model is selected)
    const ollamaBaseUrlSetting = new Setting(containerEl)
      .setName(t('settings.ollamaBaseUrl'))
      .setDesc(t('settings.ollamaBaseUrlDesc', { defaultUrl: 'http://localhost:11434' }))
      .addText(text =>
        text
          .setPlaceholder('http://localhost:11434')
          .setValue(this.plugin.settings.llm.ollamaBaseUrl || '')
          .onChange(async value => {
            this.plugin.settings.llm.ollamaBaseUrl = value;
            await this.plugin.saveSettings();
          })
      );

    // Add initial class for visibility
    const isOllamaModel =
      LLM_MODELS.find(model => model.id === this.plugin.settings.llm.model)?.provider === 'ollama';
    ollamaBaseUrlSetting.settingEl.classList.add(
      isOllamaModel ? 'stw-setting-visible' : 'stw-setting-hidden'
    );

    // Show/hide Ollama settings based on selected model
    const updateOllamaSettingsVisibility = () => {
      const isOllamaModel =
        LLM_MODELS.find(model => model.id === this.plugin.settings.llm.model)?.provider ===
        'ollama';

      ollamaBaseUrlSetting.settingEl.classList.toggle('stw-setting-visible', isOllamaModel);
      ollamaBaseUrlSetting.settingEl.classList.toggle('stw-setting-hidden', !isOllamaModel);
    };
  }
}
