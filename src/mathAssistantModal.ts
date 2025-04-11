import { App, Modal, Setting } from 'obsidian';
import { executeToolByName, selectMathTool } from './tools/mathTools';

interface ToolSelection {
	toolName: string;
	firstNumber: number;
	secondNumber: number;
}

export class MathAssistantModal extends Modal {
	private userInput = '';
	private result = '';
	private isProcessing = false;

	constructor(app: App) {
		super(app);
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.createEl('h2', { text: 'Math Assistant' });

		new Setting(contentEl)
			.setName('What math operation would you like to perform?')
			.setDesc('Describe what you want to calculate in natural language')
			.addTextArea(text => {
				text.onChange(value => {
					this.userInput = value;
				});
				text.inputEl.rows = 4;
				text.inputEl.cols = 40;
				text.inputEl.placeholder = 'e.g., Add 5 and 3, or What is 10 divided by 2?';
			});

		const resultEl = contentEl.createEl('div', { cls: 'math-result' });
		resultEl.createEl('p', { text: 'Result will appear here', cls: 'math-result-text' });

		new Setting(contentEl)
			.addButton(btn => {
				btn
					.setButtonText('Calculate')
					.setCta()
					.onClick(async () => {
						if (!this.userInput.trim() || this.isProcessing) return;

						this.isProcessing = true;
						resultEl.empty();
						resultEl.createEl('p', { text: 'Processing...', cls: 'math-processing' });

						try {
							const toolSelection = (await selectMathTool(this.userInput)) as ToolSelection;

							console.log('toolSelection', toolSelection);

							const { toolName, firstNumber, secondNumber } = toolSelection;
							const result = executeToolByName(toolName, firstNumber, secondNumber);

							resultEl.empty();
							resultEl.createEl('p', {
								text: `Operation: ${toolName}`,
								cls: 'math-operation',
							});
							resultEl.createEl('p', {
								text: `Numbers: ${firstNumber} and ${secondNumber}`,
								cls: 'math-numbers',
							});
							resultEl.createEl('p', {
								text: `Result: ${result}`,
								cls: 'math-result-text',
							});
						} catch (error) {
							resultEl.empty();
							resultEl.createEl('p', {
								text: `Error: ${error.message}`,
								cls: 'math-error',
							});
						} finally {
							this.isProcessing = false;
						}
					});
			})
			.addButton(btn => {
				btn.setButtonText('Cancel').onClick(() => {
					this.close();
				});
			});
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}
