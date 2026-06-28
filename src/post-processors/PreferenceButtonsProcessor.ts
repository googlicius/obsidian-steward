import { MarkdownPostProcessor, Notice } from 'obsidian';
import { findTextNodesWithRegex } from 'src/utils/htmlElementUtils';
import { PREFERENCE_BUTTONS_PATTERN } from 'src/constants';
import type StewardPlugin from 'src/main';
import { getBundledInternal } from 'src/utils/bundledInternals';
import type { ToolCallPart } from 'src/solutions/commands/tools/types';
import { logger } from 'src/utils/logger';

const { getTranslation } = getBundledInternal('i18n');

function decodeMarkerSegment(raw: string | undefined): string {
  if (raw == null || raw === '') {
    return '';
  }
  try {
    return decodeURIComponent(raw.trim());
  } catch {
    return raw.trim();
  }
}

async function continueConversationAfterPreference(params: {
  plugin: StewardPlugin;
  conversationTitle: string;
  handlerId?: string;
  step?: number;
  preferenceMessageId: string;
}): Promise<void> {
  const renderer = params.plugin.conversationRenderer;
  const userMessage = await renderer.findUserMessageBeforePreference(
    params.conversationTitle,
    params.preferenceMessageId
  );

  const intentType = userMessage?.intent?.trim() ? userMessage.intent : ' ';
  let query = userMessage?.content ?? '';
  if (intentType && intentType !== ' ') {
    const commandPrefix = `/${intentType}`;
    if (query.startsWith(commandPrefix)) {
      query = query.substring(commandPrefix.length).trimStart();
    }
  }

  const lang = (await renderer.getConversationProperty(params.conversationTitle, 'lang')) as
    | string
    | null;

  const invocationCount = params.step !== undefined ? params.step + 1 : undefined;

  await params.plugin.commandProcessorService.commandProcessor.processIntents(
    {
      title: params.conversationTitle,
      intents: [{ type: intentType, query }],
      lang,
    },
    {
      sendToDownstream: {
        handlerId: params.handlerId,
        invocationCount,
        ignoreClassify: true,
      },
    }
  );
}

function getPreferenceOptions(
  invocations: NonNullable<
    Awaited<
      ReturnType<StewardPlugin['conversationRenderer']['deserializeToolInvocations']>
    >
  >
): string[] {
  for (let i = 0; i < invocations.length; i++) {
    const part = invocations[i];
    if (part.type === 'tool-call') {
      const options = part.input.options;
      if (Array.isArray(options)) {
        return options.filter((item): item is string => typeof item === 'string');
      }
    }
  }
  for (let i = 0; i < invocations.length; i++) {
    const part = invocations[i];
    if (part.type !== 'tool-result') {
      continue;
    }
    const input = (part as unknown as ToolCallPart).input;
    if (input && Array.isArray(input.options)) {
      return input.options.filter((item): item is string => typeof item === 'string');
    }
  }
  return [];
}

function getToolResultText(
  invocations: NonNullable<
    Awaited<
      ReturnType<StewardPlugin['conversationRenderer']['deserializeToolInvocations']>
    >
  >
): string | null {
  for (let i = 0; i < invocations.length; i++) {
    const part = invocations[i];
    if (part.type !== 'tool-result') {
      continue;
    }
    const output = part.output;
    if (
      output &&
      typeof output === 'object' &&
      'value' in output &&
      typeof output.value === 'string'
    ) {
      return output.value;
    }
  }
  return null;
}

/**
 * Renders {{stw-preference-buttons}} markers as selectable options with a Continue button.
 */
