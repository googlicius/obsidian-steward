import { getLanguage, setIcon, Setting, setTooltip, Notice } from 'obsidian';
import { getBundledInternal } from 'src/utils/bundledInternals';
import type StewardPlugin from 'src/main';
import { capitalizeString } from 'src/utils/capitalizeString';
import { get } from 'src/utils/lodash-like';

const { getTranslation } = getBundledInternal('i18n');
const lang = getLanguage();
const t = getTranslation(lang);

export class ModelSetting {
  protected plugin: StewardPlugin;

  /**
   * Create a model setting with adding new model and deleting custom models
   */
  public createModelSetting(
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
      onTestModel?: (modelId: string) => Promise<void>;
      includeEmptyOption?: boolean;
      emptyOptionLabel?: string;
      emptyOptionValue?: string;
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

      if (options.includeEmptyOption) {
        const emptyOption = select.createEl('option');
        emptyOption.textContent = options.emptyOptionLabel || t('settings.useChatModel');
        emptyOption.value = options.emptyOptionValue || '';
      }

      // Combine preset models and custom models
      const allModels = [
        ...options.presetModels.map(model => ({
          id: model.id,
          name: model.name || model.id,
        })),
        ...getCustomModels().map(model => ({
          id: model,
          name: this.plugin.llmService.getModelDisplayName(model),
        })),
      ];

      // Group models by provider
      const modelsByProvider = allModels.reduce<Record<string, typeof allModels>>((acc, model) => {
        const { provider } = this.plugin.llmService.parseModel(model.id);
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

      select.addEventListener('change', e => {
        const target = e.target as HTMLSelectElement;
        void options.onSelectChange(target.value);
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
        cls: 'stw-setting-wrapper stw-model-setting-wrapper',
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
          target.addClass('stw-is-invalid');
          return;
        }
        target.removeClass('stw-is-invalid');
      });

      // Add Test button next to the text input
      const testButton = options.onTestModel
        ? wrapper.createEl('button', {
            text: t('settings.testModel'),
          })
        : null;

      // Add Add button next to the text input
      const addButton = wrapper.createEl('button', {
        text: t('settings.add'),
      });

      const setActionButtonsDisabled = (disabled: boolean) => {
        if (testButton) {
          testButton.disabled = disabled;
        }
        addButton.disabled = disabled;
      };

      if (testButton && options.onTestModel) {
        const onTestModel = options.onTestModel;
        testButton.addEventListener('click', () => {
          void (async () => {
            const inputValue = textInput.value.trim();

            if (!inputValue) {
              return;
            }

            if (!validateModelFormat(inputValue)) {
              textInput.addClass('stw-is-invalid');
              return;
            }

            textInput.removeClass('stw-is-invalid');
            setActionButtonsDisabled(true);
            new Notice(t('settings.testModelRunning'));

            try {
              await onTestModel(inputValue);
              new Notice(t('settings.testModelSuccess'));
            } catch (error) {
              const message = error instanceof Error ? error.message : String(error);
              new Notice(t('settings.testModelFailed', { message }), 5000);
            } finally {
              setActionButtonsDisabled(false);
            }
          })();
        });
      }

      // Add button click handler
      addButton.addEventListener('click', () => {
        void (async () => {
          const inputValue = textInput.value.trim();

          if (!inputValue) {
            return;
          }

          if (!validateModelFormat(inputValue)) {
            textInput.addClass('stw-is-invalid');
            return;
          }

          textInput.removeClass('stw-is-invalid');

          await options.onAddModel(inputValue);
          recreateInput('dropdown');
        })();
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

        deleteButton.addEventListener('click', () => {
          void (async () => {
            await options.onDeleteModel(modelId);
            recreateInput('delete');
          })();
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
