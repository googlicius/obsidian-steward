import { CommandProcessor } from '../solutions/commands';
import {
  SearchCommandHandler,
  MoreCommandHandler,
  UpdateCommandHandler,
  ReadCommandHandler,
  GenerateCommandHandler,
  CloseCommandHandler,
  ConfirmCommandHandler,
  StopCommandHandler,
  AudioCommandHandler,
  ImageCommandHandler,
  UserDefinedCommandHandler,
  ThankYouCommandHandler,
  HelpCommandHandler,
  BuildSearchIndexCommandHandler,
  SummaryCommandHandler,
  ContextAugmentationHandler,
  TestCommandHandler,
} from '../solutions/commands/handlers';
import VaultAgent from '../solutions/commands/agents/VaultAgent/VaultAgent';

import type StewardPlugin from '../main';
import { getTextContentWithoutImages } from 'src/lib/modelfusion/utils/messageUtils';
import { ToolName } from 'src/solutions/commands/ToolRegistry';
import { PlannerAgent } from 'src/solutions/commands/agents/PlannerAgent/PlannerAgent';

export class CommandProcessorService {
  public readonly commandProcessor: CommandProcessor;
  private userDefinedCommandHandler: UserDefinedCommandHandler;

  constructor(private readonly plugin: StewardPlugin) {
    this.commandProcessor = new CommandProcessor(this.plugin);

    this.setupHandlers();
  }

  /**
   * Get the command processor
   */
  public getCommandHandler(commandType: string) {
    return this.commandProcessor.getCommandHandler(commandType);
  }

  /**
   * Setup command handlers
   */
  private setupHandlers(): void {
    // Register the vault agent
    this.commandProcessor.registerAgent('vault', new VaultAgent(this.plugin));
    this.commandProcessor.registerAgent(
      'vault_delete',
      new VaultAgent(this.plugin, [ToolName.DELETE])
    );
    this.commandProcessor.registerAgent(
      'vault_create',
      new VaultAgent(this.plugin, [ToolName.CREATE])
    );
    this.commandProcessor.registerAgent('vault_copy', new VaultAgent(this.plugin, [ToolName.COPY]));
    this.commandProcessor.registerAgent('vault_move', new VaultAgent(this.plugin, [ToolName.MOVE]));

    // Register the planner agent
    const planner = new PlannerAgent(this.plugin);
    this.commandProcessor.registerAgent(' ', planner);

    // Register the close command handler
    const closeHandler = new CloseCommandHandler(this.plugin);
    this.commandProcessor.registerHandler('close', closeHandler);

    // Register the confirmation handler
    const confirmHandler = new ConfirmCommandHandler(this.plugin);
    this.commandProcessor.registerHandler('confirm', confirmHandler);
    this.commandProcessor.registerHandler('yes', confirmHandler);
    this.commandProcessor.registerHandler('no', confirmHandler);

    // Register the search handler
    const searchHandler = new SearchCommandHandler(this.plugin);
    this.commandProcessor.registerAgent('search', searchHandler);

    // Register the more handler for pagination
    const moreHandler = new MoreCommandHandler(this.plugin, searchHandler);
    this.commandProcessor.registerHandler('more', moreHandler);

    // Register the image command handler
    const imageHandler = new ImageCommandHandler(this.plugin);
    this.commandProcessor.registerHandler('image', imageHandler);

    // Register the audio command handler
    const audioHandler = new AudioCommandHandler(this.plugin);
    this.commandProcessor.registerHandler('audio', audioHandler);
    this.commandProcessor.registerHandler('speak', audioHandler);

    // Register the update command handler
    const updateHandler = new UpdateCommandHandler(this.plugin);
    this.commandProcessor.registerHandler('update_from_artifact', updateHandler);

    // Register the read command handler
    const readHandler = new ReadCommandHandler(this.plugin);
    this.commandProcessor.registerHandler('read', readHandler);

    // Register the generate command handler
    const generateHandler = new GenerateCommandHandler(this.plugin);
    this.commandProcessor.registerHandler('generate', generateHandler);

    // Register the stop command handler
    const stopHandler = new StopCommandHandler(this.plugin);
    this.commandProcessor.registerHandler('stop', stopHandler);
    this.commandProcessor.registerHandler('abort', stopHandler);

    // Register the thank you command handler
    const thankYouHandler = new ThankYouCommandHandler(this.plugin);
    this.commandProcessor.registerHandler('thank_you', thankYouHandler);
    this.commandProcessor.registerHandler('thanks', thankYouHandler);

    // Register the help command handler
    const helpHandler = new HelpCommandHandler(this.plugin);
    this.commandProcessor.registerHandler('help', helpHandler);

    // Register the build search index command handler
    const buildSearchIndexHandler = new BuildSearchIndexCommandHandler(this.plugin);
    this.commandProcessor.registerHandler('build_search_index', buildSearchIndexHandler);
    this.commandProcessor.registerHandler('index', buildSearchIndexHandler);
    this.commandProcessor.registerHandler('build-index', buildSearchIndexHandler);
    this.commandProcessor.registerHandler('search-index', buildSearchIndexHandler);

    // Register the summary command handler
    const summaryHandler = new SummaryCommandHandler(this.plugin);
    this.commandProcessor.registerHandler('summary', summaryHandler);

    // Register the context_augmentation handler
    const contextAugmentationHandler = new ContextAugmentationHandler(this.plugin);
    this.commandProcessor.registerHandler('context_augmentation', contextAugmentationHandler);

    // Register the user-defined command handler
    this.userDefinedCommandHandler = new UserDefinedCommandHandler(this.plugin);
    this.commandProcessor.registerUserDefinedCommandHandler(this.userDefinedCommandHandler);

    // Register the test command handler
    const testHandler = new TestCommandHandler(this.plugin);
    this.commandProcessor.registerHandler('test', testHandler);
  }

  /**
   * Validate if the intent content is required for a specific intent type
   */
  public validateIntentContent(intentType: string, intentContent: string): boolean {
    const handler = this.commandProcessor.getCommandHandler(intentType);
    if (!handler) return true;

    const isContentRequired =
      typeof handler.isContentRequired === 'function'
        ? handler.isContentRequired(intentType)
        : handler.isContentRequired;

    return isContentRequired ? getTextContentWithoutImages(intentContent) !== '' : true;
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
