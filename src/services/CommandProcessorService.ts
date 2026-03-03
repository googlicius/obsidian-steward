import type { IntentProcessor } from '../solutions/commands/IntentProcessor';
import { AgentRunner } from '../solutions/commands/agents/AgentRunner';
import { DEFAULT_AGENT_CONFIGS } from '../solutions/commands/agents/defaultAgents';
import type StewardPlugin from '../main';
import { COMMAND_CONTENT_REQUIRED } from '../constants';

export class CommandProcessorService {
  public readonly commandProcessor: IntentProcessor;

  constructor(private readonly plugin: StewardPlugin) {
    this.commandProcessor = new AgentRunner(this.plugin, DEFAULT_AGENT_CONFIGS);
  }

  /**
   * Validate if the intent content is required for a specific intent type
   */
  public validateIntentContent(intentType: string, intentContent: string): boolean {
    // Check if it's a user-defined command
    const isUserDefinedCommand =
      this.plugin.userDefinedCommandService.userDefinedCommands.has(intentType);
    if (isUserDefinedCommand) {
      const userDefinedCommand =
        this.plugin.userDefinedCommandService.userDefinedCommands.get(intentType);
      const isContentRequired = !!(
        userDefinedCommand && userDefinedCommand.normalized.query_required
      );
      return isContentRequired
        ? this.plugin.userMessageService.getTextContentWithoutImages(intentContent) !== ''
        : true;
    }

    // Check if it's a built-in command
    const isContentRequired = COMMAND_CONTENT_REQUIRED[intentType];
    // If command is explicitly configured, use that value; otherwise default to true for safety
    if (isContentRequired !== undefined) {
      return isContentRequired
        ? this.plugin.userMessageService.getTextContentWithoutImages(intentContent) !== ''
        : true;
    }

    // Default to requiring content for unknown built-in commands (safety first)
    return this.plugin.userMessageService.getTextContentWithoutImages(intentContent) !== '';
  }

  /**
   * Check if a command is a built-in command
   */
  public isBuiltInCommand(commandType: string): boolean {
    return this.commandProcessor.hasBuiltInHandler(commandType);
  }

  public isProcessing(title: string): boolean {
    return this.commandProcessor.isProcessing(title);
  }
}
