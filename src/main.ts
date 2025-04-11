import { Editor, MarkdownView, Notice, Plugin } from 'obsidian';
import StewardSettingTab from './settings';
import { MathAssistantModal } from './mathAssistantModal';
import { COMMAND_PREFIXES, handleShiftEnter } from './cm-extensions/ConversationExtension';
import { EditorView } from '@codemirror/view';
import { createCommandHighlightExtension } from './cm-extensions/CommandHighlightExtension';

// Remember to rename these classes and interfaces!

interface StewardPluginSettings {
	mySetting: string;
	openaiApiKey: string;
	conversationFolder: string;
}

const DEFAULT_SETTINGS: StewardPluginSettings = {
	mySetting: 'default',
	openaiApiKey: '',
	conversationFolder: 'conversations',
};

export default class StewardPlugin extends Plugin {
	settings: StewardPluginSettings;

	async onload() {
		await this.loadSettings();

		// Set OPENAI_API_KEY for ModelFusion
		if (this.settings.openaiApiKey) {
			process.env.OPENAI_API_KEY = this.settings.openaiApiKey;
		}

		// Register the conversation extension for CodeMirror
		this.registerEditorExtension([createCommandHighlightExtension(COMMAND_PREFIXES)]);

		console.log('Registered conversation extension');

		// This creates an icon in the left ribbon.
		const ribbonIconEl = this.addRibbonIcon('calculator', 'Math Assistant', (evt: MouseEvent) => {
			// Called when the user clicks the icon.
			new MathAssistantModal(this.app).open();
		});
		// Perform additional things with the ribbon
		ribbonIconEl.addClass('math-assistant-ribbon-class');

		// This adds a status bar item to the bottom of the app. Does not work on mobile apps.
		const statusBarItemEl = this.addStatusBarItem();
		statusBarItemEl.setText('Math Assistant Ready');

		// This adds a simple command that can be triggered anywhere
		this.addCommand({
			id: 'open-math-assistant',
			name: 'Open Math Assistant',
			callback: () => {
				new MathAssistantModal(this.app).open();
			},
		});

		// This adds an editor command that can perform some operation on the current editor instance
		this.addCommand({
			id: 'insert-math-result',
			name: 'Insert math calculation result',
			editorCallback: (editor: Editor, view: MarkdownView) => {
				const selection = editor.getSelection();
				if (selection) {
					// Use the selected text as input for the math assistant
					// For now, we'll just open the modal, but this could be enhanced to directly insert results
					new MathAssistantModal(this.app).open();
				} else {
					new Notice('Please select text describing a math operation');
				}
			},
		});

		// Add command to process command lines with Shift+Enter
		this.addCommand({
			id: 'process-command-line',
			name: 'Process command line',
			hotkeys: [{ modifiers: ['Shift'], key: 'Enter' }],
			editorCallback: (
				editor: Editor & {
					cm: EditorView;
				},
				view
			) => {
				console.log('Process command line triggered', editor, editor.cm);
				try {
					const result = handleShiftEnter(editor.cm);
					console.log('handleShiftEnter result:', result);
				} catch (error) {
					console.error('Error in handleShiftEnter:', error);
					new Notice(`Error processing command: ${error.message}`);
				}
			},
		});

		// This adds a settings tab so the user can configure various aspects of the plugin
		this.addSettingTab(new StewardSettingTab(this.app, this));

		// If the plugin hooks up any global DOM events (on parts of the app that doesn't belong to this plugin)
		// Using this function will automatically remove the event listener when this plugin is disabled.
		this.registerDomEvent(document, 'click', (evt: MouseEvent) => {
			console.log('click', evt);
		});

		// When registering intervals, this function will automatically clear the interval when the plugin is disabled.
		this.registerInterval(window.setInterval(() => console.log('setInterval'), 5 * 60 * 1000));
	}

	onunload() {}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}
