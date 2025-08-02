import { App, Notice, PluginSettingTab, Setting } from 'obsidian';
import { logger } from './utils/logger';
import { LLM_MODELS } from './constants';

import type StewardPlugin from './main';

export default class StewardSettingTab extends PluginSettingTab {
  plugin: StewardPlugin;

  constructor(app: App, plugin: StewardPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;

    containerEl.empty();

    // Add setting for conversation folder
    new Setting(containerEl)
      .setName('Steward folder')
      .setDesc('Base folder where Steward data will be stored')
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
      .setName('Bordered input')
      .setDesc(
        'Add border around command input lines (better visibility especially with light themes)'
      )
      .addToggle(toggle =>
        toggle.setValue(this.plugin.settings.borderedInput).onChange(async value => {
          this.plugin.settings.borderedInput = value;
          await this.plugin.saveSettings();
          document.body.classList.toggle('stw-bordered-input', value);
        })
      );

    // Add show role labels toggle
    new Setting(containerEl)
      .setName('Show role labels')
      .setDesc('Show User/Steward/System labels in conversations')
      .addToggle(toggle =>
        toggle.setValue(this.plugin.settings.showPronouns).onChange(async value => {
          this.plugin.settings.showPronouns = value;
          await this.plugin.saveSettings();
        })
      );

    // Add debug mode toggle
    new Setting(containerEl)
      .setName('Debug mode')
      .setDesc('Enable detailed logging in the console for debugging')
      .addToggle(toggle =>
        toggle.setValue(this.plugin.settings.debug).onChange(async value => {
          this.plugin.settings.debug = value;
          await this.plugin.saveSettings();
          logger.setDebug(value);
        })
      );

    // Create API Keys section
    new Setting(containerEl).setName('API keys').setHeading();

    // OpenAI API Key setting with encryption
    new Setting(containerEl)
      .setName('OpenAI API key')
      .setDesc('Your OpenAI API key (stored with encryption)')
      .addText(text => {
        // Get the current API key (decrypted) with error handling
        let placeholder = 'Enter your API key';
        try {
          const currentKey = this.plugin.getDecryptedApiKey('openai');
          if (currentKey) {
            placeholder = '••••••••••••••••••••••';
          }
        } catch (error) {
          // If decryption fails, we'll show a special message
          placeholder = 'Error: Click to re-enter key';
          logger.error('Error decrypting API key in settings:', error);
        }

        text
          .setPlaceholder(placeholder)
          // Only show value if editing
          .setValue('')
          .onChange(async value => {
            if (value) {
              try {
                // If a value is entered, encrypt and save it
                await this.plugin.setEncryptedApiKey('openai', value);

                // Update the placeholder to show that a key is saved
                text.setPlaceholder('••••••••••••••••••••••');
                // Clear the input field for security
                text.setValue('');
              } catch (error) {
                new Notice('Failed to save API key. Please try again.');
                logger.error('Error setting API key:', error);
              }
            }
          });

        // Add password type to protect API key
        text.inputEl.setAttribute('type', 'password');
      })
      .addExtraButton(button => {
        button
          .setIcon('cross')
          .setTooltip('Clear API key')
          .onClick(async () => {
            try {
              await this.plugin.setEncryptedApiKey('openai', '');
              // Force refresh of the settings
              this.display();
            } catch (error) {
              new Notice('Failed to clear API key. Please try again.');
              logger.error('Error clearing API key:', error);
            }
          });
      });

    // ElevenLabs API Key setting with encryption
    new Setting(containerEl)
      .setName('ElevenLabs API key')
      .setDesc('Your ElevenLabs API key (stored with encryption)')
      .addText(text => {
        // Get the current API key (decrypted) with error handling
        let placeholder = 'Enter your API key';
        try {
          const currentKey = this.plugin.getDecryptedApiKey('elevenlabs');
          if (currentKey) {
            placeholder = '••••••••••••••••••••••';
          }
        } catch (error) {
          // If decryption fails, we'll show a special message
          placeholder = 'Error: Click to re-enter key';
          logger.error('Error decrypting API key in settings:', error);
        }

        text
          .setPlaceholder(placeholder)
          // Only show value if editing
          .setValue('')
          .onChange(async value => {
            if (value) {
              try {
                // If a value is entered, encrypt and save it
                await this.plugin.setEncryptedApiKey('elevenlabs', value);

                // Update the placeholder to show that a key is saved
                text.setPlaceholder('••••••••••••••••••••••');
                // Clear the input field for security
                text.setValue('');
              } catch (error) {
                new Notice('Failed to save API key. Please try again.');
                logger.error('Error setting API key:', error);
              }
            }
          });

        // Add password type to protect API key
        text.inputEl.setAttribute('type', 'password');
      })
      .addExtraButton(button => {
        button
          .setIcon('cross')
          .setTooltip('Clear API Key')
          .onClick(async () => {
            try {
              await this.plugin.setEncryptedApiKey('elevenlabs', '');
              // Force refresh of the settings
              this.display();
            } catch (error) {
              new Notice('Failed to clear API key. Please try again.');
              logger.error('Error clearing API key:', error);
            }
          });
      });

    // DeepSeek API Key setting with encryption
    new Setting(containerEl)
      .setName('DeepSeek API key')
      .setDesc('Your DeepSeek API key (stored with encryption)')
      .addText(text => {
        // Get the current API key (decrypted) with error handling
        let placeholder = 'Enter your API key';
        try {
          const currentKey = this.plugin.getDecryptedApiKey('deepseek');
          if (currentKey) {
            placeholder = '••••••••••••••••••••••';
          }
        } catch (error) {
          // If decryption fails, we'll show a special message
          placeholder = 'Error: Click to re-enter key';
          logger.error('Error decrypting API key in settings:', error);
        }

        text
          .setPlaceholder(placeholder)
          // Only show value if editing
          .setValue('')
          .onChange(async value => {
            if (value) {
              try {
                // If a value is entered, encrypt and save it
                await this.plugin.setEncryptedApiKey('deepseek', value);

                // Update the placeholder to show that a key is saved
                text.setPlaceholder('••••••••••••••••••••••');
                // Clear the input field for security
                text.setValue('');
              } catch (error) {
                new Notice('Failed to save API key. Please try again.');
                logger.error('Error setting API key:', error);
              }
            }
          });

        // Add password type to protect API key
        text.inputEl.setAttribute('type', 'password');
      })
      .addExtraButton(button => {
        button
          .setIcon('cross')
          .setTooltip('Clear API key')
          .onClick(async () => {
            try {
              await this.plugin.setEncryptedApiKey('deepseek', '');
              // Force refresh of the settings
              this.display();
            } catch (error) {
              new Notice('Failed to clear API key. Please try again.');
              logger.error('Error clearing API key:', error);
            }
          });
      });

    containerEl.createEl('div', {
      text: 'Note: You need to provide your own API keys to use the AI-powered assistant.',
      cls: 'setting-item-description',
    });

    // If we have encryption issues, show instructions for resetting
    if (
      this.plugin.settings.apiKeys.openai ||
      this.plugin.settings.apiKeys.elevenlabs ||
      this.plugin.settings.apiKeys.deepseek
    ) {
      try {
        this.plugin.getDecryptedApiKey('openai');
        this.plugin.getDecryptedApiKey('elevenlabs');
        this.plugin.getDecryptedApiKey('deepseek');
      } catch (error) {
        containerEl.createEl('div', {
          text: 'If you are seeing decryption errors, please use the "Reset Encryption" button and re-enter your API keys.',
          cls: 'setting-item-description mod-warning',
        });
      }
    }

    // Add LLM settings section
    new Setting(containerEl).setName('LLM').setHeading();

    // Chat Model selection with provider automatically determined
    new Setting(containerEl)
      .setName('Chat model')
      .setDesc('Select the AI model to use for chat')
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
      .setName('Embedding model')
      .setDesc('Model used for text embeddings (currently fixed to GPT-4)')
      .addText(text => {
        text.setValue('GPT-4').setDisabled(true);
      });

    // Temperature setting
    new Setting(containerEl)
      .setName('Temperature')
      .setDesc('Controls randomness in the output (0.0 to 1.0)')
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
      .setName('Max generation tokens')
      .setDesc(
        'Maximum number of tokens to generate in response (higher values may increase API costs)'
      )
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
      .setName('Ollama base URL')
      .setDesc('The base URL for Ollama API (default: http://localhost:11434)')
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
