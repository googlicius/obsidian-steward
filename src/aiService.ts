import { openai, generateText } from 'modelfusion';
import { mathTools } from './mathTools';

// Define the ToolSelection interface
export interface ToolSelection {
	toolName: string;
	firstNumber: number;
	secondNumber: number;
}

/**
 * Validate that the tool selection contains all required fields and proper types
 */
function validateToolSelection(data: any): ToolSelection {
	if (!data || typeof data !== 'object') {
		throw new Error('Invalid response format');
	}

	if (!data.toolName || !mathTools.map(t => t.name).includes(data.toolName)) {
		throw new Error(`Invalid tool name. Must be one of: ${mathTools.map(t => t.name).join(', ')}`);
	}

	if (typeof data.firstNumber !== 'number' || isNaN(data.firstNumber)) {
		throw new Error('First number must be a valid number');
	}

	if (typeof data.secondNumber !== 'number' || isNaN(data.secondNumber)) {
		throw new Error('Second number must be a valid number');
	}

	return {
		toolName: data.toolName,
		firstNumber: data.firstNumber,
		secondNumber: data.secondNumber,
	};
}

/**
 * Select a math tool based on user input
 */
export async function selectMathTool(userInput: string): Promise<ToolSelection> {
	try {
		// Create the system message describing the task
		const systemPrompt = `You are a helpful assistant that selects the appropriate mathematical operation based on user input.
      Available tools are: ${mathTools.map(t => `${t.name} (${t.description})`).join(', ')}.
      Analyze the user's request carefully to determine which operation they want,
      and extract the numbers they want to operate on.
      
      You must respond with a valid JSON object containing these properties:
      - toolName: one of [${mathTools.map(t => `"${t.name}"`).join(', ')}]
      - firstNumber: the first number for the operation
      - secondNumber: the second number for the operation`;

		// Use ModelFusion to generate the response
		const response = await generateText({
			model: openai.ChatTextGenerator({
				model: 'gpt-3.5-turbo',
				temperature: 0.1,
				responseFormat: { type: 'json_object' },
			}),
			prompt: [
				{ role: 'system', content: systemPrompt },
				{ role: 'user', content: userInput },
			],
		});

		// Parse and validate the JSON response
		const parsed = JSON.parse(response);
		return validateToolSelection(parsed);
	} catch (error) {
		console.error('Error selecting math tool:', error);
		throw error;
	}
}
