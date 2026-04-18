import { Platform } from 'obsidian';
import { logger } from 'src/utils/logger';
import { startPtyCompanionServer } from 'src/solutions/pty-companion/server';
import type { RemotePtyConnectionParams } from 'src/solutions/pty-companion/client';
import type StewardPlugin from 'src/main';

export class PtyCompanionService {
  private port: number | null = null;
  private authToken: string | null = null;
  private closeFn: (() => Promise<void>) | null = null;

  public constructor(private readonly plugin: StewardPlugin) {}

  get isReady(): boolean {
    return this.port !== null && this.authToken !== null;
  }

  getConnectionParams(): RemotePtyConnectionParams | null {
    if (this.port === null || this.authToken === null) {
      return null;
    }
    return { port: this.port, authToken: this.authToken };
  }

  async start(): Promise<void> {
    if (!Platform.isDesktopApp) {
      return;
    }
    try {
      const handle = await startPtyCompanionServer(this.plugin);
      this.port = handle.port;
      this.authToken = handle.authToken;
      this.closeFn = handle.close;
      logger.log(`Pty companion listening on 127.0.0.1:${handle.port}`);
    } catch (error) {
      logger.error('PtyCompanionService failed to start:', error);
      this.port = null;
      this.authToken = null;
      this.closeFn = null;
    }
  }

  async stop(): Promise<void> {
    const close = this.closeFn;
    this.port = null;
    this.authToken = null;
    this.closeFn = null;
    if (close) {
      await close();
    }
  }
}
