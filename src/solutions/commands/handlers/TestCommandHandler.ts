import { CommandHandler, CommandHandlerParams, CommandResult } from '../CommandHandler';
import type StewardPlugin from 'src/main';
import { z } from 'zod';
import { generateText, tool } from 'ai';
import { userLanguagePrompt } from 'src/lib/modelfusion/prompts/languagePrompt';
import { explanationFragment, confidenceFragment } from 'src/lib/modelfusion/prompts/fragments';
import { Intent, IntentResultStatus } from '../types';

// Number Guessing Game Schema
const numberGuessSchema = z.object({
  guess: z.number().int().min(1).max(100).describe('Your guess for the hidden number (1-100)'),
  confidence: z.number().min(0).max(1).describe(confidenceFragment),
  explanation: z.string().describe(explanationFragment),
  lang: z
    .string()
    .optional()
    .describe(userLanguagePrompt.content as string),
});

export type NumberGuessArgs = z.infer<typeof numberGuessSchema>;

export class TestCommandHandler extends CommandHandler {
  // The target number to guess (1-100)
  private readonly targetNumber: number = 42;

  constructor(public readonly plugin: StewardPlugin) {
    super();
  }

  private async extractNumberGuess(command: Intent, conversationTitle: string) {
    const llmConfig = await this.plugin.llmService.getLLMConfig({
      overrideModel: command.model,
    });

    let guessCount = 0;
    let stepCount = 0;

    return generateText({
      ...llmConfig,
      abortSignal: this.plugin.abortService.createAbortController('number-guess'),
      system: `You are playing a number guessing game. Try to guess a hidden number between 1 and 100.
The system will tell you if your guess is too high, too low, or correct.
Use your reasoning skills to make intelligent guesses based on the feedback.`,
      prompt: command.query,
      maxSteps: 10,
      onStepFinish: async step => {
        // Increment step counter
        stepCount++;
        const currentStep = stepCount;

        for (const toolCall of step.toolCalls) {
          if (toolCall.toolName === 'guessNumber') {
            guessCount++;
            const guess = toolCall.args.guess;

            // Get the result from the tool execution
            let result = '';
            let isCorrect = false;

            if (guess === this.targetNumber) {
              result = "Correct! You've guessed the number!";
              isCorrect = true;
            } else if (guess < this.targetNumber) {
              result = 'Too low. Try a higher number.';
            } else {
              result = 'Too high. Try a lower number.';
            }

            // Update the conversation with this guess
            await this.renderer.updateConversationNote({
              path: conversationTitle,
              newContent: `**Step ${currentStep} | Guess #${guessCount}:** ${guess}\n**Result:** ${result}`,
            });

            // If correct, show celebration message
            if (isCorrect) {
              await this.renderer.updateConversationNote({
                path: conversationTitle,
                newContent: `🎉 Success! The AI found the number ${this.targetNumber} in ${guessCount} guesses and ${stepCount} steps!`,
              });
            }
          }
        }
      },
      tools: {
        guessNumber: tool({
          parameters: numberGuessSchema,
          execute: async args => {
            const guess = args.guess;
            if (guess === this.targetNumber) {
              return {
                result: "Correct! You've guessed the number!",
                correct: true,
              };
            } else if (guess < this.targetNumber) {
              return {
                result: 'Too low. Try a higher number.',
                correct: false,
              };
            } else {
              return {
                result: 'Too high. Try a lower number.',
                correct: false,
              };
            }
          },
        }),
      },
    });
  }

  /**
   * Render the loading indicator for the test command
   */
  public async renderIndicator(title: string, lang?: string): Promise<void> {
    await this.renderer.addGeneratingIndicator(title, 'Playing number guessing game...');
  }

  /**
   * Handle a test command
   */
  public async handle(params: CommandHandlerParams): Promise<CommandResult> {
    const { title, intent } = params;

    try {
      // Extract the number guessing game instructions using LLM
      const extraction = await this.extractNumberGuess(intent, title);
      const lang = params.lang || 'en';

      // Show introduction
      await this.renderer.updateConversationNote({
        path: title,
        newContent: `# Number Guessing Game\n\nI'm thinking of a number between 1 and 100. Let's see if the AI can guess it!`,
        role: 'Steward',
        command: 'test',
        includeHistory: false,
        lang,
      });

      // The guesses are processed in the onStepFinish callback
      // Display the AI's final thoughts if any
      if (extraction.text) {
        await this.renderer.updateConversationNote({
          path: title,
          newContent: extraction.text,
        });
      }

      // If no guesses were made, show a message
      // if (this.guessCount === 0) {
      //   await this.renderer.updateConversationNote({
      //     path: title,
      //     newContent:
      //       '*No guesses were made. Try asking a more specific question about the number guessing game.*',
      //   });
      // }

      return {
        status: IntentResultStatus.SUCCESS,
      };
    } catch (error) {
      await this.renderer.updateConversationNote({
        path: title,
        newContent: `*Error in number guessing game: ${error.message}*`,
      });

      return {
        status: IntentResultStatus.ERROR,
        error,
      };
    }
  }
}
