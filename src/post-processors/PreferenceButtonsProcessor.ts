import { MarkdownPostProcessor, Notice } from 'obsidian';
import { findTextNodesWithRegex } from 'src/utils/htmlElementUtils';
import { PREFERENCE_BUTTONS_PATTERN, USER_PREFERENCE_WAITING_PLACEHOLDER } from 'src/constants';
import type StewardPlugin from 'src/main';
import { getBundledInternal } from 'src/utils/bundledInternals';
import type { ToolCallPart, UserPreferenceQuestion } from 'src/solutions/commands/tools/types';
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

function isValidPreferenceQuestion(value: unknown): value is UserPreferenceQuestion {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const question = value as UserPreferenceQuestion;
  return typeof question.question === 'string' && Array.isArray(question.options);
}

function getPreferenceQuestions(
  invocations: NonNullable<
    Awaited<
      ReturnType<StewardPlugin['conversationRenderer']['deserializeToolInvocations']>
    >
  >
): UserPreferenceQuestion[] {
  for (let i = 0; i < invocations.length; i++) {
    const part = invocations[i];
    if (part.type === 'tool-call') {
      const questions = part.input.questions;
      if (Array.isArray(questions)) {
        return questions.filter(isValidPreferenceQuestion);
      }
    }
  }
  for (let i = 0; i < invocations.length; i++) {
    const part = invocations[i];
    if (part.type !== 'tool-result') {
      continue;
    }
    const input = (part as unknown as ToolCallPart).input;
    if (input && Array.isArray(input.questions)) {
      return input.questions.filter(isValidPreferenceQuestion);
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

        if (!getToolResultText(invocations)?.includes(USER_PREFERENCE_WAITING_PLACEHOLDER)) {
          lastIndex = match.index + match[0].length;
          continue;
        }

        const questions = getPreferenceQuestions(invocations);
        if (questions.length === 0 || questions.some(q => q.options.length < 2)) {
          replacementElements.push(activeDocument.createTextNode(match[0]));
          lastIndex = match.index + match[0].length;
          continue;
        }

        const container = activeDocument.createElement('div');
        container.classList.add('stw-preference-buttons');
        container.dataset.stwPreferenceBound = '1';

        const selectedIndexes: number[] = new Array(questions.length).fill(-1);
        const customValues: string[] = new Array(questions.length).fill('');

        const updateContinueState = () => {
          const allAnswered = questions.every(
            (_, i) => selectedIndexes[i] >= 0 || customValues[i].trim().length > 0
          );
          continueButton.disabled = !allAnswered;
        };

        questions.forEach((preferenceQuestion, questionIndex) => {
          const questionBlock = container.createDiv({ cls: 'stw-preference-question' });
          questionBlock.createDiv({
            cls: 'stw-preference-question-text',
            text: preferenceQuestion.question,
          });

          const optionsList = questionBlock.createDiv({ cls: 'stw-preference-options' });
          const optionRows: HTMLElement[] = [];

          preferenceQuestion.options.forEach((option, optionIndex) => {
            const optionRow = optionsList.createDiv({
              cls: 'stw-preference-option',
              text: `${optionIndex + 1}. ${option}`,
            });
            optionRows.push(optionRow);
            optionRow.addEventListener('click', (event: MouseEvent) => {
              event.preventDefault();
              event.stopPropagation();
              selectedIndexes[questionIndex] = optionIndex;
              customValues[questionIndex] = '';
              customInput.value = '';
              optionRows.forEach((row, i) => row.classList.toggle('is-selected', i === optionIndex));
              updateContinueState();
            });
          });

          const customInput = questionBlock.createEl('input', {
            cls: 'stw-preference-custom-input',
            attr: { type: 'text', placeholder: String(t('preference.customAnswerPlaceholder')) },
          });
          customInput.addEventListener('input', () => {
            customValues[questionIndex] = customInput.value;
            if (customInput.value.trim().length > 0) {
              selectedIndexes[questionIndex] = -1;
              optionRows.forEach(row => row.classList.remove('is-selected'));
            }
            updateContinueState();
          });
        });

        const actionsRow = container.createDiv({ cls: 'stw-preference-actions' });

        const continueButton = actionsRow.createEl('button', {
          text: t('preference.continue'),
          cls: 'mod-cta stw-preference-continue',
        });
        continueButton.disabled = true;
        continueButton.addEventListener('click', (event: MouseEvent) => {
          event.preventDefault();
          event.stopPropagation();

          const unanswered = questions.some(
            (_, i) => selectedIndexes[i] < 0 && customValues[i].trim().length === 0
          );
          if (unanswered) {
            new Notice(t('preference.selectOptionFirst'));
            return;
          }

          const answers = questions.map((preferenceQuestion, i) => ({
            question: preferenceQuestion.question,
            optionIndex: selectedIndexes[i],
            text:
              selectedIndexes[i] >= 0
                ? preferenceQuestion.options[selectedIndexes[i]]
                : customValues[i].trim(),
          }));

          void handlePreferenceContinue({
            plugin,
            conversationTitle,
            messageId,
            handlerId: toolMessage.handlerId,
            step: toolMessage.step,
            answers,
            lang,
          });
        });

        actionsRow.createEl('span', {
          cls: 'hint',
          text: t('preference.buttonsHint'),
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
  answers: { question: string; optionIndex: number; text: string }[];
  lang?: string | null;
}): Promise<void> {
  const t = getTranslation(params.lang);
  const outputValues = params.answers.map((answer, i) =>
    answer.optionIndex >= 0
      ? `Q${i + 1}: The user selected option ${answer.optionIndex + 1}: ${answer.text}`
      : `Q${i + 1}: The user answered: ${answer.text}`
  );

  const updated = await params.plugin.conversationRenderer.replaceWaitingForUserAnswers(
    params.conversationTitle,
    outputValues
  );
  if (!updated) {
    new Notice(t('preference.updateFailed'));
    return;
  }

  await params.plugin.conversationRenderer.removePreferenceButtons(params.conversationTitle);

  const displayText = params.answers
    .map(answer => `**${answer.question}**\n*${answer.text}*`)
    .join('\n\n');

  await params.plugin.conversationRenderer.updateConversationNote({
    path: params.conversationTitle,
    newContent: displayText,
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
