import { Notice, Setting } from 'obsidian';
import { getLanguage } from 'obsidian';
import { ProviderNeedApiKey } from 'src/constants';
import { getTranslation } from 'src/i18n';
import type StewardSettingTab from 'src/settings';
import { logger } from 'src/utils/logger';

const lang = getLanguage();
const t = getTranslation(lang);

export class ApiKeySetting {
  /**
   * Helper function to create API key settings
   * @param containerEl - The container element
   * @param provider - The provider name (e.g., 'openai', 'groq')
   * @param displayName - The display name for the setting
   */
  public createApiKeySetting(
    this: StewardSettingTab,
    containerEl: HTMLElement,
    provider: ProviderNeedApiKey,
    displayName: string
  ): void {
    new Setting(containerEl)
      .setName(displayName)
      .addText(text => {
        // Get the current API key (decrypted) with error handling
        let placeholder = t('settings.enterApiKey');
        try {
          const currentKey = this.plugin.encryptionService.getDecryptedApiKey(provider);
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
                await this.plugin.encryptionService.setEncryptedApiKey(provider, value);

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
              await this.plugin.encryptionService.setEncryptedApiKey(provider, '');
              // Force refresh of the settings
              this.display();
            } catch (error) {
              new Notice(t('settings.failedToClearApiKey'));
              logger.error(`Error clearing ${provider} API key:`, error);
            }
          });
      });
  }
}
