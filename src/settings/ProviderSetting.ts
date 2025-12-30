import { getLanguage, Setting, setIcon, setTooltip, PluginSettingTab } from 'obsidian';
import { getTranslation } from 'src/i18n';
import type StewardPlugin from 'src/main';
import { ProviderNeedApiKey } from 'src/constants';
import { logger } from 'src/utils/logger';
import { Notice } from 'obsidian';

const lang = getLanguage();
const t = getTranslation(lang);

// Mapping from provider to setting display name
const PROVIDER_DISPLAY_NAMES: Record<ProviderNeedApiKey, string> = {
  openai: 'OpenAI',
  elevenlabs: 'ElevenLabs',
  deepseek: 'DeepSeek',
  google: 'Google',
  groq: 'Groq',
  anthropic: 'Anthropic',
  ollama: 'Ollama',
};

// Mapping from provider to translation key for API key label
const PROVIDER_API_KEY_LABELS: Record<ProviderNeedApiKey, string> = {
  openai: 'settings.openaiApiKey',
  elevenlabs: 'settings.elevenlabsApiKey',
  deepseek: 'settings.deepseekApiKey',
  google: 'settings.googleApiKey',
  groq: 'settings.groqApiKey',
  anthropic: 'settings.anthropicApiKey',
  ollama: 'settings.ollamaApiKey',
};

export class ProviderSetting {
  protected plugin: StewardPlugin;

  /**
   * Create a provider setting with edit interface for API key and base URL
   */
  public createProviderSetting(provider: ProviderNeedApiKey): void {
    // Access containerEl from the mixed-in class (StewardSettingTab extends PluginSettingTab)
    const containerEl = (this as unknown as PluginSettingTab).containerEl;
    if (!containerEl) {
      logger.error('containerEl not available in ProviderSetting');
      return;
    }

    // Create the Setting instance
    const setting = new Setting(containerEl).setName(PROVIDER_DISPLAY_NAMES[provider]);

    // Get the display name from translation
    const displayName = t(PROVIDER_API_KEY_LABELS[provider]);
    let currentInputWrapper: HTMLElement | null = null;

    // Function to get provider config
    const getProviderConfig = () => {
      if (!this.plugin.settings.providers[provider]) {
        this.plugin.settings.providers[provider] = {
          apiKey: '',
        };
      }
      return this.plugin.settings.providers[provider];
    };

    // Function to check if provider has API key set
    const hasApiKey = (): boolean => {
      try {
        const config = getProviderConfig();
        if (!config.apiKey) {
          return false;
        }
        const decrypted = this.plugin.encryptionService.getDecryptedApiKey(provider);
        return !!decrypted;
      } catch {
        return false;
      }
    };

    // Function to create normal view (Edit button)
    const createNormalView = () => {
      currentInputWrapper = setting.controlEl.createEl('div', {
        cls: 'stw-setting-wrapper',
      });

      // Create Edit link (same style as Back button)
      const editLink = currentInputWrapper.createEl('a', {
        text: t('settings.edit'),
        href: '#',
        cls: 'stw-custom-model-link caret-right',
      });

      editLink.addEventListener('click', e => {
        e.preventDefault();
        recreateInput('edit');
      });
    };

    // Function to create edit interface
    const createEditInterface = () => {
      currentInputWrapper = setting.controlEl.createEl('div', {
        cls: 'stw-setting-wrapper stw-provider-setting-wrapper',
      });

      // Add "Back" link
      const backLink = currentInputWrapper.createEl('a', {
        text: t('settings.back'),
        href: '#',
        cls: 'stw-custom-model-link caret-left',
      });

      backLink.addEventListener('click', e => {
        e.preventDefault();
        recreateInput('normal');
      });

      const config = getProviderConfig();

      // Get current API key placeholder
      let apiKeyPlaceholder = t('settings.enterApiKey');
      try {
        const currentKey = this.plugin.encryptionService.getDecryptedApiKey(provider);
        if (currentKey) {
          apiKeyPlaceholder = t('settings.apiKeyPlaceholder');
        }
      } catch (error) {
        apiKeyPlaceholder = t('settings.errorReenterKey');
        logger.error(`Error decrypting ${provider} API key in settings:`, error);
      }

      // Create API key input
      const apiKeyWrapper = currentInputWrapper.createEl('div', {
        cls: 'stw-provider-input-wrapper',
      });

      apiKeyWrapper.createEl('label', {
        text: displayName,
      });

      // Create input container with flex layout for input + button
      const inputContainer = apiKeyWrapper.createEl('div', {
        cls: 'stw-provider-input-container',
      });

      const apiKeyInput = inputContainer.createEl('input', {
        type: 'password',
        placeholder: apiKeyPlaceholder,
        cls: 'text-input',
      });

      // Make input read-only if API key is already set
      if (hasApiKey()) {
        apiKeyInput.setAttribute('readonly', 'true');

        // Add clear button (cross icon) after the input
        const clearButton = inputContainer.createEl('button');
        clearButton.classList.add('clickable-icon');
        setIcon(clearButton, 'cross');
        setTooltip(clearButton, t('settings.clearApiKey'));

        clearButton.addEventListener('click', async () => {
          try {
            await this.plugin.encryptionService.setEncryptedApiKey(provider, '');
            recreateInput('edit');
          } catch (error) {
            new Notice(t('settings.failedToClearApiKey'));
            logger.error(`Error clearing ${provider} API key:`, error);
          }
        });
      }

      apiKeyInput.addEventListener('change', async e => {
        const target = e.target as HTMLInputElement;
        const value = target.value.trim();

        if (value) {
          try {
            await this.plugin.encryptionService.setEncryptedApiKey(provider, value);
            target.setAttribute('placeholder', t('settings.apiKeyPlaceholder'));
            target.value = '';
            // Refresh to show the read-only state and clear button
            recreateInput('edit');
          } catch (error) {
            new Notice(t('settings.failedToSaveApiKey'));
            logger.error(`Error setting ${provider} API key:`, error);
          }
        }
      });

      // Create Base URL input
      const baseUrlWrapper = currentInputWrapper.createEl('div', {
        cls: 'stw-provider-input-wrapper',
      });

      baseUrlWrapper.createEl('label', {
        text: t('settings.baseUrl'),
      });

      const currentBaseUrl = config.baseUrl || '';

      const baseUrlInput = baseUrlWrapper.createEl('input', {
        type: 'text',
        placeholder: t('settings.baseUrlPlaceholder'),
        cls: 'text-input',
        value: currentBaseUrl,
      });

      baseUrlInput.addEventListener('change', async e => {
        const target = e.target as HTMLInputElement;
        const value = target.value.trim();
        config.baseUrl = value;
        await this.plugin.saveSettings();
      });
    };

    // Function to remove current input and create new one
    const recreateInput = (mode: 'normal' | 'edit') => {
      // Remove current wrapper if it exists
      if (currentInputWrapper) {
        currentInputWrapper.remove();
        currentInputWrapper = null;
      }

      // Create new input based on current mode
      if (mode === 'edit') {
        createEditInterface();
      } else {
        createNormalView();
      }
    };

    // Initialize with normal view
    recreateInput('normal');
  }
}
