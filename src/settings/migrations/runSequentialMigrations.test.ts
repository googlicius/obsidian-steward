import { runSequentialMigrations } from './runSequentialMigrations';

interface FakeData {
  settingsSchemaVersion: number;
  markers: string[];
}

describe('runSequentialMigrations', () => {
  it('runs all intermediate steps in order for 3 versions behind', async () => {
    const data: FakeData = {
      settingsSchemaVersion: 1,
      markers: [],
    };

    const runResult = await runSequentialMigrations({
      data,
      fromVersion: 1,
      currentVersion: 4,
      versionKey: 'settingsSchemaVersion',
      extraContext: {},
      steps: {
        1: ({ data: target }) => {
          target.markers.push('1->2');
        },
        2: ({ data: target }) => {
          target.markers.push('2->3');
        },
        3: ({ data: target }) => {
          target.markers.push('3->4');
        },
      },
    });

    expect(runResult.changed).toBe(true);
    expect(runResult.finalVersion).toBe(4);
    expect(data.settingsSchemaVersion).toBe(4);
    expect(data.markers).toEqual(['1->2', '2->3', '3->4']);
  });

  it('runs all intermediate steps in order for 2 versions behind', async () => {
    const data: FakeData = {
      settingsSchemaVersion: 2,
      markers: [],
    };

    const runResult = await runSequentialMigrations({
      data,
      fromVersion: 2,
      currentVersion: 4,
      versionKey: 'settingsSchemaVersion',
      extraContext: {},
      steps: {
        2: ({ data: target }) => {
          target.markers.push('2->3');
        },
        3: ({ data: target }) => {
          target.markers.push('3->4');
        },
      },
    });

    expect(runResult.changed).toBe(true);
    expect(runResult.finalVersion).toBe(4);
    expect(data.settingsSchemaVersion).toBe(4);
    expect(data.markers).toEqual(['2->3', '3->4']);
  });

  it('returns unchanged when fromVersion matches currentVersion', async () => {
    const data: FakeData = {
      settingsSchemaVersion: 4,
      markers: [],
    };

    const runResult = await runSequentialMigrations({
      data,
      fromVersion: 4,
      currentVersion: 4,
      versionKey: 'settingsSchemaVersion',
      extraContext: {},
      steps: {},
    });

    expect(runResult.changed).toBe(false);
    expect(runResult.finalVersion).toBe(4);
    expect(data.markers).toEqual([]);
  });

  it('throws and keeps current version when a migration step fails', async () => {
    const data: FakeData = {
      settingsSchemaVersion: 1,
      markers: [],
    };

    await expect(
      runSequentialMigrations({
        data,
        fromVersion: 1,
        currentVersion: 3,
        versionKey: 'settingsSchemaVersion',
        extraContext: {},
        steps: {
          1: ({ data: target }) => {
            target.markers.push('1->2');
          },
          2: () => {
            throw new Error('migration failed');
          },
        },
      })
    ).rejects.toThrow('migration failed');

    expect(data.settingsSchemaVersion).toBe(2);
    expect(data.markers).toEqual(['1->2']);
  });
});
