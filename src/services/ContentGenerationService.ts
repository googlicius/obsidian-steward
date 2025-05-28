import { TFile } from 'obsidian';
import { streamText } from 'modelfusion';
import { createLLMGenerator } from '../lib/modelfusion/llmConfig';
import { userLanguagePromptText } from '../lib/modelfusion/prompts/languagePrompt';
import { extractNoteGeneration } from '../lib/modelfusion/noteGenerationExtraction';
import { extractContentUpdate } from '../lib/modelfusion/contentUpdateExtraction';
import { getTranslation } from '../i18n';
import { ArtifactType } from './ConversationArtifactManager';
import StewardPlugin from '../main';
import { CommandIntent } from '../lib/modelfusion/intentExtraction';
import { extractContentGeneration } from '../lib/modelfusion/contentGenerationExtraction';
import { ConversationRenderer } from './ConversationRenderer';

/**
 * Service for generating content in Obsidian notes
 */
export class ContentGenerationService {
	private readonly plugin: StewardPlugin;

	get renderer(): ConversationRenderer {
		return this.plugin.conversationRenderer;
	}

	constructor(plugin: StewardPlugin) {
		this.plugin = plugin;
	}

	/**
	 * Generate content based on previously read content
	 * @param title The conversation title
	 * @param commandContent The command content
	 * @param nextCommand The next command
	 * @param lang Optional language code for the response
	 */
	async generateFromReadArtifact(
		title: string,
		commandContent: string,
		nextCommand: CommandIntent,
		lang?: string
	): Promise<void> {
		const t = getTranslation(lang);

		const readArtifact = this.plugin.artifactManager.getMostRecentArtifactByType(
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
				? await extractContentUpdate(
						`${contentsStr}\n\n${commandContent}`,
						this.plugin.settings.llm
					)
				: await extractContentGeneration(
						`${contentsStr}\n\n${commandContent}`,
						this.plugin.settings.llm
					);

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
				this.plugin.artifactManager.storeArtifact(title, messageId, {
					type: ArtifactType.CONTENT_UPDATE,
					updateExtraction: extraction,
					// Current path is active editing
					path: this.plugin.app.workspace.getActiveFile()?.path || '',
				});
			}

			for (const update of extraction.updates) {
				await this.renderer.updateConversationNote({
					path: title,
					newContent: this.renderer.formatCallout(update.updatedContent),
				});
			}

			// A confirmation if the user wants to apply the changes
			await this.renderer.updateConversationNote({
				path: title,
				newContent: t('generate.applyChangesConfirm'),
			});
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
	async generateFromCreateOrDefault(
		title: string,
		commandContent: string,
		lang?: string
	): Promise<void> {
		const t = getTranslation(lang);

		// Check if there's a recently created note artifact
		let recentlyCreatedNote = '';
		const createdNotesArtifact = this.plugin.artifactManager.getMostRecentArtifactByType(
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
			this.plugin.settings.llm,
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
			model: createLLMGenerator({ ...this.plugin.settings.llm, responseFormat: 'text' }),
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

		const file = (this.plugin.app.vault.getAbstractFileByPath(notePath) as TFile) || null;

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
			await this.plugin.app.workspace.revealLeaf(mainLeaf);
		}

		// Stream the content to the note
		let accumulatedContent = '';
		for await (const chunk of stream) {
			accumulatedContent += chunk;
			await this.plugin.app.vault.modify(file, accumulatedContent);
		}

		// Update the conversation with the results
		await this.renderer.updateConversationNote({
			path: title,
			newContent: `*${t('generate.success', { noteName: extraction.noteName })}*`,
		});
	}
}
