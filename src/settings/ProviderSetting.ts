import { getLanguage, Setting, setIcon, setTooltip } from 'obsidian';
import { getTranslation } from 'src/i18n';
import type StewardPlugin from 'src/main';
import { ProviderNeedApiKey } from 'src/constants';
import { logger } from 'src/utils/logger';
import { Notice } from 'obsidian';
import { capitalizeString } from 'src/utils/capitalizeString';
import type StewardSettingTab from 'src/settings';

const lang = getLanguage();
const t = getTranslation(lang);

// Provider configuration mapping
const PROVIDER_CONFIG: Record<
  ProviderNeedApiKey,
  {
    displayName: string;
    linkUrl: string;
  }
> = {
  openai: {
    displayName: 'OpenAI',
    linkUrl: 'https://platform.openai.com',
  },
  elevenlabs: {
    displayName: 'ElevenLabs',
    linkUrl: 'https://elevenlabs.io',
  },
  deepseek: {
    displayName: 'DeepSeek',
    linkUrl: 'https://platform.deepseek.com',
  },
  google: {
    displayName: 'Google',
    linkUrl: 'https://aistudio.google.com/app/apikey',
  },
  groq: {
    displayName: 'Groq',
    linkUrl: 'https://console.groq.com',
  },
  anthropic: {
    displayName: 'Anthropic',
    linkUrl: 'https://console.anthropic.com',
  },
  ollama: {
    displayName: 'Ollama',
    linkUrl: 'https://ollama.com',
  },
  hume: {
    displayName: 'Hume',
    linkUrl: 'https://hume.ai',
  },
};

// List of built-in providers for compatibility dropdown
const BUILT_IN_PROVIDERS: ProviderNeedApiKey[] = [
  'openai',
  'elevenlabs',
  'deepseek',
  'google',
  'groq',
  'anthropic',
  'ollama',
  'hume',
];

export class ProviderSetting {
  protected plugin: StewardPlugin;

  /**
   * Check if a provider key is a built-in provider
   */
  private isBuiltInProvider(providerKey: string): providerKey is ProviderNeedApiKey {
    return BUILT_IN_PROVIDERS.includes(providerKey as ProviderNeedApiKey);
  }

  /**
   * Check if a provider is custom
   */
  private isCustomProvider(providerKey: string): boolean {
    const config = this.plugin.settings.providers[providerKey];
    return (
      config?.isCustom === true || (!this.isBuiltInProvider(providerKey) && config !== undefined)
    );
  }

  /**
   * Create a DocumentFragment with description text and link
   */
  private createProviderDescriptionFragment(provider: ProviderNeedApiKey): DocumentFragment | null {
    const config = PROVIDER_CONFIG[provider];

    if (!config) {
      return null;
    }

    const fragment = document.createDocumentFragment();
    const textNode = document.createTextNode(t(`settings.providers.${provider}.desc`) + ' ');
    fragment.appendChild(textNode);

    const link = document.createElement('a');
    link.href = config.linkUrl;
    link.textContent = t(`settings.providers.${provider}.linkText`);
    link.setAttribute('target', '_blank');
    link.setAttribute('rel', 'noopener');
    fragment.appendChild(link);
    setTooltip(link, config.linkUrl);

    return fragment;
  }

