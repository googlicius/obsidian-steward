import { EditorView } from '@codemirror/view';
import { Notice } from 'obsidian';
import StewardPlugin from '../main';

// Supported command prefixes
export const COMMAND_PREFIXES = ['/move', '/search', '/calc', '/me'];

// Function to handle the Shift+Enter key combination
export function handleShiftEnter(view: EditorView): boolean {
	const { state } = view;
	const { doc, selection } = state;

	// Get current line
	const pos = selection.main.head;
	const line = doc.lineAt(pos);
	const lineText = line.text;

	// Check if line starts with a command prefix
	const commandMatch = COMMAND_PREFIXES.find(prefix => lineText.trim().startsWith(prefix));
	console.log('Command match:', commandMatch);

	if (commandMatch) {
		try {
			// Extract the command content (everything after the prefix)
			const commandContent = lineText.trim().substring(commandMatch.length).trim();
			const commandType = commandMatch.substring(1); // Remove the / from the command

			console.log('Command type:', commandType);
			console.log('Command content:', commandContent);

			// Check if this is a follow-up message to an existing conversation
			if (commandType === 'me') {
				// Look for a conversation link in the previous lines
				const conversationLink = findConversationLinkAbove(view);
				if (conversationLink) {
					// Handle the follow-up message
					handleFollowUpMessage(view, conversationLink, commandContent, line.from, line.to);
					return true;
				}
			}

			// Create a title now so we can safely refer to it later
			const title = `${commandType} command ${Math.random().toString(36).substring(2, 8)}`;

			// Create a promise to create the conversation note
			createConversationNote(title, commandType, commandContent)
				.then(() => {
					// After the note is created, insert the link on the next tick
					setTimeout(() => {
						insertConversationLink(view, line.from, line.to, title);
					}, 50);
				})
				.catch(error => {
					console.error('Error creating conversation:', error);
					new Notice(`Error creating conversation: ${error.message}`);
				});

			return true;
		} catch (error) {
			console.error('Error in handleShiftEnter:', error);
			new Notice(`Error processing command: ${error.message}`);
			return false;
		}
	}

	return false;
}

// Function to find a conversation link in the lines above the current cursor
function findConversationLinkAbove(view: EditorView): string | null {
	const { state } = view;
	const { doc, selection } = state;
	const currentLine = doc.lineAt(selection.main.head);

	// Check up to 10 lines above the current one
	let lineNumber = currentLine.number - 1;
	const minLineNumber = Math.max(1, currentLine.number - 10);

	while (lineNumber >= minLineNumber) {
		const line = doc.line(lineNumber);
		const text = line.text;

		// Look for inline link format: ![[conversation title]]
		const linkMatch = text.match(/!\[\[(.*?)\]\]/);
		if (linkMatch && linkMatch[1]) {
			return linkMatch[1]; // Return the conversation title
		}

		lineNumber--;
	}

	return null;
}

// Function to handle a follow-up message to an existing conversation
async function handleFollowUpMessage(
	view: EditorView,
	conversationTitle: string,
	content: string,
	fromPos: number,
	toPos: number
): Promise<void> {
	// Access the plugin through the global app object
	const app = (window as any).app;
	const plugin = app?.plugins?.plugins['obsidian-steward'] as StewardPlugin;

	if (!plugin) {
		new Notice('Error: Could not find the Steward plugin');
		return;
	}

	try {
		const folderPath = plugin.settings.conversationFolder;
		const notePath = `${folderPath}/${conversationTitle}.md`;

		// Check if the conversation note exists
		const file = plugin.app.vault.getAbstractFileByPath(notePath);
		if (!file) {
			new Notice(`Error: Conversation note not found: ${notePath}`);
			return;
		}

		// Read the current content of the note
		const fileContent = await plugin.app.vault.read(file as any);

		// Append the follow-up message to the note
		const updatedContent =
			fileContent + `\n/me ${content}\n\nSteward: Working on follow-up request...\n`;

		// Update the note with the new content
		await plugin.app.vault.modify(file as any, updatedContent);

		// Replace the line with the command with an empty line
		view.dispatch({
			changes: {
				from: fromPos,
				to: toPos,
				insert: '',
			},
		});

		new Notice(`Added follow-up message to ${conversationTitle}`);
	} catch (error) {
		new Notice(`Error adding follow-up message: ${error}`);
		console.error('Error adding follow-up message:', error);
	}
}

// Helper function to create a conversation note
async function createConversationNote(
	title: string,
	commandType: string,
	content: string
): Promise<void> {
	// Access the plugin through the global app object
	const app = (window as any).app;
	const plugin = app?.plugins?.plugins['obsidian-steward'] as StewardPlugin;

	if (!plugin) {
		throw new Error('Could not find the Steward plugin');
	}

	try {
		// Get the configured folder for conversations
		const folderPath = plugin.settings.conversationFolder;
		const notePath = `${folderPath}/${title}.md`;

		// Check if conversations folder exists, create if not
		const folderExists = plugin.app.vault.getAbstractFileByPath(folderPath);
		if (!folderExists) {
			await plugin.app.vault.createFolder(folderPath);
		}

		// Build initial content based on command type
		let initialContent: string;

		switch (commandType) {
			case 'move':
				initialContent = [
					`#gtp-4`,
					'',
					`/${commandType} ${content}`,
					'',
					`Steward: Ok I will help you move all files with tags ${content} to the`,
					`English/Vocabulary/Nouns folder.`,
					'',
					`Steward: Here is the list of notes contains tag ${content} that I found:`,
					'',
					`- Flashcard 1`,
					`- Flashcard 3`,
					'',
					`Do you want me to process moving them all now?`,
					'',
				].join('\n');
				break;

			case 'search':
				initialContent = [
					`#gtp-4`,
					'',
					`/${commandType} ${content}`,
					'',
					`Steward: I'll search your vault for "${content}". Here's what I found:`,
					'',
					`• File 1: 3 matches`,
					`• File 2: 1 match`,
					'',
					`Would you like me to show you the context of these matches?`,
					'',
				].join('\n');

				break;

			case 'calc':
				initialContent = [
					`#gtp-4`,
					'',
					`/${commandType} ${content}`,
					'',
					`Steward: Let me calculate "${content}" for you.`,
					'',
					`Result: 42`,
					'',
					`Would you like me to explain how I arrived at this result?`,
					'',
				].join('\n');
				break;

			default:
				initialContent = [
					`#gtp-4`,
					'',
					`/${commandType} ${content}`,
					'',
					`Steward: Working on it...`,
					'',
				].join('\n');
				break;
		}

		// Create the conversation note
		await plugin.app.vault.create(notePath, initialContent);

		new Notice(`Created conversation: ${title}`);
	} catch (error) {
		console.error('Error creating conversation note:', error);
		throw error;
	}
}

// Helper function to insert a conversation link
function insertConversationLink(view: EditorView, from: number, to: number, title: string) {
	try {
		const linkText = `![[${title}]]\n\n`;

		view.dispatch({
			changes: {
				from,
				to,
				insert: linkText,
			},
		});

		console.log('Inserted conversation link:', title);
	} catch (error) {
		console.error('Error inserting conversation link:', error);
		new Notice(`Error inserting link: ${error.message}`);
	}
}
