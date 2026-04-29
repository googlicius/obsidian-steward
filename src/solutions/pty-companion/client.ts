import { EventEmitter } from 'events';
import type { Socket } from 'socket.io-client';
import { PTY_COMPANION_HOST } from './protocol';
import type { PtyCompanionSpawnAck, PtyCompanionSpawnPayload } from './protocol';
import { getBundledLib } from 'src/utils/bundledLibs';

function attachSetEncoding(emitter: EventEmitter): EventEmitter {
  const e = emitter as EventEmitter & { setEncoding(_enc: BufferEncoding): EventEmitter };
  e.setEncoding = function setEncoding() {
    return e;
  };
  return e;
}

export type RemotePtyConnectionParams = {
  port: number;
  authToken: string;
};

export type RemotePtyChildShim = {
  pid: number | undefined;
  stdin: { writableEnded: boolean; write(chunk: string): boolean };
  resize?(cols: number, rows: number): void;
  stdout: EventEmitter & { setEncoding(enc: BufferEncoding): EventEmitter };
  stderr: EventEmitter & { setEncoding(enc: BufferEncoding): EventEmitter };
  on(
    event: 'close',
    listener: (code: number | null, signal: NodeJS.Signals | null) => void
  ): RemotePtyChildShim;
  on(event: 'error', listener: (err: Error) => void): RemotePtyChildShim;
  on(event: string, listener: (...args: unknown[]) => void): RemotePtyChildShim;
};

/**
 * Connects to {@link startPtyCompanionServer}, spawns one PTY, and exposes a child-like surface
 * for {@link CliSessionService} (stdin / stdout / stderr / close / error).
 */
export function createRemotePtySession(params: {
  connection: RemotePtyConnectionParams;
  spawn: PtyCompanionSpawnPayload;
}): Promise<{ child: RemotePtyChildShim; remoteKill: () => void; dispose: () => void }> {
  return (async () => {
    const { io } = await getBundledLib('socket.io-client');
    const url = `http://${PTY_COMPANION_HOST}:${params.connection.port}`;
    const socket: Socket = io(url, {
      auth: { token: params.connection.authToken },
      transports: ['polling'],
      upgrade: false,
      reconnection: false,
    });

    const stdout = attachSetEncoding(new EventEmitter()) as RemotePtyChildShim['stdout'];
    const stderr = attachSetEncoding(new EventEmitter()) as RemotePtyChildShim['stderr'];
    const procEmitter = new EventEmitter();

    let disposed = false;

    const dispose = (): void => {
      if (disposed) {
        return;
      }
      disposed = true;
      socket.emit('kill');
      socket.removeAllListeners();
      socket.disconnect();
      procEmitter.removeAllListeners();
      stdout.removeAllListeners();
      stderr.removeAllListeners();
    };

    const remoteKill = (): void => {
      socket.emit('kill');
    };

    return new Promise((resolve, reject) => {
      const fail = (err: Error): void => {
        dispose();
        reject(err);
      };

      socket.once('connect_error', (e: unknown) => {
        fail(e instanceof Error ? e : new Error(String(e)));
      });

      socket.once('connect', () => {
        socket.emit('spawn', params.spawn, (ack: PtyCompanionSpawnAck) => {
          if (!ack || ack.ok !== true) {
            const message =
              ack && 'error' in ack && typeof ack.error === 'string' ? ack.error : 'spawn failed';
            fail(new Error(message));
            return;
          }

          let exitReceived = false;

          socket.on('data', (chunk: string) => {
            if (typeof chunk === 'string') {
              stdout.emit('data', chunk);
            }
          });

          socket.on('error', (err: unknown) => {
            procEmitter.emit('error', err instanceof Error ? err : new Error(String(err)));
          });

          socket.on('exit', (payload: { exitCode: number; signal?: number }) => {
            exitReceived = true;
            const code = typeof payload?.exitCode === 'number' ? payload.exitCode : 0;
            procEmitter.emit('close', code, null);
            dispose();
          });

          socket.on('disconnect', () => {
            if (exitReceived) {
              return;
            }
            procEmitter.emit('close', -1, null);
            dispose();
          });

          const child = {
            pid: ack.pid,
            stdin: {
              get writableEnded(): boolean {
                return disposed;
              },
              write(chunk: string): boolean {
                if (disposed) {
                  return false;
                }
                socket.emit('input', chunk);
                return true;
              },
            },
            resize(cols: number, rows: number): void {
              if (disposed) {
                return;
              }
              if (!Number.isFinite(cols) || !Number.isFinite(rows)) {
                return;
              }
              socket.emit('resize', {
                cols: Math.max(2, Math.floor(cols)),
                rows: Math.max(1, Math.floor(rows)),
              });
            },
            stdout,
            stderr,
            on(event: string, listener: (...args: unknown[]) => void): RemotePtyChildShim {
              procEmitter.on(event, listener as (...args: never[]) => void);
              return child as RemotePtyChildShim;
            },
          } as unknown as RemotePtyChildShim;

          resolve({ child, remoteKill, dispose });
        });
      });
    });
  })();
}