export function createPreferenceButtonsProcessor(plugin: StewardPlugin): MarkdownPostProcessor {
  return async el => {
    if (!el.textContent?.includes('{{stw-preference-buttons')) {
      return;
    }

    const textNodes = findTextNodesWithRegex(el, new RegExp(PREFERENCE_BUTTONS_PATTERN, 'g'));
    if (textNodes.length === 0) {
      return;
    }

    for (const textNode of textNodes) {
      const replacementElements: (HTMLElement | Text)[] = [];
      const textContent = textNode.textContent || '';
      const regex = new RegExp(PREFERENCE_BUTTONS_PATTERN, 'g');
      let lastIndex = 0;
      let match: RegExpExecArray | null;

      while ((match = regex.exec(textContent)) !== null) {
        if (match.index > lastIndex) {
          const beforeText = textContent.substring(lastIndex, match.index);
          if (beforeText) {
            replacementElements.push(activeDocument.createTextNode(beforeText));
          }
        }

        const [, titleEnc, messageIdEnc] = match;
        const conversationTitle = decodeMarkerSegment(titleEnc);
        const messageId = decodeMarkerSegment(messageIdEnc);

        const lang = await plugin.conversationRenderer.getConversationProperty<string>(
          conversationTitle,
          'lang'
        );
        const t = getTranslation(lang);

        const toolMessage = await plugin.conversationRenderer.getMessageById(
          conversationTitle,
          messageId,
          true
        );
        if (!toolMessage) {
          replacementElements.push(activeDocument.createTextNode(match[0]));
          lastIndex = match.index + match[0].length;
          continue;
        }

        const invocations = await plugin.conversationRenderer.deserializeToolInvocations({
          message: toolMessage,
          conversationTitle,
        });
        if (!invocations?.length) {
          replacementElements.push(activeDocument.createTextNode(match[0]));
          lastIndex = match.index + match[0].length;
          continue;
        }

        if (getToolResultText(invocations) !== 'waiting_for_user_answer') {
          lastIndex = match.index + match[0].length;
          continue;
        }

        const options = getPreferenceOptions(invocations);
        if (options.length < 2) {
          replacementElements.push(activeDocument.createTextNode(match[0]));
          lastIndex = match.index + match[0].length;
          continue;
        }

        const container = activeDocument.createElement('div');
        container.classList.add('stw-preference-buttons');
        container.dataset.stwPreferenceBound = '1';

        const optionsList = container.createDiv({ cls: 'stw-preference-options' });
        let selectedIndex = -1;

        for (let optionIndex = 0; optionIndex < options.length; optionIndex++) {
          const optionRow = optionsList.createDiv({
            cls: 'stw-preference-option',
            text: `${optionIndex + 1}. ${options[optionIndex]}`,
          });
          optionRow.addEventListener('click', (event: MouseEvent) => {
            event.preventDefault();
            event.stopPropagation();
            selectedIndex = optionIndex;
            const optionRows = optionsList.querySelectorAll('.stw-preference-option');
            for (let i = 0; i < optionRows.length; i++) {
              optionRows[i].classList.toggle('is-selected', i === optionIndex);
            }
            continueButton.disabled = false;
          });
        }

        const actionsRow = container.createDiv({ cls: 'stw-preference-actions' });

        const continueButton = actionsRow.createEl('button', {
          text: t('preference.continue'),
          cls: 'mod-cta stw-preference-continue',
        });
        continueButton.disabled = true;
        continueButton.addEventListener('click', (event: MouseEvent) => {
          event.preventDefault();
          event.stopPropagation();
          if (selectedIndex < 0) {
            new Notice(t('preference.selectOptionFirst'));
            return;
          }

          void handlePreferenceContinue({
            plugin,
            conversationTitle,
            messageId,
            handlerId: toolMessage.handlerId,
            step: toolMessage.step,
            selectedIndex,
            selectedOption: options[selectedIndex],
            lang,
          });
        });

        actionsRow.createEl('span', {
          cls: 'hint',
          text: `or ${t('preference.buttonsHint')}`,
        });

        replacementElements.push(container);
        lastIndex = match.index + match[0].length;
      }

      if (lastIndex < textContent.length) {
        const afterText = textContent.substring(lastIndex);
        if (afterText) {
          replacementElements.push(activeDocument.createTextNode(afterText));
        }
      }

      if (replacementElements.length > 0) {
        textNode.replaceWith(...replacementElements);
      }
    }
  };
}

async function handlePreferenceContinue(params: {
  plugin: StewardPlugin;
  conversationTitle: string;
  messageId: string;
  handlerId?: string;
  step?: number;
  selectedIndex: number;
  selectedOption: string;
  lang?: string | null;
}): Promise<void> {
  const t = getTranslation(params.lang);
  const outputValue = `The user selected option ${params.selectedIndex + 1}: ${params.selectedOption}`;

  const updated = await params.plugin.conversationRenderer.replaceWaitingForUserAnswer(
    params.conversationTitle,
    outputValue
  );
  if (!updated) {
    new Notice(t('preference.updateFailed'));
    return;
  }

  await params.plugin.conversationRenderer.removePreferenceButtons(params.conversationTitle);

  await params.plugin.conversationRenderer.updateConversationNote({
    path: params.conversationTitle,
    newContent: `*${params.selectedOption}*`,
    includeHistory: false,
    handlerId: params.handlerId,
    step: params.step,
  });

  try {
    await continueConversationAfterPreference({
      plugin: params.plugin,
      conversationTitle: params.conversationTitle,
      handlerId: params.handlerId,
      step: params.step,
      preferenceMessageId: params.messageId,
    });
  } catch (error) {
    logger.error('Preference continue failed:', error);
  }
}
