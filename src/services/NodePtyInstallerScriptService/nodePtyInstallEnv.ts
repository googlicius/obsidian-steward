import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import { compareSemverVersions } from 'src/utils/compareSemver';
import abiRegistryJson from '../../constants/nodeAbiRegistry.json';

type AbiRegistryEntry = {
  runtime: string;
  target: string;
  abi: string | number;
};

function abiRegistryAsArray(raw: unknown): AbiRegistryEntry[] {
  if (Array.isArray(raw)) {
    return raw;
  }
  if (
    raw &&
    typeof raw === 'object' &&
    'default' in raw &&
    Array.isArray((raw as { default: unknown }).default)
  ) {
    return (raw as { default: AbiRegistryEntry[] }).default;
  }
  return [];
}

function loadAbiRegistry(): AbiRegistryEntry[] {
  const fromBundler = abiRegistryAsArray(abiRegistryJson);
  if (fromBundler.length > 0) {
    return fromBundler;
  }
  const candidates = [
    path.join(__dirname, '../../constants/nodeAbiRegistry.json'),
    path.join(process.cwd(), 'src/constants/nodeAbiRegistry.json'),
  ];
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) {
        return JSON.parse(fs.readFileSync(p, 'utf8')) as AbiRegistryEntry[];
      }
    } catch {
      /* try next */
    }
  }
  return [];
}

const NODE_ENTRIES = loadAbiRegistry().filter(e => e.runtime === 'node');

function baseSemver(s: string): string {
  return s.replace(/^v/i, '').split('-')[0];
}

/**
 * Maps Electron's embedded `process.versions.node` (e.g. "20.18.1") to the **stock Node**
 * NODE_MODULE_VERSION used in `node-v*` prebuild filenames — not `process.versions.modules`
 * in Electron (that value is for `electron-v*` and often has no published prebuild yet).
 */
export function getNodePrebuildModulesFromEmbeddedNodeVersion(nodeVersion: string): string | null {
  const target = baseSemver(nodeVersion.trim());
  if (!target) {
    return null;
  }

  let bestAbi: string | null = null;
  let bestTarget: string | null = null;

  for (const item of NODE_ENTRIES) {
    const t = baseSemver(item.target);
    if (compareSemverVersions(t, target) > 0) {
      continue;
    }
    if (!bestTarget || compareSemverVersions(t, bestTarget) > 0) {
      bestAbi = String(item.abi);
      bestTarget = t;
    }
  }

  return bestAbi;
}

/**
 * Best-effort musl detection on Linux (matches typical node-prebuild platform tokens).
 */
export function detectLinuxMuslSync(): boolean {
  if (process.platform !== 'linux') {
    return false;
  }
  try {
    const out = execSync('ldd --version 2>&1', { encoding: 'utf8', timeout: 3000 });
    return out.toLowerCase().includes('musl');
  } catch {
    return false;
  }
}

/**
 * Target OS-ARCH token for @homebridge/node-pty-prebuilt-multiarch release tarballs,
 * for the **current** Obsidian/Electron process.
 */
export function getNodePtyPrebuiltOsArchForCurrentProcess(): string {
  const platform = process.platform;
  const arch = process.arch;

  if (platform === 'darwin') {
    return arch === 'arm64' ? 'darwin-arm64' : 'darwin-x64';
  }

  if (platform === 'win32') {
    return arch === 'ia32' ? 'win32-ia32' : 'win32-x64';
  }

  if (platform === 'linux') {
    const musl = detectLinuxMuslSync();
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
