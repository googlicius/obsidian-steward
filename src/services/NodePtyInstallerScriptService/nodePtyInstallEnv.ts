import { loadNodeModule } from 'src/utils/loadNodeModule';

/**
 * Best-effort musl detection on Linux (matches typical node-prebuild platform tokens).
 * Loads `child_process` via {@link loadNodeModule} so the plugin can start on runtimes
 * where that built-in is missing.
 */
async function detectLinuxMusl(): Promise<boolean> {
  if (process.platform !== 'linux') {
    return false;
  }
  const cp = await loadNodeModule('child_process').catch(() => null);
  if (!cp || typeof cp.execSync !== 'function') {
    return false;
  }
  try {
    const out = cp.execSync('ldd --version 2>&1', { encoding: 'utf8', timeout: 3000 });
    return out.toLowerCase().includes('musl');
  } catch {
    return false;
  }
}

/**
 * Target OS-ARCH token for @homebridge/node-pty-prebuilt-multiarch release tarballs,
 * for the **current** Obsidian/Electron process.
 */
export async function getNodePtyPrebuiltOsArchForCurrentProcess(): Promise<string> {
  const platform = process.platform;
  const arch = process.arch;

  if (platform === 'darwin') {
    return arch === 'arm64' ? 'darwin-arm64' : 'darwin-x64';
  }

  if (platform === 'win32') {
    return arch === 'ia32' ? 'win32-ia32' : 'win32-x64';
  }

  if (platform === 'linux') {
    const musl = await detectLinuxMusl();
    const prefix = musl ? 'linuxmusl' : 'linux';
    if (arch === 'arm64') {
      return `${prefix}-arm64`;
    }
    if (arch === 'arm') {
      return `${prefix}-arm`;
    }
    return `${prefix}-x64`;
  }

  return `${platform}-${arch}`;
}