  /**
   * Create a provider setting with edit interface for API key and base URL
   * Supports both built-in and custom providers
   */
  public createProviderSetting(
    this: StewardSettingTab,
    provider: string,
    options?: { apiKeyPlaceholder?: string }
  ): void {
    const containerEl = this.containerEl;
    if (!containerEl) {
      logger.error('containerEl not available in ProviderSetting');
      return;
    }

    const isCustom = this.isCustomProvider(provider);
    const isBuiltIn = this.isBuiltInProvider(provider);

    // Function to get provider config
    const getProviderConfig = () => {
      if (!this.plugin.settings.providers[provider]) {
        this.plugin.settings.providers[provider] = {
          apiKey: '',
          ...(isCustom
            ? {
                isCustom: true,
                compatibility: 'openai',
                name: '',
              }
            : {}),
        };
      }
      return this.plugin.settings.providers[provider];
    };

    const config = getProviderConfig();

    // Determine display name
    let displayName: string;
    let settingName: string;
    if (isBuiltIn) {
      const providerConfig = PROVIDER_CONFIG[provider as ProviderNeedApiKey];
      displayName = t(`settings.providers.${provider}.apiKey`);
      settingName = providerConfig.displayName;
    } else {
      displayName = t('settings.apiKey');
      settingName = this.getDisplayName(config.name || provider);
    }

    // Create the Setting instance
    const setting = new Setting(containerEl).setName(settingName);

    // Add description for built-in providers
    if (isBuiltIn) {
      const descriptionFragment = this.createProviderDescriptionFragment(provider);
      if (descriptionFragment) {
        setting.setDesc(descriptionFragment);
      }
    }

    let currentInputWrapper: HTMLElement | null = null;

    // Function to check if provider has API key set
    const hasApiKey = (): boolean => {
      try {
        const providerConfig = getProviderConfig();
        if (!providerConfig.apiKey) {
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
        cls: 'stw-setting-wrapper horizontal text-nowrap',
      });

      // Add delete link for custom providers (same style as Edit link)
      if (isCustom) {
        const deleteLink = currentInputWrapper.createEl('a', {
          text: t('settings.delete'),
          href: '#',
          cls: 'stw-custom-model-link',
        });

        deleteLink.addEventListener('click', async e => {
          e.preventDefault();
          const isConfirming = deleteLink.getAttribute('data-confirming') === 'true';
          const providerConfig = getProviderConfig();
          const needsConfirm = !!providerConfig.name && providerConfig.name.trim() !== '';

          if (isConfirming || !needsConfirm) {
            // Remove the provider from settings
            delete this.plugin.settings.providers[provider];
            await this.plugin.saveSettings();
            // Refresh the settings display
            await this.refreshSettingTab();
          } else {
            // Update text to "Confirm delete" and set confirming attribute
            deleteLink.setText(t('settings.confirmDelete'));
            deleteLink.setAttribute('data-confirming', 'true');
            deleteLink.classList.add('clickable-icon');
          }
        });
      }

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

      const providerConfig = getProviderConfig();

      // Create Provider Name input (only for custom providers)
      if (isCustom) {
        const nameWrapper = currentInputWrapper.createEl('div', {
          cls: 'stw-provider-input-wrapper',
        });

        nameWrapper.createEl('label', {
          text: t('settings.providerName'),
        });

        const nameInput = nameWrapper.createEl('input', {
          type: 'text',
          placeholder: t('settings.providerNamePlaceholder'),
          cls: 'text-input',
          value: providerConfig.name,
        });

        nameInput.addEventListener('change', async e => {
          const target = e.target as HTMLInputElement;
          let value = target.value.trim();

          // Validate: no spaces allowed
          if (value.includes(' ')) {
            new Notice(t('settings.providerNameNoSpaces'));
            value = value.replace(/\s+/g, '');
            target.value = value;
          }

          if (value) {
            providerConfig.name = value;
            await this.plugin.saveSettings();
            // Update the setting name display (format: replace underscores with spaces and capitalize)
            setting.setName(this.getDisplayName(value));
          }
        });
      }
      // For built-in providers, hide the Provider name field

      // Create Compatibility dropdown (only for custom providers)
      if (isCustom) {
        const compatibilityWrapper = currentInputWrapper.createEl('div', {
          cls: 'stw-provider-input-wrapper flex flex-row items-center gap-4',
        });

        compatibilityWrapper.createEl('label', {
          text: t('settings.providerCompatibility'),
        });

        const compatibilitySelect = compatibilityWrapper.createEl('select', {
          cls: 'dropdown',
        });

        // Add options for built-in providers
        for (const builtInProvider of BUILT_IN_PROVIDERS) {
          const option = compatibilitySelect.createEl('option', {
            text: PROVIDER_CONFIG[builtInProvider].displayName,
            value: builtInProvider,
          });
          if (providerConfig.compatibility === builtInProvider) {
            option.selected = true;
          }
        }

        compatibilitySelect.addEventListener('change', async e => {
          const target = e.target as HTMLSelectElement;
          providerConfig.compatibility = target.value as ProviderNeedApiKey;
          await this.plugin.saveSettings();
        });
      }

      const API_KEY_PLACEHOLDER = '••••••••••••••••••••••';

      // Get current API key placeholder
      let apiKeyPlaceholder = options?.apiKeyPlaceholder || t('settings.enterApiKey');
      try {
        const currentKey = this.plugin.encryptionService.getDecryptedApiKey(provider);
        if (currentKey) {
          apiKeyPlaceholder = API_KEY_PLACEHOLDER;
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
        placeholder: apiKeyPlaceholder as string,
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
            target.setAttribute('placeholder', API_KEY_PLACEHOLDER);
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
        providerConfig.baseUrl = value;
        await this.plugin.saveSettings();
      });

      // Create System Prompt textarea (only for custom providers)
      if (isCustom) {
        const systemPromptWrapper = currentInputWrapper.createEl('div', {
          cls: 'stw-provider-input-wrapper',
        });

        systemPromptWrapper.createEl('label', {
          text: t('settings.systemPrompt'),
        });

        const systemPromptTextarea = systemPromptWrapper.createEl('textarea', {
          cls: 'text-input w-full',
        });

        // Set textarea attributes for better UX
        systemPromptTextarea.setAttribute('rows', '4');
        systemPromptTextarea.setAttribute('placeholder', t('settings.systemPromptPlaceholder'));

        if (providerConfig.systemPrompt) {
          systemPromptTextarea.value = providerConfig.systemPrompt;
        }

        systemPromptTextarea.addEventListener('change', async e => {
          const target = e.target as HTMLTextAreaElement;
          const value = target.value.trim();
          providerConfig.systemPrompt = value;
          await this.plugin.saveSettings();
        });
      }
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

  private getDisplayName(name: string): string {
    return capitalizeString(name.replace(/_/g, ' '));
  }
}
