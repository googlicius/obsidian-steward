import { PREFERENCE_BUTTONS_PATTERN, USER_PREFERENCE_WAITING_PLACEHOLDER } from 'src/constants';
import type { ConversationMessage } from 'src/types/types';
import type { ConversationRenderer } from './ConversationRenderer';

export type PendingUserPreferenceContext = {
  messageId: string;
  handlerId?: string;
  step?: number;
};

type UserPreferenceSerializationHost = Pick<
  ConversationRenderer,
  'plugin' | 'getConversationFileByName'
>;

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

function encodeMarkerSegment(value: string): string {
  return encodeURIComponent(value);
}

/** Escape text embedded inside a JSON string literal (surrounding quotes stay in the note). */
function escapeForJsonStringContent(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t');
}

export class UserPreferenceSerialization {
  /**
   * Cheap check before resolving a typed reply — avoids scanning every message on each turn.
   */
  public async hasPendingUserPreference(
    this: UserPreferenceSerializationHost,
    conversationTitle: string
  ): Promise<boolean> {
    const file = this.getConversationFileByName(conversationTitle);
    const content = await this.plugin.app.vault.cachedRead(file);
    return content.includes(USER_PREFERENCE_WAITING_PLACEHOLDER);
  }

  public async showPreferenceButtons(
    this: UserPreferenceSerializationHost,
    params: {
      conversationTitle: string;
      messageId: string;
    }
  ): Promise<void> {
    const file = this.getConversationFileByName(params.conversationTitle);
    const marker = `{{stw-preference-buttons title:${encodeMarkerSegment(params.conversationTitle)},messageId:${encodeMarkerSegment(params.messageId)}}}`;

    await this.plugin.app.vault.process(file, currentContent => {
      return `${currentContent}\n\n${marker}`;
    });
  }

  public async removePreferenceButtons(
    this: UserPreferenceSerializationHost,
    conversationTitle: string,
    message?: string
  ): Promise<void> {
    const file = this.getConversationFileByName(conversationTitle);
    const pattern = new RegExp(PREFERENCE_BUTTONS_PATTERN, 'g');
    const replacement = message ? `*${message}*` : '';

    await this.plugin.app.vault.process(file, currentContent => {
      return currentContent.replace(pattern, (full, titleEnc) => {
        const title = decodeMarkerSegment(titleEnc);
        return title === conversationTitle ? replacement : full;
      });
    });
  }

  /**
   * Replaces every remaining `waiting_for_user_answer` placeholder in the note with the same
   * value. Used when the user skips the preference prompt entirely (e.g. types a new message in
   * chat instead of answering via the buttons), regardless of how many questions are pending.
   */
  public async replaceWaitingForUserAnswer(
    this: UserPreferenceSerializationHost,
    conversationTitle: string,
    outputValue: string
  ): Promise<boolean> {
    const file = this.getConversationFileByName(conversationTitle);
    let replaced = false;

    await this.plugin.app.vault.process(file, content => {
      if (!content.includes(USER_PREFERENCE_WAITING_PLACEHOLDER)) {
        return content;
      }
      replaced = true;
      return content
        .split(USER_PREFERENCE_WAITING_PLACEHOLDER)
        .join(escapeForJsonStringContent(outputValue));
    });

    return replaced;
  }

  /**
   * Replaces the `waiting_for_user_answer` placeholders one at a time, in order, with each
   * provided answer. Used when the user answers every question via the preference buttons UI.
   */
  public async replaceWaitingForUserAnswers(
    this: UserPreferenceSerializationHost,
    conversationTitle: string,
    outputValues: string[]
  ): Promise<boolean> {
    const file = this.getConversationFileByName(conversationTitle);
    let replaced = false;

    await this.plugin.app.vault.process(file, content => {
      let result = content;
      for (const value of outputValues) {
        if (!result.includes(USER_PREFERENCE_WAITING_PLACEHOLDER)) {
          break;
        }
        replaced = true;
        result = result.replace(
          USER_PREFERENCE_WAITING_PLACEHOLDER,
          escapeForJsonStringContent(value)
        );
      }
      return result;
    });

    return replaced;
  }

  public async findUserMessageBeforePreference(
    this: Pick<ConversationRenderer, 'extractAllConversationMessages'>,
    conversationTitle: string,
    preferenceMessageId: string
  ): Promise<ConversationMessage | null> {
    const { messages } = await this.extractAllConversationMessages(conversationTitle);
    const preferenceIndex = messages.findIndex(message => message.id === preferenceMessageId);
    if (preferenceIndex <= 0) {
      return null;
    }
    for (let i = preferenceIndex - 1; i >= 0; i--) {
      if (messages[i].role === 'user') {
        return messages[i];
      }
    }
    return null;
  }
}
