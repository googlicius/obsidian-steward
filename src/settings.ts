import { App, Notice, PluginSettingTab, Setting } from 'obsidian';
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

		// OpenAI API Key setting with encryption
		new Setting(containerEl)
			.setName('OpenAI API Key')
			.setDesc('Your OpenAI API key (stored with encryption)')
			.addText(text => {
				// Get the current API key (decrypted) with error handling
				let placeholder = 'Enter your API key';
				try {
					const currentKey = this.plugin.getDecryptedApiKey();
					if (currentKey) {
						placeholder = '••••••••••••••••••••••';
					}
				} catch (error) {
					// If decryption fails, we'll show a special message
					placeholder = 'Error: Click to re-enter key';
					console.error('Error decrypting API key in settings:', error);
				}

				text
					.setPlaceholder(placeholder)
					// Only show value if editing
					.setValue('')
					.onChange(async value => {
						if (value) {
							try {
								// If a value is entered, encrypt and save it
								await this.plugin.setEncryptedApiKey(value);

								// Update the placeholder to show that a key is saved
								text.setPlaceholder('••••••••••••••••••••••');
								// Clear the input field for security
								text.setValue('');
							} catch (error) {
								new Notice('Failed to save API key. Please try again.');
								console.error('Error setting API key:', error);
							}
						}
					});

				// Add password type to protect API key
				text.inputEl.setAttribute('type', 'password');
			})
			.addExtraButton(button => {
				button
					.setIcon('cross')
					.setTooltip('Clear API Key')
					.onClick(async () => {
						try {
							await this.plugin.setEncryptedApiKey('');
							// Force refresh of the settings
							this.display();
						} catch (error) {
							new Notice('Failed to clear API key. Please try again.');
							console.error('Error clearing API key:', error);
						}
					});
			})
			.addExtraButton(button => {
				button
					.setIcon('reset')
					.setTooltip('Reset Encryption')
					.onClick(async () => {
						try {
							// Get the current key if possible
							let currentKey = '';
							try {
								currentKey = this.plugin.getDecryptedApiKey();
							} catch (e) {
								// If we can't decrypt, we'll start fresh
							}

							// Generate a new salt key ID
							this.plugin.settings.saltKeyId = '';
							this.plugin.settings.encryptedOpenaiApiKey = '';
							await this.plugin.saveSettings();

							// Force reload of the plugin to re-initialize encryption
							this.display();

							// If we had a key before, prompt user to re-enter it
							if (currentKey) {
								new Notice('Encryption reset. Please re-enter your API key.');
							} else {
								new Notice('Encryption reset successfully.');
							}
						} catch (error) {
							new Notice('Failed to reset encryption. Please try again.');
							console.error('Error resetting encryption:', error);
						}
					});
			});

		containerEl.createEl('div', {
			text: 'Note: You need to provide your own OpenAI API key to use the AI-powered assistant.',
			cls: 'setting-item-description',
		});

		// If we have encryption issues, show instructions for resetting
		if (this.plugin.settings.encryptedOpenaiApiKey) {
			try {
				this.plugin.getDecryptedApiKey();
			} catch (error) {
				containerEl.createEl('div', {
					text: 'If you are seeing decryption errors, please use the "Reset Encryption" button and re-enter your API key.',
					cls: 'setting-item-description mod-warning',
				});
			}
		}

		// Add setting for conversation folder
		new Setting(containerEl)
			.setName('Conversation Folder')
			.setDesc('Folder where conversation notes will be stored')
			.addText(text =>
				text
					.setPlaceholder('conversations')
					.setValue(this.plugin.settings.conversationFolder)
					.onChange(async value => {
						this.plugin.settings.conversationFolder = value || 'Steward/Conversations';
						await this.plugin.saveSettings();
					})
			);
	}
}
