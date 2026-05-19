import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import yaml from 'js-yaml';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const root = path.join(__dirname, '..');
const communityDir = path.join(root, 'community-UDCs');
const outFile = path.join(root, 'src/generated/communityUdcManifest.ts');

const repoPath = p => `community-UDCs/${p}`.replace(/\\/g, '/');

function walk(dir, base = dir) {
  if (!fs.existsSync(dir)) return [];

  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(ent => {
    const full = path.join(dir, ent.name);

    if (ent.isDirectory()) {
      return walk(full, base);
    }

    return ent.isFile() && ent.name.endsWith('.md')
      ? [path.relative(base, full).replace(/\\/g, '/')]
      : [];
  });
}

function parseFrontmatter(raw) {
  const match = raw.match(/^---\n([\s\S]*?)\n---\n?/);

  if (!match) {
    return { frontmatter: {}, body: raw };
  }

  try {
    return {
      frontmatter: yaml.load(match[1]) ?? {},
      body: raw.slice(match[0].length),
    };
  } catch {
    return { frontmatter: {}, body: raw };
  }
}

function extractYamlBlocks(body) {
  return [...body.matchAll(/```ya?ml\s*\n([\s\S]*?)\n```/gi)].map(m => m[1].trim());
}

const relPaths = walk(communityDir).sort();

const folderFiles = Object.groupBy(relPaths.map(repoPath), p =>
  path.dirname(p.replace(/^community-UDCs\//, ''))
);

const entries = relPaths.flatMap(rel => {
  const raw = fs.readFileSync(path.join(communityDir, rel), 'utf8');

  const { frontmatter, body } = parseFrontmatter(raw);

  const version = Number.isFinite(frontmatter.version) ? frontmatter.version : 1;

  const updateInstructions = frontmatter.update_instructions;
  const updateInstructionRaw =
    updateInstructions?.[version] ?? updateInstructions?.[String(version)];
  const updateInstruction =
    typeof updateInstructionRaw === 'string' && updateInstructionRaw.trim().length > 0
      ? updateInstructionRaw.trim()
      : undefined;

  const relDir = path.dirname(rel) === '.' ? '' : path.dirname(rel).replace(/\\/g, '/');

  const files = relDir ? [...(folderFiles[relDir] ?? [])].sort() : [repoPath(rel)];

  const baseName = path.basename(rel);
  const displayName = baseName.replace(/\.md$/i, '');

  return extractYamlBlocks(body).flatMap(block => {
    try {
      const data = yaml.load(block);

      if (!data || typeof data !== 'object' || Array.isArray(data)) {
        return [];
      }

      const commandName = data.command_name?.trim();

      if (!commandName) {
        return [];
      }

      return [
        {
          commandName,
          displayName,
          description: data.description ?? '',
          version,
          files,
          destinationFolder: relDir || undefined,
          sourceFile: repoPath(rel),
          mainVAULT_FILENAME: baseName,
          ...(updateInstruction && { updateInstruction }),
        },
      ];
    } catch {
      return [];
    }
  });
});

entries.sort((a, b) => a.commandName.localeCompare(b.commandName));

const ts = `/* eslint-disable */
/* auto-generated — do not edit */

export interface CommunityUdcEntry {
  commandName: string;
  displayName: string;
  description: string;
  version: number;
  files: string[];
  destinationFolder?: string;
  sourceFile: string;
  mainVAULT_FILENAME: string;
  updateInstruction?: string;
}

export const COMMUNITY_UDC_MANIFEST: CommunityUdcEntry[] = ${JSON.stringify(entries, null, 2)};
`;

fs.mkdirSync(path.dirname(outFile), { recursive: true });
fs.writeFileSync(outFile, ts);

console.log(`Wrote ${entries.length} entries`);
