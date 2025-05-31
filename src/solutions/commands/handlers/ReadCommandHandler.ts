import {
	CommandHandler,
	CommandHandlerParams,
	CommandResult,
	CommandResultStatus,
} from '../CommandHandler';
import { getTranslation } from 'src/i18n';
import StewardPlugin from 'src/main';
import { ArtifactType } from 'src/services/ConversationArtifactManager';
import {
	ContentReadingExtraction,
	extractContentReading,
} from 'src/lib/modelfusion/contentReadingExtraction';
import { CommandProcessor } from '../CommandProcessor';

export class ReadCommandHandler extends CommandHandler {
	constructor(
		public readonly plugin: StewardPlugin,
		public readonly commandProcessor: CommandProcessor
	) {
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
	public async handle(
		params: CommandHandlerParams,
		options: { extraction?: ContentReadingExtraction; readEntireContent?: boolean } = {}
	): Promise<CommandResult> {
		const { title, command, nextCommand, lang } = params;
		const t = getTranslation(lang);

		try {
			// Extract the reading instructions using LLM
			const extraction =
				options.extraction || (await extractContentReading(command.content, this.settings.llm));

			if (extraction.readType === 'entire' && !options.readEntireContent) {
				await this.renderer.updateConversationNote({
					path: title,
					newContent: t('read.readEntireContentConfirmation'),
					role: 'Steward',
					command: 'read',
				});

				return {
					status: CommandResultStatus.NEEDS_CONFIRMATION,
					onConfirmation: async () => {
						await this.handle(params, { extraction, readEntireContent: true });
					},
				};
			}

			// Read the content from the editor
			const readingResult = await this.plugin.contentReadingService.readContent(extraction);

			if (!readingResult) {
				await this.renderer.updateConversationNote({
					path: title,
					newContent: `*${t('read.unableToReadContent')}*`,
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
					console.log('block', block);
					const endLine = this.plugin.editor.getLine(block.endLine);
					await this.renderer.updateConversationNote({
						path: title,
						newContent: this.renderer.formatCallout(block.content, 'search-result', {
							startLine: block.startLine,
							endLine: block.endLine,
							start: 0,
							end: endLine.length,
							path: this.plugin.app.workspace.getActiveFile()?.path,
						}),
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
