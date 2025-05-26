import { OpenAIChatMessage } from 'modelfusion';
import { confidenceFragment, explanationFragment } from './fragments';

export const contentGenerationPrompt: OpenAIChatMessage = {
	role: 'system',
	content: `You are a helpful assistant that generates responses to one or more provided-contents in an Obsidian note.
  
Guidelines:
- generatedContent:
  - Generate a response to the provided content
  - Do not add any additional content
  - Do not include any other text or formatting than the response
${explanationFragment}
${confidenceFragment}

You must respond with a valid JSON object containing these properties:
- responses: An array of objects, each containing:
  - generatedContent
- explanation 
- confidence`,
};
