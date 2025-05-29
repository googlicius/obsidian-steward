import {
	CommandHandler,
	CommandHandlerParams,
	CommandResult,
	CommandResultStatus,
} from '../CommandHandler';
import { getTranslation } from 'src/i18n';
import StewardPlugin from 'src/main';
import { CommandIntent } from 'src/lib/modelfusion/intentExtraction';
import { ArtifactType } from 'src/services/ConversationArtifactManager';
import { extractContentGeneration } from 'src/lib/modelfusion/contentGenerationExtraction';
import { extractContentUpdate } from 'src/lib/modelfusion/contentUpdateExtraction';
import { extractNoteGeneration } from 'src/lib/modelfusion/noteGenerationExtraction';
import { TFile } from 'obsidian';
import { streamText } from 'modelfusion';
import { createLLMGenerator } from 'src/lib/modelfusion/llmConfig';
import { userLanguagePromptText } from 'src/lib/modelfusion/prompts/languagePrompt';

export class GenerateCommandHandler extends CommandHandler {
	constructor(public readonly plugin: StewardPlugin) {
		super();
	}

	/**
	 * Render the loading indicator for the generate command
	 */
	public async renderIndicator(title: string, lang?: string): Promise<void> {
		const t = getTranslation(lang);
		await this.renderer.addGeneratingIndicator(title, t('conversation.generating'));
	}

	/**
	 * Handle a generate command
	 */
	public async handle(params: CommandHandlerParams): Promise<CommandResult> {
		const { title, command, prevCommand, nextCommand, lang } = params;

		try {
			if (prevCommand && prevCommand.commandType === 'read') {
				// Generate content from a read artifact
				await this.generateFromReadArtifact(title, command.content, nextCommand, lang);
			} else {
				// Default generation (including after create)
				await this.generateFromCreateOrDefault(title, command.content, lang);
			}

			return {
				status: CommandResultStatus.SUCCESS,
			};
		} catch (error) {
			await this.renderer.updateConversationNote({
				path: title,
				newContent: `*Error generating content: ${error.message}*`,
				role: 'Steward',
			});

			return {
				status: CommandResultStatus.ERROR,
				error,
			};
		}
	}

	/**
	 * Generate content based on previously read content
	 * @param title The conversation title
	 * @param commandContent The command content
	 * @param nextCommand The next command (optional)
	 * @param lang Optional language code for the response
	 */
	private async generateFromReadArtifact(
		title: string,
		commandContent: string,
		nextCommand?: CommandIntent,
		lang?: string
	): Promise<void> {
		const readArtifact = this.artifactManager.getMostRecentArtifactByType(
			title,
			ArtifactType.READ_CONTENT
		);

		if (!readArtifact) {
			await this.renderer.updateConversationNote({
				path: title,
				newContent: `*No read content found*`,
			});
			return;
		}

		const contentsStr = JSON.stringify(
			readArtifact.readingResult.blocks.map(block => block.content)
		);

		const extraction =
			nextCommand && nextCommand.commandType === 'update_from_artifact'
				? await extractContentUpdate(`${contentsStr}\n\n${commandContent}`, this.settings.llm)
				: await extractContentGeneration(`${contentsStr}\n\n${commandContent}`, this.settings.llm);

		if (extraction.confidence <= 0.7) {
			return;
		}

		const messageId = await this.renderer.updateConversationNote({
			path: title,
			newContent: extraction.explanation,
		});

		if ('updates' in extraction) {
			if (extraction.updates.length === 0) {
				return;
			}

			// Store the content update extraction as an artifact
			if (messageId) {
				this.artifactManager.storeArtifact(title, messageId, {
					type: ArtifactType.CONTENT_UPDATE,
					updateExtraction: extraction,
					// Current path is active editing
					path: this.app.workspace.getActiveFile()?.path || '',
				});
			}

			for (const update of extraction.updates) {
				await this.renderer.updateConversationNote({
					path: title,
					newContent: this.renderer.formatCallout(update.updatedContent),
				});
			}
		} else {
			if (extraction.responses.length === 0) {
				return;
			}

			for (const response of extraction.responses) {
				await this.renderer.updateConversationNote({
					path: title,
					newContent: this.renderer.formatCallout(response),
				});
			}
		}
	}

	/**
	 * Generate content for a note or conversation
	 * @param title The conversation title
	 * @param commandContent The command content
	 * @param lang Optional language code for the response
	 */
	private async generateFromCreateOrDefault(
		title: string,
		commandContent: string,
		lang?: string
	): Promise<void> {
		const t = getTranslation(lang);

		// Check if there's a recently created note artifact
		let recentlyCreatedNote = '';
		const createdNotesArtifact = this.artifactManager.getMostRecentArtifactByType(
			title,
			ArtifactType.CREATED_NOTES
		);

		if (createdNotesArtifact && createdNotesArtifact.type === ArtifactType.CREATED_NOTES) {
			// Use the first note path if available
			recentlyCreatedNote = createdNotesArtifact.paths[0] || '';
		}

		// Extract the content generation details using the LLM
		const extraction = await extractNoteGeneration(
			commandContent,
			this.settings.llm,
			recentlyCreatedNote
		);

		// For low confidence extractions, just show the explanation
		if (extraction.confidence <= 0.7) {
			await this.renderer.updateConversationNote({
				path: title,
				newContent: extraction.explanation,
				role: 'Steward',
			});
			return;
		}

		// Prepare for content generation
		const stream = await streamText({
			model: createLLMGenerator({ ...this.settings.llm, responseFormat: 'text' }),
			prompt: [
				{
					role: 'system',
					content: `You are a helpful assistant that generates content for Obsidian notes. Generate detailed, well-structured content. Format the content in Markdown.`,
				},
				{
					role: 'system',
					content: `The content should not include the big heading on the top.`,
				},
				extraction.style
					? {
							role: 'system',
							content: `Style preference: ${extraction.style}`,
						}
					: null,
				userLanguagePromptText,
				{
					role: 'user',
					content: extraction.instructions,
				},
			].filter(Boolean),
		});

		if (!extraction.noteName) {
			// If no note name is provided, stream content to current conversation
			await this.renderer.streamConversationNote({
				path: title,
				stream,
				command: 'generate',
			});
			return;
		}

		// Check if the note exists
		const notePath = extraction.noteName.endsWith('.md')
			? extraction.noteName
			: `${extraction.noteName}.md`;

		const file = (this.app.vault.getAbstractFileByPath(notePath) as TFile) || null;

		if (!file) {
			// If file doesn't exist, inform the user
			await this.renderer.updateConversationNote({
				path: title,
				newContent: t('generate.fileNotFound', { noteName: notePath }),
				role: 'Steward',
				command: 'generate',
			});
			return;
		}

		const mainLeaf = await this.plugin.getMainLeaf();

		// Open the file in the main leaf
		if (mainLeaf && file) {
			mainLeaf.openFile(file);
			await this.app.workspace.revealLeaf(mainLeaf);
		}

		// Stream the content to the note
		let accumulatedContent = '';
		for await (const chunk of stream) {
			accumulatedContent += chunk;
			await this.app.vault.modify(file, accumulatedContent);
		}

		// Update the conversation with the results
		await this.renderer.updateConversationNote({
			path: title,
			newContent: `*${t('generate.success', { noteName: extraction.noteName })}*`,
		});
	}
}
