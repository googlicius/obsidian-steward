import { App, PluginSettingTab, Setting } from 'obsidian';
import StewardPlugin from './main';

export default class StewardSettingTab extends PluginSettingTab {
	plugin: StewardPlugin;

	constructor(app: App, plugin: StewardPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;

		containerEl.empty();

		containerEl.createEl('h2', { text: 'Steward Plugin Settings' });

		new Setting(containerEl)
			.setName('OpenAI API Key')
			.setDesc('Your OpenAI API key for using the Math Assistant')
			.addText(text =>
				text
					.setPlaceholder('Enter your API key')
					.setValue(this.plugin.settings.openaiApiKey)
					.onChange(async value => {
						this.plugin.settings.openaiApiKey = value;
						await this.plugin.saveSettings();

						// Update the environment variable immediately
						if (value) {
							process.env.OPENAI_API_KEY = value;
						}
					})
					// Add password type to protect API key
					.inputEl.setAttribute('type', 'password')
			);

		containerEl.createEl('div', {
			text: 'Note: You need to provide your own OpenAI API key to use the AI-powered math assistant.',
			cls: 'setting-item-description',
		});

		// Add setting for conversation folder
		new Setting(containerEl)
			.setName('Conversation Folder')
			.setDesc('Folder where conversation notes will be stored')
			.addText(text =>
				text
					.setPlaceholder('conversations')
					.setValue(this.plugin.settings.conversationFolder)
					.onChange(async value => {
						this.plugin.settings.conversationFolder = value || 'conversations';
						await this.plugin.saveSettings();
					})
			);

		containerEl.createEl('h3', { text: 'Math Assistant' });
		containerEl.createEl('p', {
			text: 'The Math Assistant provides natural language processing for math operations. Simply describe what calculation you want to perform, and the AI will select the appropriate operation and numbers.',
		});

		containerEl.createEl('div', {
			cls: 'math-assistant-example',
			text: 'Examples: "Add 5 and 3", "What is 10 minus 7?", "Multiply 4 by 6", "Divide 20 by 5"',
		});
	}
}
