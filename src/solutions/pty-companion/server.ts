import { createServer } from 'http';
import type { Server as HttpServer } from 'http';
import type { IPty } from 'node-pty';
import {
  PTY_COMPANION_HOST,
  type PtyCompanionExitPayload,
  type PtyCompanionSpawnAck,
  type PtyCompanionSpawnPayload,
} from './protocol';
import { FileSystemAdapter, normalizePath } from 'obsidian';
import type StewardPlugin from 'src/main';
import path from 'path';
import { uniqueID } from 'src/utils/uniqueID';
import { getBundledLib } from 'src/utils/bundledLibs';

/**
 * Absolute path to the extracted `node-pty-prebuilt` tree under the vault (desktop / local only).
 * Patched `node-pty` resolves `conpty.node` / `pty.node` from this root (see `prebuilds/<platform>-<arch>` etc.).
 */
export function resolveVaultPtyNativePath(plugin: StewardPlugin): string | null {
  const adapter = plugin.app.vault.adapter;
  if (!(adapter instanceof FileSystemAdapter)) {
    return null;
  }
  const vaultRoot = adapter.getBasePath();
  const configured =
    typeof plugin.settings.cli.nodePtyNativePath === 'string'
      ? plugin.settings.cli.nodePtyNativePath.trim()
      : '';
  const relative =
    configured !== ''
      ? normalizePath(configured)
      : normalizePath(`${plugin.settings.stewardFolder}/node-pty-prebuilt`);
  if (path.isAbsolute(relative)) {
    return path.normalize(relative);
  }
  const segments = relative.split('/').filter(s => s.length > 0);
  return path.join(vaultRoot, ...segments);
}

export type PtyCompanionServerHandle = {
  port: number;
  authToken: string;
  close: () => Promise<void>;
};

const DEFAULT_COLS = 80;
const DEFAULT_ROWS = 24;

/**
 * Minimal Socket.IO + node-pty sidecar bound to loopback. One socket == one PTY.
 * Uses Engine.IO **polling** only (no WebSocket transport / `ws` server).
 */
export function startPtyCompanionServer(plugin: StewardPlugin): Promise<PtyCompanionServerHandle> {
  return (async () => {
    const { Server } = await getBundledLib('socketIo');
    return new Promise<PtyCompanionServerHandle>((resolve, reject) => {
      let settled = false;
      const httpServer: HttpServer = createServer();
      const authToken = uniqueID();

      const io = new Server(httpServer, {
        cors: { origin: 'app://obsidian.md' },
        transports: ['polling'],
        allowUpgrades: false,
      });

      io.use((socket, next) => {
        const token = socket.handshake.auth?.token;
        if (typeof token === 'string' && token === authToken) {
          next();
          return;
        }
        next(new Error('unauthorized'));
      });

      io.on('connection', socket => {
        let term: IPty | null = null;

        const cleanup = (): void => {
          if (term) {
            try {
              term.kill();
            } catch {
              // ignore
            }
            term = null;
          }
        };

        socket.on(
          'spawn',
          (payload: PtyCompanionSpawnPayload, ack?: (r: PtyCompanionSpawnAck) => void) => {
            cleanup();
            if (
              typeof payload?.file !== 'string' ||
              !Array.isArray(payload.args) ||
              typeof payload.cwd !== 'string'
            ) {
              ack?.({ ok: false, error: 'invalid spawn payload' });
              return;
            }
            const ptyBinaryPath = resolveVaultPtyNativePath(plugin);
            if (!ptyBinaryPath) {
              ack?.({ ok: false, error: 'local vault path unavailable for node-pty runtime' });
              return;
            }
            // Patched node-pty only: upstream does not read this env (see patches/node-pty+*.patch).
            process.env.NODE_PTY_NATIVE_MODULE_DIR = ptyBinaryPath;
            void (async () => {
              try {
                const pty = await getBundledLib('nodePty');
                const cols = typeof payload.cols === 'number' ? payload.cols : DEFAULT_COLS;
                const rows = typeof payload.rows === 'number' ? payload.rows : DEFAULT_ROWS;
                term = pty.spawn(payload.file, payload.args, {
                  name: 'xterm-256color',
                  cols,
                  rows,
                  cwd: payload.cwd,
                  env: payload.env ?? process.env,
                });
              } catch (e) {
                ack?.({ ok: false, error: String(e) });
                return;
              }

              term.onData((data: string) => {
                socket.emit('data', data);
              });

              term.onExit(({ exitCode, signal }) => {
                const payloadOut: PtyCompanionExitPayload = {
                  exitCode,
                  signal: signal ?? undefined,
                };
                socket.emit('exit', payloadOut);
                cleanup();
              });

              ack?.({ ok: true, pid: term.pid });
            })();
          }
        );

        socket.on('input', (chunk: string) => {
          if (term && typeof chunk === 'string') {
            term.write(chunk);
          }
        });

        socket.on('resize', (size: { cols: number; rows: number }) => {
          if (!term || typeof size?.cols !== 'number' || typeof size?.rows !== 'number') {
            return;
          }
          try {
            term.resize(size.cols, size.rows);
          } catch {
            // ignore
          }
        });

        socket.on('kill', () => {
          cleanup();
        });

        socket.on('disconnect', () => {
          cleanup();
        });
      });

      httpServer.once('error', err => {
        if (!settled) {
          settled = true;
          reject(err);
        }
      });

      httpServer.listen(0, PTY_COMPANION_HOST, () => {
        const addr = httpServer.address();
        const port = typeof addr === 'object' && addr && 'port' in addr ? addr.port : 0;
        if (!port) {
          if (!settled) {
            settled = true;
            reject(new Error('pty companion: failed to bind port'));
          }
          return;
        }

        const close = (): Promise<void> =>
          new Promise(res => {
            io.close(() => {
              httpServer.close(() => res());
            });
          });

        if (!settled) {
          settled = true;
          resolve({ port, authToken, close });
        }
      });
    });
  })();
}
