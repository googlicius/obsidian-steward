import { FileSystemAdapter, normalizePath } from 'obsidian';
import type StewardPlugin from 'src/main';
import { loadNodeModule } from 'src/utils/loadNodeModule';

/**
 * Absolute path to the extracted `node-pty-prebuilt` tree under the vault (desktop / local only).
 * Patched `node-pty` resolves `conpty.node` / `pty.node` from this root (see `prebuilds/<platform>-<arch>` etc.).
 */
export async function resolveVaultPtyNativePath(plugin: StewardPlugin): Promise<string | null> {
  const path = await loadNodeModule('path').catch(() => null);
  if (!path) {
    return null;
  }

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
