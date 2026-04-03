import type StewardPlugin from 'src/main';
import { StewardPluginSettings } from 'src/types/interfaces';

import { CURRENT_SETTINGS_SCHEMA_VERSION } from './constants';
import { migrateSettingsFrom0To1 } from './migrateSettingsFrom0To1';
import { migrateSettingsFrom1To2 } from './migrateSettingsFrom1To2';
import { MigrationStep, runSequentialMigrations } from './runSequentialMigrations';

export interface SettingsSchemaMigrationContext {
  plugin: StewardPlugin;
  settings: StewardPluginSettings;
  fromVersion: number;
  toVersion: number;
}

export type SettingsSchemaMigration = (
  context: SettingsSchemaMigrationContext
) => Promise<void> | void;

type SettingsMigrationExtraContext = {
  plugin: StewardPlugin;
};

type InternalSettingsSchemaMigration = MigrationStep<
  StewardPluginSettings,
  SettingsMigrationExtraContext
>;

export const SETTINGS_SCHEMA_MIGRATIONS: Partial<Record<number, InternalSettingsSchemaMigration>> =
  {
    0: async context => {
      await migrateSettingsFrom0To1({
        plugin: context.extraContext.plugin,
        settings: context.data,
      });
    },
    1: context => {
      migrateSettingsFrom1To2(context.data);
    },
  };

export interface RunSettingsSchemaMigrationsInput {
  plugin: StewardPlugin;
  settings: StewardPluginSettings;
  fromVersion: number;
}

export async function runSettingsSchemaMigrations(
  input: RunSettingsSchemaMigrationsInput
): Promise<{ changed: boolean; finalVersion: number }> {
  return runSequentialMigrations({
    data: input.settings,
    fromVersion: input.fromVersion,
    currentVersion: CURRENT_SETTINGS_SCHEMA_VERSION,
    versionKey: 'settingsSchemaVersion',
    steps: SETTINGS_SCHEMA_MIGRATIONS,
    extraContext: {
      plugin: input.plugin,
    },
  });
}
