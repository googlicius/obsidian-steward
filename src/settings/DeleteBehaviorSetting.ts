import { getLanguage, Setting } from 'obsidian';
import { getTranslation } from 'src/i18n';
import { DeleteBehavior } from 'src/types/interfaces';
import type StewardPlugin from 'src/main';

const lang = getLanguage();
const t = getTranslation(lang);

export class DeleteBehaviorSetting {
  protected plugin: StewardPlugin;

  /**
   * Create a delete behavior setting with moving to trash and using Obsidian deleted files
   */
  public createDeleteBehaviorSetting(containerEl: HTMLElement): void {
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
}
