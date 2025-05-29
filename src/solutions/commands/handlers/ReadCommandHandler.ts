import {
	CommandHandler,
	CommandHandlerParams,
	CommandResult,
	CommandResultStatus,
} from '../CommandHandler';
import { getTranslation } from 'src/i18n';
import StewardPlugin from 'src/main';
import { ArtifactType } from 'src/services/ConversationArtifactManager';
import { extractContentReading } from 'src/lib/modelfusion/contentReadingExtraction';

export class ReadCommandHandler extends CommandHandler {
	constructor(public readonly plugin: StewardPlugin) {
		super();
	}

	/**
	 * Render the loading indicator for the read command
	 */
	public async renderIndicator(title: string, lang?: string): Promise<void> {
		const t = getTranslation(lang);
		await this.renderer.addGeneratingIndicator(title, t('conversation.readingContent'));
	}

	/**
	 * Handle a read command
	 */
	public async handle(params: CommandHandlerParams): Promise<CommandResult> {
		const { title, command, nextCommand, lang } = params;
		const t = getTranslation(lang);

		try {
			// Extract the reading instructions using LLM
			const extraction = await extractContentReading(command.content, this.settings.llm);

			// Read the content from the editor
			const readingResult = await this.plugin.contentReadingService.readContent(extraction);

			if (!readingResult) {
				await this.renderer.updateConversationNote({
					path: title,
					newContent: `*${t('read.unableToReadContent') || 'Unable to read content from the editor. Please make sure you have an open note.'}*`,
					role: 'Steward',
					command: 'read',
				});

				return {
					status: CommandResultStatus.ERROR,
					error: new Error('Unable to read content from the editor'),
				};
			}

			const stewardReadMetadata = await this.renderer.updateConversationNote({
				path: title,
				newContent: extraction.explanation,
				role: 'Steward',
				command: 'read',
			});

			if (extraction.confidence <= 0.7) {
				return {
					status: CommandResultStatus.ERROR,
					error: new Error('Low confidence in reading extraction'),
				};
			}

			if (readingResult.blocks.length === 0 || readingResult.elementType === 'unknown') {
				await this.renderer.updateConversationNote({
					path: title,
					newContent: `*${t('read.noContentFound')}*`,
				});

				return {
					status: CommandResultStatus.ERROR,
					error: new Error('No content found to read'),
				};
			}

			// Show the user the number of blocks found
			await this.renderer.updateConversationNote({
				path: title,
				newContent: extraction.foundPlaceholder.replace(
					'{{number}}',
					readingResult.blocks.length.toString()
				),
			});

			// If there is no next command, show the read results
			if (!nextCommand) {
				for (const block of readingResult.blocks) {
					await this.renderer.updateConversationNote({
						path: title,
						newContent: this.renderer.formatCallout(block.content, 'search-result'),
					});
				}
			}

			// Store the read content in the artifact manager
			if (stewardReadMetadata) {
				this.artifactManager.storeArtifact(title, stewardReadMetadata, {
					type: ArtifactType.READ_CONTENT,
					readingResult,
				});
			}

			return {
				status: CommandResultStatus.SUCCESS,
			};
		} catch (error) {
			await this.renderer.updateConversationNote({
				path: title,
				newContent: `*Error reading content: ${error.message}*`,
				role: 'Steward',
			});

			return {
				status: CommandResultStatus.ERROR,
				error,
			};
		}
	}
}
