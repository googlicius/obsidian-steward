import { DEFAULT_SETTINGS } from 'src/constants';
import type { StewardPluginSettings } from 'src/types/interfaces';

import { migrateSettingsFrom2To3 } from './migrateSettingsFrom2To3';

function cloneDefaults(): StewardPluginSettings {
  return JSON.parse(JSON.stringify(DEFAULT_SETTINGS)) as StewardPluginSettings;
}

describe('migrateSettingsFrom2To3', () => {
  it('collects customModels from all legacy sources into settings.models', () => {
    const settings = cloneDefaults();
    settings.llm.chat.customModels = ['custom:chat-a'];
    settings.llm.agents.compactionSummary.customModels = ['custom:chat-b'];
    settings.llm.agents.conversationTitle.customModels = ['custom:chat-a'];
    settings.embedding.customModels = ['custom:embed-a'];
    settings.llm.speech.customModels = ['custom:speech-a'];
    settings.llm.image.customModels = ['custom:image-a'];

    migrateSettingsFrom2To3(settings);

    expect(settings.models).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'custom:chat-a', kinds: ['chat'] }),
        expect.objectContaining({ id: 'custom:chat-b', kinds: ['chat'] }),
        expect.objectContaining({ id: 'custom:embed-a', kinds: ['embedding'] }),
        expect.objectContaining({ id: 'custom:speech-a', kinds: ['speech'] }),
        expect.objectContaining({ id: 'custom:image-a', kinds: ['image'] }),
      ])
    );
  });

  it('merges kinds when the same id appears in multiple chat lists', () => {
    const settings = cloneDefaults();
    settings.llm.chat.customModels = ['custom:shared'];
    settings.llm.agents.conversationTitle.customModels = ['custom:shared'];

    migrateSettingsFrom2To3(settings);

    const shared = settings.models.find(model => model.id === 'custom:shared');
    expect(shared?.kinds).toEqual(['chat']);
    expect(settings.models.filter(model => model.id === 'custom:shared')).toHaveLength(1);
  });

  it('sets configurable temperature policy for all migrated models', () => {
    const settings = cloneDefaults();
    settings.llm.chat.customModels = ['openai:o1-preview', 'custom:chat-a'];
    settings.embedding.customModels = ['custom:embed-a'];

    migrateSettingsFrom2To3(settings);

    for (const model of settings.models) {
      expect(model.temperaturePolicy).toBe('configurable');
      expect(model.temperature).toBeUndefined();
    }
  });

  it('clears legacy customModels arrays', () => {
    const settings = cloneDefaults();
    settings.llm.chat.customModels = ['custom:chat-a'];
    settings.embedding.customModels = ['custom:embed-a'];

    migrateSettingsFrom2To3(settings);

    expect(settings.llm.chat.customModels).toBeUndefined();
    expect(settings.embedding.customModels).toBeUndefined();
  });

  it('does not duplicate bundled presets in settings.models', () => {
    const settings = cloneDefaults();
    settings.llm.chat.customModels = ['openai:gpt-4o'];

    migrateSettingsFrom2To3(settings);

    expect(settings.models.some(model => model.id === 'openai:gpt-4o')).toBe(false);
  });

  it('adds active non-preset selected models missing from customModels', () => {
    const settings = cloneDefaults();
    settings.llm.chat.model = 'custom:active-only';

    migrateSettingsFrom2To3(settings);

    expect(settings.models.some(model => model.id === 'custom:active-only')).toBe(true);
  });
});
