import { OpenAIChatMessage } from 'modelfusion';

export const userLanguagePrompt: OpenAIChatMessage = {
  role: 'system',
  content: `
Respect user's language or the language they specified.
- The lang property should be a valid language code: en, vi, etc.
`,
};

export const userLanguagePromptText: OpenAIChatMessage = {
  role: 'system',
  content: `Respect user's language or the language they specified.`,
};
