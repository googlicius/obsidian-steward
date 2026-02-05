import { getLanguage, setIcon, Setting, setTooltip } from 'obsidian';
import { getTranslation } from 'src/i18n';
import { capitalizeString } from 'src/utils/capitalizeString';
import { get } from 'src/utils/lodash-like';
import { LLM_MODELS } from 'src/constants';
import type StewardPlugin from 'src/main';

const lang = getLanguage();
const t = getTranslation(lang);

export class ModelFallbackSetting {
  protected plugin: StewardPlugin;

  private getFallbackChain(): string[] {
    return get(this.plugin.settings, 'llm.modelFallback.fallbackChain') || [];
  }

  private getAllAvailableModels() {
    const customModels = (get(this.plugin.settings, 'llm.chat.customModels') as string[]) || [];

    return [
      ...LLM_MODELS.map(model => ({
        id: model.id,
        name: model.name || model.id,
      })),
      ...customModels.map(model => ({
        id: model,
        name: this.plugin.llmService.getModelDisplayName(model),
      })),
    ];
  }

  /**
   * Create a model fallback setting with ordered list management
   */
  public createModelFallbackSetting(setting: Setting): void {
    let currentInputWrapper: HTMLElement | null = null;

    // Function to create the fallback chain interface
    const createFallbackChainInterface = () => {
      // Create wrapper div
      const wrapper = setting.controlEl.createEl('div', {
        cls: 'stw-setting-wrapper',
      });
      currentInputWrapper = wrapper;

      const fallbackChain = this.getFallbackChain();
      const allModels = this.getAllAvailableModels();

      if (fallbackChain.length === 0) {
        // Show empty state
        wrapper.createEl('div', {
          text: t('settings.modelFallback.noFallbackModels'),
          cls: 'stw-no-models',
        });

        const addFirstModelLink = wrapper.createEl('a', {
          text: t('settings.modelFallback.addFirstModel'),
          href: '#',
          cls: 'stw-custom-model-link caret-right',
        });

        addFirstModelLink.addEventListener('click', e => {
          e.preventDefault();
          recreateInput('add');
        });

        return;
      }

      // Create models list with drag-and-drop support
      const modelsList = wrapper.createEl('div', {
        cls: 'stw-custom-models-list',
      });

      fallbackChain.forEach((modelId, index) => {
        const modelItem = modelsList.createEl('div', {
          cls: 'stw-custom-model-item',
          attr: { 'data-model-id': modelId, 'data-index': index.toString() },
        });

        const modelName = allModels.find(m => m.id === modelId)?.name || modelId;
        modelItem.createEl('span', {
          text: `${index + 1}. ${modelName}`,
        });

        // Action buttons container
        const actions = modelItem.createEl('div', {
          cls: 'stw-model-actions',
        });

        // Move up button
        if (index > 0) {
          const moveUpButton = actions.createEl('button');
          setIcon(moveUpButton, 'chevron-up');
          setTooltip(moveUpButton, t('settings.modelFallback.moveUp'));
          moveUpButton.classList.add('clickable-icon');
          moveUpButton.addEventListener('click', () => {
            moveModelInChain(index, index - 1);
          });
        }

        // Move down button
        if (index < fallbackChain.length - 1) {
          const moveDownButton = actions.createEl('button');
          setIcon(moveDownButton, 'chevron-down');
          setTooltip(moveDownButton, t('settings.modelFallback.moveDown'));
          moveDownButton.classList.add('clickable-icon');
          moveDownButton.addEventListener('click', () => {
            moveModelInChain(index, index + 1);
          });
        }

        // Remove button
        const removeButton = actions.createEl('button');
        setIcon(removeButton, 'trash');
        setTooltip(removeButton, t('settings.delete'));
        removeButton.classList.add('clickable-icon');
        removeButton.addEventListener('click', () => {
          removeModelFromChain(index);
        });
      });

      const addModelLink = wrapper.createEl('a', {
        text: t('settings.addNewModel'),
        href: '#',
        cls: 'stw-custom-model-link caret-right',
      });

      addModelLink.addEventListener('click', e => {
        e.preventDefault();
        recreateInput('add');
      });
    };

    // Function to create add model interface
    const createAddModelInterface = () => {
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
        recreateInput('chain');
      });

      const fallbackChain = this.getFallbackChain();
      const allModels = this.getAllAvailableModels();

      // Filter out models already in the chain
      const availableModels = allModels.filter(model => !fallbackChain.includes(model.id));

      if (availableModels.length === 0) {
        wrapper.createEl('div', {
          text: t('settings.modelFallback.noAvailableModels'),
          cls: 'stw-no-models',
        });
        return;
      }

      // Create select dropdown
      const select = wrapper.createEl('select', {
        cls: 'dropdown',
      });

      // Group available models by provider (same logic as ModelSetting)
      const modelsByProvider = availableModels.reduce<Record<string, typeof availableModels>>(
        (acc, model) => {
          const { provider } = this.plugin.llmService.parseModel(model.id);
          if (!acc[provider]) {
            acc[provider] = [];
          }
          acc[provider].push(model);
          return acc;
        },
        {}
      );

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

      // Add button
      const addButton = wrapper.createEl('button', {
        text: t('settings.modelFallback.addToChain'),
      });

      addButton.addEventListener('click', async () => {
        const selectedModel = select.value;
        if (selectedModel) {
          await addModelToChain(selectedModel);
          recreateInput('chain');
        }
      });
    };

    // Helper functions
    const moveModelInChain = async (fromIndex: number, toIndex: number) => {
      const fallbackChain = this.getFallbackChain();
      const model = fallbackChain[fromIndex];

      // Remove from original position
      fallbackChain.splice(fromIndex, 1);
      // Insert at new position
      fallbackChain.splice(toIndex, 0, model);

      this.plugin.settings.llm.modelFallback.fallbackChain = fallbackChain;
      await this.plugin.saveSettings();
      recreateInput('chain');
    };

    const removeModelFromChain = async (index: number) => {
      const fallbackChain = this.getFallbackChain();
      fallbackChain.splice(index, 1);

      this.plugin.settings.llm.modelFallback.fallbackChain = fallbackChain;
      await this.plugin.saveSettings();
      recreateInput('chain');
    };

    const addModelToChain = async (modelId: string) => {
      const fallbackChain = this.getFallbackChain();
      fallbackChain.push(modelId);

      this.plugin.settings.llm.modelFallback.fallbackChain = fallbackChain;
      await this.plugin.saveSettings();
    };

    // Function to remove current input and create new one
    const recreateInput = (mode: 'add' | 'chain') => {
      // Remove current wrapper if it exists
      if (currentInputWrapper) {
        currentInputWrapper.remove();
        currentInputWrapper = null;
      }

      // Create new input based on current mode
      if (mode === 'add') {
        createAddModelInterface();
      } else {
        createFallbackChainInterface();
      }
    };

    // Initialize with fallback chain interface
    recreateInput('chain');
  }
}
