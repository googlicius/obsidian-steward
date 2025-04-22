import { OpenAIChatMessage } from 'modelfusion';

export const userLanguagePrompt: OpenAIChatMessage = {
	role: 'system',
	content: `
Respect user's language or the language they specified.
- Add a "lang" property to the response JSON object.
- The lang property should be a valid language code: en, vi, etc.
`,
};
