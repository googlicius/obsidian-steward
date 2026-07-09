import {
  getLanguage,
  setIcon,
  Setting,
  setTooltip,
  Notice,
  type DropdownComponent,
} from 'obsidian';
import { getBundledInternal } from 'src/utils/bundledInternals';
import type StewardPlugin from 'src/main';
import { capitalizeString } from 'src/utils/capitalizeString';
import { ModelRegistry, inferTemperaturePolicyFromModelId } from 'src/services/ModelRegistry';
import type {
  ModelKind,
  ReasoningLevel,
  StewardModelDefinition,
  TestModelInput,
} from 'src/types/models';
import type { ReasoningUiMode } from 'src/services/LLMService/reasoningTypes';
import { formatContextLengthTokens, getModelMetadata } from 'src/services/LLMService/modelMetadata';

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
      showReasoningControls?: boolean;
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

      let useTemperature = options.showTemperatureControls !== false;
      let userTouchedTemperature = false;
      let modelTemperature = this.plugin.settings.llm.temperature;
      let temperatureToggleComponent: { setValue: (value: boolean) => void } | null = null;
      let temperatureSliderSettingEl: HTMLElement | null = null;

      const metadataPanel = wrapper.createEl('div', {
        cls: 'stw-model-metadata-panel hidden',
      });

      const metadataRows = {
        toolUse: metadataPanel.createEl('div', { cls: 'stw-model-metadata-row' }),
        temperature: metadataPanel.createEl('div', { cls: 'stw-model-metadata-row' }),
        contextLength: metadataPanel.createEl('div', { cls: 'stw-model-metadata-row' }),
        modalities: metadataPanel.createEl('div', { cls: 'stw-model-metadata-row' }),
      };

      const setMetadataPanelVisible = (visible: boolean) => {
        if (visible) {
          metadataPanel.removeClass('hidden');
        } else {
          metadataPanel.addClass('hidden');
        }
      };

      const setMetadataRow = (row: HTMLElement, label: string, value: string) => {
        row.empty();
        row.createEl('span', {
          cls: 'stw-model-metadata-label',
          text: label,
        });
        row.createEl('span', {
          cls: 'stw-model-metadata-value',
          text: value,
        });
      };

      const syncTemperatureControls = () => {
        if (!temperatureToggleComponent || !temperatureSliderSettingEl) {
          return;
        }
        temperatureToggleComponent.setValue(useTemperature);
        temperatureSliderSettingEl.style.display = useTemperature ? '' : 'none';
      };

      const syncModelMetadata = (modelId: string) => {
        const trimmed = modelId.trim();
        if (!trimmed || !validateModelFormat(trimmed)) {
          setMetadataPanelVisible(false);
          return;
        }

        const metadata = getModelMetadata(trimmed);
        if (!metadata) {
          setMetadataPanelVisible(false);
          return;
        }

        setMetadataRow(
          metadataRows.toolUse,
          t('settings.modelMetadata.toolUse'),
          metadata.toolCall
            ? t('settings.modelMetadata.supported')
            : t('settings.modelMetadata.notSupported')
        );
        setMetadataRow(
          metadataRows.temperature,
          t('settings.modelMetadata.temperature'),
          metadata.temperature
            ? t('settings.modelMetadata.supported')
            : t('settings.modelMetadata.notSupported')
        );
        setMetadataRow(
          metadataRows.contextLength,
          t('settings.modelMetadata.contextLength'),
          typeof metadata.context === 'number'
            ? formatContextLengthTokens(metadata.context)
            : t('settings.modelMetadata.notSupported')
        );
        setMetadataRow(
          metadataRows.modalities,
          t('settings.modelMetadata.modalities'),
          metadata.input.length > 0
            ? metadata.input.join(', ')
            : t('settings.modelMetadata.notSupported')
        );
        setMetadataPanelVisible(true);

        if (
          options.showTemperatureControls !== false &&
          !userTouchedTemperature &&
          metadata.temperature === false
        ) {
          useTemperature = false;
          syncTemperatureControls();
        }
      };

      if (options.showTemperatureControls !== false) {
        const temperatureToggleSetting = new Setting(wrapper)
          .setName(t('settings.useTemperature'))
          .setDesc(t('settings.useTemperatureDesc'))
          .addToggle(toggle => {
            temperatureToggleComponent = toggle;
            toggle.setValue(useTemperature).onChange(value => {
              userTouchedTemperature = true;
              useTemperature = value;
              temperatureSliderSetting.settingEl.style.display = value ? '' : 'none';
            });
          });

        const temperatureSliderSetting = new Setting(wrapper)
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

        temperatureSliderSettingEl = temperatureSliderSetting.settingEl;
        temperatureSliderSetting.settingEl.style.display = useTemperature ? '' : 'none';
        temperatureToggleSetting.settingEl.addClass('stw-model-temperature-toggle');
        temperatureSliderSetting.settingEl.addClass('stw-model-temperature-slider');
      }

      const reasoningService = this.plugin.llmService.reasoningService;
      let reasoningUiMode: ReasoningUiMode = 'hidden';
      let reasoningUiValue = 'provider-default';
      let reasoningSettingEl: HTMLElement | null = null;
      let reasoningDropdown: DropdownComponent | null = null;

      const setReasoningSettingVisible = (visible: boolean) => {
        if (!reasoningSettingEl) {
          return;
        }
        if (visible) {
          reasoningSettingEl.removeClass('stw-model-reasoning-setting--hidden');
        } else {
          reasoningSettingEl.addClass('stw-model-reasoning-setting--hidden');
        }
      };

      const syncReasoningControl = (modelId: string) => {
        if (options.showReasoningControls === false || options.modelKind !== 'chat') {
          setReasoningSettingVisible(false);
          reasoningUiMode = 'hidden';
          return;
        }

        const nextMode = modelId.trim() ? reasoningService.getUiMode(modelId) : 'hidden';
        reasoningUiMode = nextMode;

        if (!reasoningSettingEl || !reasoningDropdown) {
          return;
        }

        if (nextMode === 'hidden') {
          setReasoningSettingVisible(false);
          reasoningUiValue = 'none';
          return;
        }

        setReasoningSettingVisible(true);
        reasoningDropdown.selectEl.empty();

        const uiOptions = reasoningService.getUiOptions(nextMode);
        for (let i = 0; i < uiOptions.length; i++) {
          const option = uiOptions[i];
          reasoningDropdown.addOption(option.value, t(option.labelKey));
        }

        if (!uiOptions.some(option => option.value === reasoningUiValue)) {
          reasoningUiValue = 'provider-default';
        }
        reasoningDropdown.setValue(reasoningUiValue);
      };

      const getReasoningLevel = (): ReasoningLevel => {
        return reasoningService.uiValueToReasoningLevel(reasoningUiValue, reasoningUiMode);
      };

      if (options.showReasoningControls !== false && options.modelKind === 'chat') {
        const reasoningSetting = new Setting(wrapper)
          .setName(t('settings.reasoning'))
          .setDesc(t('settings.reasoningDesc'))
          .addDropdown(dropdown => {
            reasoningDropdown = dropdown;
            dropdown.onChange(value => {
              reasoningUiValue = value;
            });
          });

        reasoningSetting.settingEl.addClass('stw-model-reasoning-setting');
        reasoningSetting.settingEl.addClass('stw-model-reasoning-setting--hidden');
        reasoningSettingEl = reasoningSetting.settingEl;
      }

      textInput.addEventListener('input', e => {
        const target = e.target as HTMLInputElement;
        const value = target.value;

        if (value && !validateModelFormat(value)) {
          target.addClass('stw-is-invalid');
          setMetadataPanelVisible(false);
          return;
        }
        target.removeClass('stw-is-invalid');
        syncReasoningControl(value);
        syncModelMetadata(value);
      });

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
              const temperaturePolicy = showTemperature && useTemperature ? 'configurable' : 'omit';
              await onTestModel({
                modelId: inputValue,
                temperaturePolicy,
                ...(temperaturePolicy === 'configurable' ? { temperature: modelTemperature } : {}),
                ...(reasoningUiMode !== 'hidden' ? { reasoning: getReasoningLevel() } : {}),
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

          if (reasoningUiMode !== 'hidden') {
            definition.reasoning = getReasoningLevel();
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
