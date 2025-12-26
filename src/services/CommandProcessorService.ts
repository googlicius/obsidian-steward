import { CommandProcessor } from '../solutions/commands';
import { SuperAgent } from '../solutions/commands/agents';
import type StewardPlugin from '../main';
import { ToolName } from 'src/solutions/commands/toolNames';

export class CommandProcessorService {
  public readonly commandProcessor: CommandProcessor;

  constructor(private readonly plugin: StewardPlugin) {
    this.commandProcessor = new CommandProcessor(this.plugin);

    this.setupHandlers();
  }

  /**
   * Setup command handlers
   */
  private setupHandlers(): void {
    // Register the super agent
    const superAgent = new SuperAgent(this.plugin);
    this.commandProcessor.registerAgent(' ', superAgent);

    // Register the search handler
    const superAgentWithSearchTool = new SuperAgent(this.plugin, [ToolName.SEARCH]);
    this.commandProcessor.registerAgent('search', superAgentWithSearchTool);

    // Register the speech command handler
    const speechHandler = new SuperAgent(this.plugin, [ToolName.SPEECH]);
    this.commandProcessor.registerAgent('speech', speechHandler);

    // Register the image command handler
    const imageHandler = new SuperAgent(this.plugin, [ToolName.IMAGE]);
    this.commandProcessor.registerAgent('image', imageHandler);
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

    // For built-in commands, content is always allowed (validation happens in the agent)
    return true;
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
