/** GitHub org/repo for @homebridge/node-pty-prebuilt-multiarch release assets. */
export const NODE_PTY_PREBUILT_OWNER = 'homebridge';
export const NODE_PTY_PREBUILT_REPO = 'node-pty-prebuilt-multiarch';

/**
 * Pin to a published release tag of node-pty-prebuilt-multiarch (without leading v in constant).
 * Must match a real https://github.com/homebridge/node-pty-prebuilt-multiarch/releases/tag/v{version}
 */
export const NODE_PTY_PREBUILT_PACKAGE_VERSION = '0.13.1';

/** Bump when the generated shell body changes materially (for debugging / future migrations). */
export const NODE_PTY_INSTALLER_TEMPLATE_VERSION = 4;

export const NODE_PTY_INSTALLER_LATEST_BASENAME = 'install-node-pty-runtime-latest.sh';

export function buildNodePtyInstallerVersionedBasename(pluginVersion: string): string {
  const clean = pluginVersion.replace(/^v/i, '');
  return `install-node-pty-runtime-${clean}.sh`;
}
