import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import yaml from 'js-yaml';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const root = path.join(__dirname, '..');
const skillsDir = path.join(root, 'standard-skills');
const outFile = path.join(root, 'src/services/SkillService/constants.ts');
const toolNamesFile = path.join(root, 'src/solutions/commands/toolNames.ts');

function loadValidToolNames() {
  const source = fs.readFileSync(toolNamesFile, 'utf8');
  const enumBlock = source.match(/export enum ToolName \{([\s\S]*?)\}/);

  if (!enumBlock) {
    throw new Error('Could not parse ToolName enum from toolNames.ts');
  }

  const names = new Set();
  const re = /=\s*'([^']+)'/g;
  let match;

  while ((match = re.exec(enumBlock[1])) !== null) {
    names.add(match[1]);
  }

  return names;
}

const VALID_TOOL_NAMES = loadValidToolNames();

function walkSkillFiles(dir, base = dir) {
  if (!fs.existsSync(dir)) {
    return [];
  }

  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(ent => {
    const full = path.join(dir, ent.name);

    if (ent.isDirectory()) {
      return walkSkillFiles(full, base);
    }

    return ent.isFile() && ent.name.toLowerCase() === 'skill.md'
      ? [path.relative(base, full).replace(/\\/g, '/')]
      : [];
  });
}

function parseFrontmatter(raw) {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);

  if (!match) {
    throw new Error('Missing YAML frontmatter');
  }

  const frontmatter = yaml.load(match[1]) ?? {};
  const body = raw.slice(match[0].length);

  return { frontmatter, body };
}

function requireString(value, field, sourceFile) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${sourceFile}: frontmatter.${field} must be a non-empty string`);
  }

  return value.trim();
}

const relPaths = walkSkillFiles(skillsDir).sort();

const skills = relPaths.map(rel => {
  const sourceFile = `standard-skills/${rel}`.replace(/\\/g, '/');
  const raw = fs.readFileSync(path.join(skillsDir, rel), 'utf8');
  const { frontmatter, body } = parseFrontmatter(raw);

  const name = requireString(frontmatter.name, 'name', sourceFile);
  const description = requireString(frontmatter.description, 'description', sourceFile);
  const version = Number.isFinite(frontmatter.version) ? frontmatter.version : 1;

  let tools;
  if (frontmatter.tools !== undefined) {
    if (!Array.isArray(frontmatter.tools)) {
      throw new Error(`${sourceFile}: frontmatter.tools must be an array`);
    }

    tools = frontmatter.tools.map((tool, index) => {
      if (typeof tool !== 'string' || tool.trim().length === 0) {
        throw new Error(`${sourceFile}: frontmatter.tools[${index}] must be a non-empty string`);
      }

      const trimmed = tool.trim();
      if (!VALID_TOOL_NAMES.has(trimmed)) {
        throw new Error(`${sourceFile}: unknown tool "${trimmed}" in frontmatter.tools`);
      }

      return trimmed;
    });
  }

  const relDir = path.dirname(rel).replace(/\\/g, '/');
  const folder = relDir === '.' ? undefined : relDir;

  const entry = {
    name,
    description,
    version,
    content: body.replace(/^\n/, ''),
    ...(folder && folder !== name && { folder }),
    ...(tools && tools.length > 0 && { tools }),
  };

  return entry;
});

skills.sort((a, b) => a.name.localeCompare(b.name));

const ts = `/* eslint-disable */
/* auto-generated — do not edit */

export interface StandardSkill {
  name: string;
  description: string;
  content: string;
  version: number;
  /** Path under Skills/ where SKILL.md is written. Defaults to \`name\`. */
  folder?: string;
  /** When set, the skill appears in the catalog only while these tools are active. */
  tools?: string[];
}

export const STANDARD_SKILLS: StandardSkill[] = ${JSON.stringify(skills, null, 2)};
`;

fs.mkdirSync(path.dirname(outFile), { recursive: true });
fs.writeFileSync(outFile, ts);

console.log(`Wrote ${skills.length} standard skills to ${path.relative(root, outFile)}`);
