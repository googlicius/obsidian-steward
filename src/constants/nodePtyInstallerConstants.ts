/** GitHub org/repo for @homebridge/node-pty-prebuilt-multiarch release assets. */
export const NODE_PTY_PREBUILT_OWNER = 'homebridge';
export const NODE_PTY_PREBUILT_REPO = 'node-pty-prebuilt-multiarch';

/**
 * Pin to a published release tag of node-pty-prebuilt-multiarch (without leading v in constant).
 * Must match a real https://github.com/homebridge/node-pty-prebuilt-multiarch/releases/tag/v{version}
 */
export const NODE_PTY_PREBUILT_PACKAGE_VERSION = '0.13.1';

/** Bump when the generated installer bodies change materially (for debugging / future migrations). */
export const NODE_PTY_INSTALLER_TEMPLATE_VERSION = 5;

export const NODE_PTY_INSTALLER_LATEST_BASENAME = 'install-node-pty-runtime-latest.sh';

export const NODE_PTY_INSTALLER_LATEST_PS1_BASENAME = 'install-node-pty-runtime-latest.ps1';

export function buildNodePtyInstallerVersionedBasename(pluginVersion: string): string {
  const clean = pluginVersion.replace(/^v/i, '');
  return `install-node-pty-runtime-${clean}.sh`;
}

export function buildNodePtyInstallerVersionedPs1Basename(pluginVersion: string): string {
  const clean = pluginVersion.replace(/^v/i, '');
  return `install-node-pty-runtime-${clean}.ps1`;
}
