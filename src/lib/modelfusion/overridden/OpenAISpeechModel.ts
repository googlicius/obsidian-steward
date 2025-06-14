import {
  FunctionCallOptions,
  OpenAIApiConfiguration,
  OpenAISpeechModel as OpenAISpeechModelBase,
  OpenAISpeechModelSettings,
} from 'modelfusion';
import {
  postJsonToApi,
  callWithRetryAndThrottle,
  createAudioMpegResponseHandler,
} from 'modelfusion/internal';

interface OpenAISpeechModelSettingsOverride extends OpenAISpeechModelSettings {
  instructions?: string;
}

export class OpenAISpeechModel extends OpenAISpeechModelBase {
  get settingsOverride() {
    return this.settings as OpenAISpeechModelSettingsOverride;
  }

  constructor(settings: OpenAISpeechModelSettingsOverride) {
    super(settings);
  }

  /**
   * @override callAPI: Add instructions to the request body
   */
  private async callAPI2(text: string, callOptions: FunctionCallOptions): Promise<Uint8Array> {
    const api = this.settings.api ?? new OpenAIApiConfiguration();
    const abortSignal = callOptions.run?.abortSignal;

    return callWithRetryAndThrottle({
      retry: api.retry,
      throttle: api.throttle,
      call: async () =>
        postJsonToApi({
          url: api.assembleUrl(`/audio/speech`),
          headers: api.headers({
            functionType: callOptions.functionType,
            functionId: callOptions.functionId,
            run: callOptions.run,
            callId: callOptions.callId,
          }),
          body: {
            input: text,
            voice: this.settings.voice,
            speed: this.settings.speed,
            model: this.settings.model,
            instructions: this.settingsOverride.instructions,
            response_format: this.settings.responseFormat,
          },
          failedResponseHandler: () => {
            throw new Error('Failed to call OpenAI API');
          },
          successfulResponseHandler: createAudioMpegResponseHandler(),
          abortSignal,
        }),
    });
  }

  doGenerateSpeechStandard(text: string, options: FunctionCallOptions): Promise<Uint8Array> {
    return this.callAPI2(text, options);
  }

  withSettings(additionalSettings: Partial<OpenAISpeechModelSettings>) {
    return new OpenAISpeechModel({
      ...this.settings,
      ...additionalSettings,
    }) as this;
  }
}
