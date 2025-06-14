import { generateText } from 'modelfusion';
import { destinationFolderPrompt } from '../prompts/destinationFolderPrompt';
import { userLanguagePrompt } from '../prompts/languagePrompt';
import { StewardPluginSettings } from 'src/types/interfaces';
import { createLLMGenerator } from '../llmConfig';
import { validateConfidence, validateLanguage } from '../validators';
import { AbortService } from 'src/services/AbortService';

const abortService = AbortService.getInstance();

/**
 * Represents the extracted move details
 */
export interface MoveExtraction {
  destinationFolder: string;
  explanation: string;
  context: string;
  confidence: number;
  lang?: string;
}

/**
 * Extract move details from a user query
 * @param userInput Natural language request to move files
 * @returns Extracted move details
 */
export async function extractMoveQuery(
  userInput: string,
  llmConfig: StewardPluginSettings['llm']
): Promise<MoveExtraction> {
  try {
    const response = await generateText({
      model: createLLMGenerator(llmConfig),
      run: { abortSignal: abortService.createAbortController('move') },
      prompt: [
        userLanguagePrompt,
        destinationFolderPrompt,
        {
          role: 'user',
          content: userInput,
        },
      ],
    });

    // Parse and validate the JSON response
    const parsed = JSON.parse(response);
    return validateMoveFromSearchResultExtraction(parsed);
  } catch (error) {
    console.error('Error extracting move from search result parameters:', error);
    throw error;
  }
}

/**
 * Validate that the move from search results extraction contains all required fields
 */
function validateMoveFromSearchResultExtraction(data: any): MoveExtraction {
  if (!data || typeof data !== 'object') {
    throw new Error('Invalid response format');
  }

  if (typeof data.destinationFolder !== 'string' || !data.destinationFolder.trim()) {
    throw new Error('Destination folder must be a non-empty string');
  }

  if (typeof data.context !== 'string' || !data.context.trim()) {
    throw new Error('Context must be a non-empty string');
  }

  if (typeof data.explanation !== 'string' || !data.explanation.trim()) {
    throw new Error('Explanation must be a non-empty string');
  }

  const confidence = validateConfidence(data.confidence);
  const lang = validateLanguage(data.lang);

  return {
    destinationFolder: data.destinationFolder.trim(),
    explanation: data.explanation.trim(),
    context: data.context.trim(),
    confidence,
    lang,
  };
}
