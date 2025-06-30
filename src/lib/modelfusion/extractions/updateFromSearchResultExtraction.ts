import { generateObject } from 'ai';
import { updateFromSearchResultPrompt } from '../prompts/updateFromSearchResultPrompt';
import { userLanguagePromptText } from '../prompts/languagePrompt';
import { AbortService } from 'src/services/AbortService';
import { LLMService } from 'src/services/LLMService';
import { z } from 'zod';

const abortService = AbortService.getInstance();

export interface ReplaceInstruction {
  type: 'replace';
  old: string;
  new: string;
}

export interface AddInstruction {
  type: 'add';
  content: string;
  position: 'beginning' | 'end' | number;
}

export type UpdateInstruction = ReplaceInstruction | AddInstruction;

export interface UpdateFromSearchResultExtraction {
  updateInstructions: UpdateInstruction[];
  explanation: string;
  confidence: number;
  lang?: string;
}

// Define the Zod schemas for update instructions
const replaceInstructionSchema = z.object({
  type: z.literal('replace'),
  old: z.string(),
  new: z.string(),
});

const addInstructionSchema = z.object({
  type: z.literal('add'),
  content: z.string(),
  position: z.union([z.literal('beginning'), z.literal('end'), z.number()]),
});

const updateInstructionSchema = z.discriminatedUnion('type', [
  replaceInstructionSchema,
  addInstructionSchema,
]);

// Define the Zod schema for the entire extraction
const updateFromSearchResultExtractionSchema = z.object({
  updateInstructions: z.array(updateInstructionSchema),
  explanation: z.string().min(1, 'Explanation must be a non-empty string'),
  confidence: z.number().min(0).max(1),
  lang: z.string().optional(),
});

/**
 * Extracts update instructions from a search result update command
 */
export async function extractUpdateFromSearchResult({
  userInput,
  systemPrompts = [],
  lang,
  model,
}: {
  userInput: string;
  systemPrompts?: string[];
  lang?: string;
  model?: string; // Optional model to override default
}): Promise<UpdateFromSearchResultExtraction> {
  try {
    const llmConfig = await LLMService.getInstance().getLLMConfig(model);

    const { object } = await generateObject({
      ...llmConfig,
      abortSignal: abortService.createAbortController('update-from-artifact'),
      system: `${updateFromSearchResultPrompt.content}\n\n${userLanguagePromptText}`,
      messages: [
        ...systemPrompts.map(prompt => ({ role: 'system' as const, content: prompt })),
        { role: 'user', content: userInput },
      ],
      schema: updateFromSearchResultExtractionSchema,
    });

    return object;
  } catch (error) {
    console.error('Error extracting update from search result:', error);
    throw error;
  }
}
