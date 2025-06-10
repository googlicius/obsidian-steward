import {
	getOpenAIChatModelInformation,
	OpenAIChatBaseModelType,
	OpenAIChatModel as OpenAIChatModelBase,
	OpenAIChatModelType,
	OpenAIChatSettings,
} from 'modelfusion';

const CHAT_MODEL_CONTEXT_WINDOW_SIZES_EXTENDED: Record<string, number> = {
	'gpt-4o': 128000,
};

function getOpenAIChatModelInformationExtended(model: string) {
	if (model in CHAT_MODEL_CONTEXT_WINDOW_SIZES_EXTENDED) {
		const contextWindowSize = CHAT_MODEL_CONTEXT_WINDOW_SIZES_EXTENDED[model];

		return {
			baseModel: model as OpenAIChatBaseModelType,
			isFineTuned: false,
			contextWindowSize,
		};
	}

	return getOpenAIChatModelInformation(model as OpenAIChatModelType);
}

export class OpenAIChatModel extends OpenAIChatModelBase {
	readonly contextWindowSize: number;

	constructor(settings: OpenAIChatSettings) {
		super({
			...settings,
			model: 'gpt-4', // Use a known supported model to avoid the error
		});

		const modelInformation = getOpenAIChatModelInformationExtended(settings.model);

		this.settings.model = settings.model;
		this.contextWindowSize = modelInformation.contextWindowSize;
	}

	withSettings(additionalSettings: Partial<OpenAIChatSettings>) {
		return new OpenAIChatModel(Object.assign({}, this.settings, additionalSettings)) as this;
	}
}
