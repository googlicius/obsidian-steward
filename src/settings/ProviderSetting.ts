import { App, getLanguage, Setting, setIcon, setTooltip, SecretComponent, Notice } from 'obsidian';
import type StewardPlugin from 'src/main';
import { ProviderNeedApiKey } from 'src/constants';
import { logger } from 'src/utils/logger';
import { capitalizeString } from 'src/utils/capitalizeString';
import { createFragmentFromText } from 'src/utils/htmlElementUtils';
import type StewardSettingTab from 'src/settings';
import { getBundledInternal } from 'src/utils/bundledInternals';

const { getTranslation } = getBundledInternal('i18n');

const lang = getLanguage();
const t = getTranslation(lang);

function supportsSecretStorage(app: App): boolean {
  return typeof SecretComponent !== 'undefined' && 'secretStorage' in app;
}

function getStoredSecret(app: App, secretName: string): string | null {
  if (!supportsSecretStorage(app)) {
    return null;
  }
  // Runtime-guarded: SecretStorage is only available on Obsidian >= 1.11.4.
  // eslint-disable-next-line obsidianmd/no-unsupported-api -- runtime-guarded
  return app.secretStorage.getSecret(secretName);
}

// Provider configuration mapping
const PROVIDER_CONFIG: Record<ProviderNeedApiKey, { displayName: string }> = {
  openai: { displayName: 'OpenAI' },
  elevenlabs: { displayName: 'ElevenLabs' },
  google: { displayName: 'Google' },
  anthropic: { displayName: 'Anthropic' },
  ollama: { displayName: 'Ollama' },
  hume: { displayName: 'Hume' },
};

// List of built-in providers for compatibility dropdown
const BUILT_IN_PROVIDERS: ProviderNeedApiKey[] = [
  'openai',
  'elevenlabs',
  'google',
  'anthropic',
  'ollama',
  'hume',
];

// Popular provider presets — auto-fill compatibility, base URL, and description
// when the user types a matching custom provider name (fuzzy: "deepseek-1", "openrouter2", etc.)
const POPULAR_PROVIDER_PRESETS: Record<
  string,
  { compatibility: ProviderNeedApiKey; baseUrl: string; description: string }
> = {
  deepseek: {
    compatibility: 'openai',
    baseUrl: 'https://api.deepseek.com/v1',
    description:
      'OpenAI-compatible.\nModels: https://api-docs.deepseek.com/quick_start/pricing\nAPI keys: https://platform.deepseek.com/api_keys',
  },
  openrouter: {
    compatibility: 'openai',
    baseUrl: 'https://openrouter.ai/api/v1',
    description:
      'Multi-model gateway.\nModels: https://openrouter.ai/models\nAPI keys: https://openrouter.ai/keys',
  },
  groq: {
    compatibility: 'openai',
    baseUrl: 'https://api.groq.com/openai/v1',
    description:
      'Fast inference, OpenAI-compatible.\nModels: https://console.groq.com/docs/models\nAPI keys: https://console.groq.com/keys',
  },
  kimi: {
    compatibility: 'openai',
    baseUrl: 'https://api.moonshot.ai/v1',
    description:
      'Moonshot AI, OpenAI-compatible.\nModels: https://platform.moonshot.ai/docs\nAPI keys: https://platform.moonshot.ai/console/api-keys',
  },
  'z.ai': {
    compatibility: 'openai',
    baseUrl: 'https://api.z.ai/api/paas/v4',
    description:
      '01.AI Yi models, OpenAI-compatible.\nModels: https://z.ai/models\nAPI keys: https://z.ai/api-keys',
  },
};

/**
 * Fuzzy-match a provider name against popular presets and built-in providers.
 * Returns compatibility + optional baseUrl, or null if no match.
 */
