import { DEFAULT_SETTINGS } from 'src/constants';
import { migrateSettingsFrom1To2 } from './migrateSettingsFrom1To2';
import type { StewardPluginSettings } from 'src/types/interfaces';

function cloneSettings(base: StewardPluginSettings): StewardPluginSettings {
  return JSON.parse(JSON.stringify(base)) as StewardPluginSettings;
}

describe('migrateSettingsFrom1To2', () => {
  it('removes unused deepseek/groq stubs', () => {
    const settings = cloneSettings(DEFAULT_SETTINGS);
    settings.providers.deepseek = { apiKey: '' };
    settings.providers.groq = { apiKey: '' };
    settings.llm.chat.model = 'openai:gpt-4o';

    migrateSettingsFrom1To2(settings);

    expect(settings.providers.deepseek).toBeUndefined();
    expect(settings.providers.groq).toBeUndefined();
  });

  it('converts deepseek to OpenAI-compatible custom when referenced', () => {
    const settings = cloneSettings(DEFAULT_SETTINGS);
    settings.providers.deepseek = { apiKey: '' };
    settings.llm.chat.model = 'deepseek:deepseek-chat';

    migrateSettingsFrom1To2(settings);

    expect(settings.providers.deepseek).toMatchObject({
      isCustom: true,
      compatibility: 'openai',
      name: 'DeepSeek',
      baseUrl: 'https://api.deepseek.com/v1',
    });
    expect(settings.llm.chat.customModels).toContain('deepseek:deepseek-chat');
  });

  it('converts groq when provider has api key', () => {
    const settings = cloneSettings(DEFAULT_SETTINGS);
    settings.providers.groq = { apiKey: 'encrypted-blob' };

    migrateSettingsFrom1To2(settings);

    expect(settings.providers.groq).toMatchObject({
      isCustom: true,
      compatibility: 'openai',
      name: 'Groq',
      baseUrl: 'https://api.groq.com/openai/v1',
    });
  });

  it('preserves explicit baseUrl and custom name', () => {
    const settings = cloneSettings(DEFAULT_SETTINGS);
    settings.providers.deepseek = {
      apiKey: '',
      baseUrl: 'https://example.com/v1',
      name: 'My DeepSeek',
    };
    settings.llm.chat.model = 'deepseek:deepseek-chat';

    migrateSettingsFrom1To2(settings);

    expect(settings.providers.deepseek).toMatchObject({
      isCustom: true,
      compatibility: 'openai',
      name: 'My DeepSeek',
      baseUrl: 'https://example.com/v1',
    });
  });

  it('adds deepseek/groq agent models to each agent customModels for dropdowns', () => {
    const settings = cloneSettings(DEFAULT_SETTINGS);
    settings.providers.deepseek = { apiKey: 'x' };
    settings.providers.groq = { apiKey: 'y' };
    settings.llm.agents.compactionSummary.model = 'deepseek:deepseek-chat';
    settings.llm.agents.compactionSummary.customModels = [];
    settings.llm.agents.conversationTitle.model = 'groq:meta-llama/llama-4-scout-17b-16e-instruct';
    settings.llm.agents.conversationTitle.customModels = [];

    migrateSettingsFrom1To2(settings);

    expect(settings.llm.agents.compactionSummary.customModels).toEqual(['deepseek:deepseek-chat']);
    expect(settings.llm.agents.conversationTitle.customModels).toEqual([
      'groq:meta-llama/llama-4-scout-17b-16e-instruct',
    ]);
  });

  it('does not duplicate model ids already in customModels', () => {
    const settings = cloneSettings(DEFAULT_SETTINGS);
    settings.providers.deepseek = { apiKey: 'x' };
    settings.llm.chat.model = 'deepseek:deepseek-chat';
    settings.llm.chat.customModels = ['deepseek:deepseek-chat'];

    migrateSettingsFrom1To2(settings);

    expect(settings.llm.chat.customModels).toEqual(['deepseek:deepseek-chat']);
  });
});
