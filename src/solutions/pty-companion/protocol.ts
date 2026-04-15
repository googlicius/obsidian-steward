/** Loopback-only companion; port is chosen at runtime (see PtyCompanionService). */
export const PTY_COMPANION_HOST = '127.0.0.1';

export type PtyCompanionSpawnPayload = {
  file: string;
  args: string[];
  cwd: string;
  /** Optional env; defaults to companion process env on the server. */
  env?: NodeJS.ProcessEnv;
  cols?: number;
  rows?: number;
};

export type PtyCompanionSpawnAck =
  | { ok: true; pid: number }
  | { ok: false; error: string };

export type PtyCompanionExitPayload = {
  exitCode: number;
  signal?: number;
};
