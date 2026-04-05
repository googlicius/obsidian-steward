export interface MigrationStepContext<TData, TExtraContext> {
  data: TData;
  fromVersion: number;
  toVersion: number;
  extraContext: TExtraContext;
}

export type MigrationStep<TData, TExtraContext> = (
  context: MigrationStepContext<TData, TExtraContext>
) => Promise<void> | void;

export interface RunSequentialMigrationsInput<TData, TExtraContext> {
  data: TData;
  fromVersion: number;
  currentVersion: number;
  versionKey: keyof TData;
  steps: Partial<Record<number, MigrationStep<TData, TExtraContext>>>;
  extraContext: TExtraContext;
}

export interface RunSequentialMigrationsResult {
  changed: boolean;
  finalVersion: number;
}

export async function runSequentialMigrations<TData, TExtraContext>(
  input: RunSequentialMigrationsInput<TData, TExtraContext>
): Promise<RunSequentialMigrationsResult> {
  if (!Number.isInteger(input.fromVersion) || input.fromVersion < 0) {
    throw new Error(`Invalid fromVersion: ${input.fromVersion}`);
  }

  if (!Number.isInteger(input.currentVersion) || input.currentVersion < 0) {
    throw new Error(`Invalid currentVersion: ${input.currentVersion}`);
  }

  if (input.fromVersion > input.currentVersion) {
    throw new Error(
      `fromVersion (${input.fromVersion}) is newer than currentVersion (${input.currentVersion})`
    );
  }

  if (input.fromVersion === input.currentVersion) {
    return {
      changed: false,
      finalVersion: input.currentVersion,
    };
  }

  let workingVersion = input.fromVersion;

  while (workingVersion < input.currentVersion) {
    const step = input.steps[workingVersion];
    if (!step) {
      throw new Error(
        `Missing migration step for version ${workingVersion} -> ${workingVersion + 1}`
      );
    }

    await step({
      data: input.data,
      fromVersion: workingVersion,
      toVersion: workingVersion + 1,
      extraContext: input.extraContext,
    });

    workingVersion += 1;
    (input.data as Record<string, unknown>)[String(input.versionKey)] = workingVersion;
  }

  return {
    changed: true,
    finalVersion: workingVersion,
  };
}