function findProviderPreset(
  name: string
): { compatibility: ProviderNeedApiKey; baseUrl?: string; description?: string } | null {
  const normalizedName = name.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (!normalizedName) return null;

  // Check popular presets first
  for (const [key, preset] of Object.entries(POPULAR_PROVIDER_PRESETS)) {
    const normalizedKey = key.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (normalizedName.includes(normalizedKey)) {
      return {
        compatibility: preset.compatibility,
        baseUrl: preset.baseUrl,
        description: preset.description,
      };
    }
  }

  // Check built-in providers (fill compatibility, leave URL empty to use default)
  for (const builtIn of BUILT_IN_PROVIDERS) {
    const normalizedBuiltIn = builtIn.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (normalizedName.includes(normalizedBuiltIn)) {
      return { compatibility: builtIn };
    }
  }

  return null;
}

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
   * Get the description for a provider (built-in or custom)
   */
  private getProviderDescription(provider: string): string | null {
    if (this.isBuiltInProvider(provider)) {
      return t(`settings.providers.${provider}.description`);
    }

    // Custom provider - get description from config
    return this.plugin.settings.providers[provider]?.description || null;
  }

  /**
   * Create a provider setting with edit interface for API key and base URL
   * Supports both built-in and custom providers
   */
  public createProviderSetting(
    this: StewardSettingTab,
    containerEl: HTMLElement,
    provider: string,
    options?: { apiKeyPlaceholder?: string }
  ): void {
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
      const providerConfig = PROVIDER_CONFIG[provider];
      displayName = t(`settings.providers.${provider}.apiKey`);
      settingName = providerConfig.displayName;
    } else {
      displayName = t('settings.apiKey');
      settingName = this.getDisplayName(config.name || provider);
    }

    // Create the Setting instance
    const setting = new Setting(containerEl).setName(settingName);
    setting.settingEl.dataset.providerKey = provider;

    // Add description for both built-in and custom providers
    const description = this.getProviderDescription(provider);
    if (description) {
      setting.setDesc(createFragmentFromText(description));
    } else if (isCustom && !config.name) {
      // Show hint for newly-added custom providers that haven't been named yet
      setting.setDesc(createFragmentFromText(t('settings.defaultNewProviderDesc')));
    }

    let currentInputWrapper: HTMLElement | null = null;

    // Function to check if provider has API key set
    const hasApiKey = (): boolean => {
      try {
        const providerConfig = getProviderConfig();
        if (!providerConfig.apiKey) {
          return false;
        }

        // For secret storage, check if secret name is set and valid
        if (providerConfig.apiKeySource === 'secret') {
          const secret = getStoredSecret(this.plugin.app, providerConfig.apiKey);
          return !!secret;
        }

        // For direct input, try to decrypt
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

        deleteLink.addEventListener('click', e => {
          void (async () => {
            e.preventDefault();
            const isConfirming = deleteLink.getAttribute('data-confirming') === 'true';
            const providerConfig = getProviderConfig();
            const needsConfirm = !!providerConfig.name && providerConfig.name.trim() !== '';

            if (isConfirming || !needsConfirm) {
              delete this.plugin.settings.providers[provider];
              await this.plugin.saveSettings();
              await this.refreshSettingTab();
            } else {
              deleteLink.setText(t('settings.confirmDelete'));
              deleteLink.setAttribute('data-confirming', 'true');
              deleteLink.classList.add('clickable-icon');
            }
          })();
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

      // References for auto-fill — assigned when compatibility/baseUrl/description elements are created
      let compatibilitySelectEl: HTMLSelectElement | null = null;
      let baseUrlInputEl: HTMLInputElement | null = null;
      let descriptionTextareaEl: HTMLTextAreaElement | null = null;

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

        nameInput.addEventListener('change', e => {
          const target = e.target as HTMLInputElement;
          let value = target.value.trim();

          if (value.includes(' ')) {
            new Notice(t('settings.providerNameNoSpaces'));
            value = value.replace(/\s+/g, '');
            target.value = value;
          }

          if (value) {
            providerConfig.name = value;
            void this.plugin.saveSettings();
            setting.setName(this.getDisplayName(value));
            setting.setDesc('');

            // Auto-fill compatibility, base URL, and description for known popular providers
            const preset = findProviderPreset(value);
            if (preset) {
              if (compatibilitySelectEl) {
                compatibilitySelectEl.value = preset.compatibility;
                providerConfig.compatibility = preset.compatibility;
              }
              if (baseUrlInputEl && preset.baseUrl !== undefined) {
                baseUrlInputEl.value = preset.baseUrl;
                providerConfig.baseUrl = preset.baseUrl;
              }
              if (descriptionTextareaEl && preset.description !== undefined) {
                descriptionTextareaEl.value = preset.description;
                providerConfig.description = preset.description;
                setting.setDesc(createFragmentFromText(preset.description));
              }
              void this.plugin.saveSettings();
            }
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
        compatibilitySelectEl = compatibilitySelect;

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

        compatibilitySelect.addEventListener('change', e => {
          const target = e.target as HTMLSelectElement;
          if (!this.isBuiltInProvider(target.value)) {
            return;
          }
          providerConfig.compatibility = target.value;
          void this.plugin.saveSettings();
        });
      }

      const API_KEY_PLACEHOLDER = '••••••••••••••••••••••';

      // Check if using secret storage
      const isUsingSecretStorage = providerConfig.apiKeySource === 'secret';

      // Create API key wrapper
      const apiKeyWrapper = currentInputWrapper.createEl('div', {
        cls: 'stw-provider-input-wrapper',
      });

      apiKeyWrapper.createEl('label', {
        text: displayName,
      });

      // Helper function to create direct input view
      const createDirectInputView = () => {
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

        // Create input container with flex layout for input + button
        const inputContainer = apiKeyWrapper.createEl('div', {
          cls: 'stw-provider-input-container gap-1',
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

          clearButton.addEventListener('click', () => {
            void (async () => {
              try {
                await this.plugin.encryptionService.setEncryptedApiKey(provider, '');
                recreateInput('edit');
              } catch (error) {
                new Notice(t('settings.failedToClearApiKey'));
                logger.error(`Error clearing ${provider} API key:`, error);
              }
            })();
          });
        }

        apiKeyInput.addEventListener('change', e => {
          void (async () => {
            const target = e.target as HTMLInputElement;
            const value = target.value.trim();

            if (value) {
              try {
                await this.plugin.encryptionService.setEncryptedApiKey(provider, value);
                target.setAttribute('placeholder', API_KEY_PLACEHOLDER);
                target.value = '';
                recreateInput('edit');
              } catch (error) {
                new Notice(t('settings.failedToSaveApiKey'));
                logger.error(`Error setting ${provider} API key:`, error);
              }
            }
          })();
        });

        // Add "Use secret storage" link when API key is empty and Obsidian supports SecretComponent
        if (!hasApiKey() && supportsSecretStorage(this.app)) {
          const secretStorageLink = apiKeyWrapper.createEl('a', {
            text: t('settings.useSecretStorage'),
            href: '#',
            cls: 'stw-custom-model-link',
          });

          secretStorageLink.addEventListener('click', e => {
            e.preventDefault();
            providerConfig.apiKeySource = 'secret';
            providerConfig.apiKey = '';
            void this.plugin.saveSettings();
            recreateInput('edit');
          });
        }
      };

      // Helper function to create secret storage view
      const createSecretStorageView = () => {
        // Create secret component container
        const secretContainer = apiKeyWrapper.createEl('div', {
          cls: 'stw-provider-input-container flex items-center justify-between gap-2',
        });

        // Add description
        secretContainer.createEl('div', {
          text: t('settings.secretStorageDesc'),
          cls: 'setting-item-description',
        });

        // Create wrapper for SecretComponent
        const secretComponentWrapper = secretContainer.createEl('div', {
          cls: 'stw-secret-component-wrapper flex items-center gap-2',
        });

        if (supportsSecretStorage(this.app)) {
          // Runtime-guarded: SecretComponent is only available on Obsidian >= 1.11.1.
          // eslint-disable-next-line obsidianmd/no-unsupported-api -- runtime-guarded
          new SecretComponent(this.app, secretComponentWrapper)
            .setValue(providerConfig.apiKey || '')
            .onChange((secretName: string) => {
              providerConfig.apiKey = secretName;
              providerConfig.apiKeySource = 'secret';
              void this.plugin.saveSettings();
            });
        }

        // Add "Switch to direct input" link
        const switchToDirectLink = apiKeyWrapper.createEl('a', {
          text: t('settings.switchToDirectInput'),
          href: '#',
          cls: 'stw-custom-model-link',
        });

        switchToDirectLink.addEventListener('click', e => {
          e.preventDefault();
          providerConfig.apiKeySource = 'direct';
          providerConfig.apiKey = '';
          void this.plugin.saveSettings();
          recreateInput('edit');
        });
      };

      // Render appropriate view based on apiKeySource
      if (isUsingSecretStorage) {
        createSecretStorageView();
      } else {
        createDirectInputView();
      }

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
      baseUrlInputEl = baseUrlInput;

      baseUrlInput.addEventListener('change', e => {
        const target = e.target as HTMLInputElement;
        providerConfig.baseUrl = target.value.trim();
        void this.plugin.saveSettings();
      });

      // Create Description textarea (only for custom providers)
      if (isCustom) {
        const descriptionWrapper = currentInputWrapper.createEl('div', {
          cls: 'stw-provider-input-wrapper',
        });

        descriptionWrapper.createEl('label', {
          text: t('settings.providerDescription'),
        });

        const descriptionTextarea = descriptionWrapper.createEl('textarea', {
          cls: 'text-input w-full',
        });
        descriptionTextareaEl = descriptionTextarea;

        // Set textarea attributes for better UX
        descriptionTextarea.setAttribute('rows', '2');
        descriptionTextarea.setAttribute(
          'placeholder',
          t('settings.providerDescriptionPlaceholder')
        );

        if (providerConfig.description) {
          descriptionTextarea.value = providerConfig.description;
        }

        descriptionTextarea.addEventListener('change', e => {
          const target = e.target as HTMLTextAreaElement;
          const value = target.value.trim();
          providerConfig.description = value;
          void this.plugin.saveSettings();
          if (value) {
            setting.setDesc(createFragmentFromText(value));
          } else {
            setting.setDesc('');
          }
        });
      }

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

        systemPromptTextarea.addEventListener('change', e => {
          const target = e.target as HTMLTextAreaElement;
          providerConfig.systemPrompt = target.value.trim();
          void this.plugin.saveSettings();
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

  public highlightProviderSetting(this: StewardSettingTab, providerKey: string): void {
    const row = this.containerEl.querySelector(`[data-provider-key="${CSS.escape(providerKey)}"]`);
    if (!(row instanceof HTMLElement)) {
      return;
    }

    row.classList.add('stw-provider-highlight');
  }
}
