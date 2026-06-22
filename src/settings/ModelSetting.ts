import { getLanguage, setIcon, Setting, setTooltip, Notice } from 'obsidian';
import { getBundledInternal } from 'src/utils/bundledInternals';
import type StewardPlugin from 'src/main';
import { capitalizeString } from 'src/utils/capitalizeString';
import { ModelRegistry, inferTemperaturePolicyFromModelId } from 'src/services/ModelRegistry';
import type { ModelKind, StewardModelDefinition, TestModelInput } from 'src/types/models';

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
      modelKind: ModelKind;
      currentModelField: string;
      placeholder: string;
      showTemperatureControls?: boolean;
      onSelectChange: (modelId: string) => Promise<void>;
      onAddModel: (definition: StewardModelDefinition) => Promise<void>;
      onDeleteModel: (modelId: string) => Promise<void>;
      onTestModel?: (input: TestModelInput) => Promise<void>;
      includeEmptyOption?: boolean;
      emptyOptionLabel?: string;
      emptyOptionValue?: string;
    }
  ): void {
    const { validationPattern = /^[a-zA-Z0-9_.-]+:[^\s]+$/ } = options;
    const modelRegistry = ModelRegistry.getInstance(this.plugin);
    let currentInputWrapper: HTMLElement | null = null;

    const validateModelFormat = (model: string): boolean => {
      return validationPattern.test(model);
    };

    const getCurrentModel = (): string => {
      const parts = options.currentModelField.split('.');
      let value: unknown = this.plugin.settings;
      for (let i = 0; i < parts.length; i++) {
        if (value === null || value === undefined || typeof value !== 'object') {
          return '';
        }
        value = (value as Record<string, unknown>)[parts[i]];
      }
      return typeof value === 'string' ? value : '';
    };

    const createDropdown = () => {
      const wrapper = setting.controlEl.createEl('div', {
        cls: 'stw-setting-wrapper',
      });
      currentInputWrapper = wrapper;

      const select = wrapper.createEl('select', {
        cls: 'dropdown',
      });

      if (options.includeEmptyOption) {
        const emptyOption = select.createEl('option');
        emptyOption.textContent = options.emptyOptionLabel || t('settings.useChatModel');
        emptyOption.value = options.emptyOptionValue || '';
      }

      const allModels = modelRegistry.getModelsForKind(options.modelKind);

      const modelsByProvider = allModels.reduce<Record<string, typeof allModels>>((acc, model) => {
        const { provider } = this.plugin.llmService.parseModel(model.id);
        if (!acc[provider]) {
          acc[provider] = [];
        }
        acc[provider].push(model);
        return acc;
      }, {});

      for (const [provider, models] of Object.entries(modelsByProvider)) {
        const optgroup = select.createEl('optgroup');
        optgroup.setAttribute('label', capitalizeString(provider));

        for (const model of models) {
          const option = optgroup.createEl('option');
          option.textContent = model.name;
          option.value = model.id;
        }
      }

      const currentModel = getCurrentModel();
      select.value = currentModel;

      select.addEventListener('change', e => {
        const target = e.target as HTMLSelectElement;
        void options.onSelectChange(target.value);
      });

      const addNewModelLink = wrapper.createEl('a', {
        text: `${t('settings.addNewModel')}`,
        href: '#',
        cls: 'stw-custom-model-link caret-right',
      });

      addNewModelLink.addEventListener('click', e => {
        e.preventDefault();
        recreateInput('add');
      });

      const userModels = modelRegistry.getUserModels(options.modelKind);
      if (userModels.length > 0) {
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

    const createTextInput = () => {
      const wrapper = setting.controlEl.createEl('div', {
        cls: 'stw-setting-wrapper stw-model-setting-wrapper',
      });
      currentInputWrapper = wrapper;

      const backLink = wrapper.createEl('a', {
        text: t('settings.back'),
        href: '#',
        cls: 'stw-custom-model-link caret-left',
      });

      backLink.addEventListener('click', e => {
        e.preventDefault();
        recreateInput('dropdown');
      });

      const textInput = wrapper.createEl('input', {
        type: 'text',
        placeholder: options.placeholder,
        cls: 'text-input',
      });
      textInput.focus();

      textInput.addEventListener('input', e => {
        const target = e.target as HTMLInputElement;
        const value = target.value;

        if (value && !validateModelFormat(value)) {
          target.addClass('stw-is-invalid');
          return;
        }
        target.removeClass('stw-is-invalid');
      });

      let useTemperature = options.showTemperatureControls !== false;
      let modelTemperature = this.plugin.settings.llm.temperature;

      if (options.showTemperatureControls !== false) {
        const temperatureRow = wrapper.createEl('div', {
          cls: 'stw-model-temperature-row',
        });

        const temperatureToggleSetting = new Setting(temperatureRow)
          .setName(t('settings.useTemperature'))
          .setDesc(t('settings.useTemperatureDesc'))
          .addToggle(toggle => {
            toggle.setValue(useTemperature).onChange(value => {
              useTemperature = value;
              temperatureSliderSetting.settingEl.style.display = value ? '' : 'none';
            });
          });

        const temperatureSliderSetting = new Setting(temperatureRow)
          .setName(t('settings.modelTemperature'))
          .setDesc(t('settings.modelTemperatureDesc'))
          .addSlider(slider => {
            slider
              .setLimits(0, 1, 0.1)
              .setValue(modelTemperature)
              .setDynamicTooltip()
              .onChange(value => {
                modelTemperature = value;
              });
          });

        temperatureSliderSetting.settingEl.style.display = useTemperature ? '' : 'none';
        temperatureToggleSetting.settingEl.addClass('stw-model-temperature-toggle');
        temperatureSliderSetting.settingEl.addClass('stw-model-temperature-slider');
      }

      const actionsRow = wrapper.createEl('div', {
        cls: 'stw-model-setting-actions flex gap-2',
      });

      const testButton = options.onTestModel
        ? actionsRow.createEl('button', {
            text: t('settings.testModel'),
          })
        : null;

      const addButton = actionsRow.createEl('button', {
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
              const showTemperature = options.showTemperatureControls !== false;
              const temperaturePolicy =
                showTemperature && useTemperature ? 'configurable' : 'omit';
              await onTestModel({
                modelId: inputValue,
                temperaturePolicy,
                ...(temperaturePolicy === 'configurable'
                  ? { temperature: modelTemperature }
                  : {}),
              });
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

          const showTemperature = options.showTemperatureControls !== false;
          const temperaturePolicy = showTemperature && useTemperature ? 'configurable' : 'omit';
          const definition: StewardModelDefinition = {
            id: inputValue,
            kinds: [options.modelKind],
            temperaturePolicy,
          };

          if (temperaturePolicy === 'configurable') {
            definition.temperature = modelTemperature;
          } else if (options.modelKind === 'chat' && !showTemperature) {
            definition.temperaturePolicy = inferTemperaturePolicyFromModelId(inputValue);
          }

          await options.onAddModel(definition);
          recreateInput('dropdown');
        })();
      });
    };

    const createDeleteInterface = () => {
      const wrapper = setting.controlEl.createEl('div', {
        cls: 'stw-setting-wrapper',
      });
      currentInputWrapper = wrapper;

      const backLink = wrapper.createEl('a', {
        text: t('settings.back'),
        href: '#',
        cls: 'stw-custom-model-link caret-left',
      });

      backLink.addEventListener('click', e => {
        e.preventDefault();
        recreateInput('dropdown');
      });

      const userModels = modelRegistry.getUserModels(options.modelKind);

      if (userModels.length === 0) {
        wrapper.createEl('div', {
          text: t('settings.customModels') + ': ' + t('settings.noCustomModels'),
          cls: 'stw-no-models',
        });
        return null;
      }

      const modelsList = wrapper.createEl('div', {
        cls: 'stw-custom-models-list',
      });

      for (const model of userModels) {
        const modelItem = modelsList.createEl('div', {
          cls: 'stw-custom-model-item',
        });

        modelItem.createEl('span', { text: model.id });

        const deleteButton = modelItem.createEl('button');
        setIcon(deleteButton, 'trash');
        setTooltip(deleteButton, t('settings.delete'));
        deleteButton.classList.add('clickable-icon');

        deleteButton.addEventListener('click', () => {
          void (async () => {
            await options.onDeleteModel(model.id);
            recreateInput('delete');
          })();
        });
      }
    };

    const recreateInput = (mode: 'delete' | 'add' | 'dropdown') => {
      if (currentInputWrapper) {
        currentInputWrapper.remove();
        currentInputWrapper = null;
      }

      if (mode === 'delete') {
        createDeleteInterface();
      } else if (mode === 'add') {
        createTextInput();
      } else {
        createDropdown();
      }
    };

    recreateInput('dropdown');
  }
}
