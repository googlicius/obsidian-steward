import type { App } from 'obsidian';
import { TFile, normalizePath } from 'obsidian';
import type StewardPlugin from 'src/main';
import type { EmbedView } from './EmbedView';
import { getBundledInternal } from 'src/utils/bundledInternals';
import { COMMUNITY_UDC_MANIFEST, type CommunityUdcEntry } from 'src/generated/communityUdcManifest';
import type { CommunityCommandUpdateGuideline } from 'src/types/CommunityCommandUpdateGuideline';
import { GITHUB_RAW_BASE_URL } from 'src/constants';

const { i18next } = getBundledInternal('i18n');

/** Raw GitHub URL for a path under the repo root (e.g. `community-UDCs/Shells.md`). */
function communityUdcRawFileUrl(sourceFile: string): string {
  return new URL(sourceFile, `${GITHUB_RAW_BASE_URL}/`).href;
}

function normalizeMarkdownTableCell(value: string): string {
  return value.replace(/\r?\n/g, ' ');
}

function formatMarkdownTable(headers: string[], rows: string[][]): string {
  if (rows.length === 0) {
    return '';
  }
  const lines: string[] = [];
  lines.push(`| ${headers.map(normalizeMarkdownTableCell).join(' | ')} |`);
  lines.push(`| ${headers.map(() => '---').join(' | ')} |`);
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    lines.push(`| ${row.map(normalizeMarkdownTableCell).join(' | ')} |`);
  }
  return `${lines.join('\n')}\n`;
}

/** One table row per community note (`sourceFile`); each note may define multiple commands. */
function groupManifestBySourceFile(entries: CommunityUdcEntry[]): CommunityUdcEntry[][] {
  const bySource = new Map<string, CommunityUdcEntry[]>();
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const key = entry.sourceFile;
    const bucket = bySource.get(key);
    if (bucket) {
      bucket.push(entry);
    } else {
      bySource.set(key, [entry]);
    }
  }
  const groups = Array.from(bySource.values());
  for (let i = 0; i < groups.length; i++) {
    const g = groups[i];
    g.sort((a, b) => a.commandName.localeCompare(b.commandName));
  }
  groups.sort((a, b) => a[0].commandName.localeCompare(b[0].commandName));
  return groups;
}

export class EmbedCommandsView implements EmbedView {
  constructor(
    private app: App,
    private plugin: StewardPlugin
  ) {}

  async buildContent(): Promise<string> {
    if (COMMUNITY_UDC_MANIFEST.length === 0) {
      return i18next.t('community.noCommands');
    }

    const t = i18next.t.bind(i18next);
    const title = `### ${t('community.commandsTitle')}\n\n`;
    const groups = groupManifestBySourceFile(COMMUNITY_UDC_MANIFEST);
    const rows: string[][] = [];
    for (let i = 0; i < groups.length; i++) {
      rows.push(this.buildRowForSourceGroup(groups[i]));
    }

    const table = formatMarkdownTable(
      [
        t('common.helpTableCommand'),
        t('community.helpTableYourVersion'),
        t('community.helpTableLatestVersion'),
        t('community.helpTableAction'),
      ],
      rows
    );

    return `${title}${table}`;
  }

  /**
   * Uses first entry as install payload; every entry in the group shares the same note-level
   * fields (`files`, `version`, `mainVAULT_FILENAME`, …). `commandName` is reference-only for update-command.
   */
  private buildRowForSourceGroup(group: CommunityUdcEntry[]): string[] {
    const rep = group[0];
    const commandBlocks: string[] = [];
    for (let i = 0; i < group.length; i++) {
      const e = group[i];
      const desc = e.description.trim().length > 0 ? e.description.trim() : '—';
      commandBlocks.push(`\`/${e.commandName}\` — ${desc}`);
    }

    const t = i18next.t.bind(i18next);
    const mainPath = this.getMainVaultPath(rep);
    const existing = this.app.vault.getFileByPath(mainPath);
    let yourVersion = '—';
    let statusLabel = t('community.notInstalled');
    let actionLabel = t('community.install');

    if (existing instanceof TFile) {
      const installedVer = this.readInstalledBundleVersion(existing);
      yourVersion = installedVer > 0 ? String(installedVer) : '—';
      if (installedVer >= rep.version && installedVer > 0) {
        statusLabel = t('community.installed');
        actionLabel = t('community.reinstall');
      } else {
        statusLabel = t('community.updateAvailable');
        actionLabel = t('community.update');
      }
    }

    const guideline: CommunityCommandUpdateGuideline = {
      commandName: rep.commandName,
      files: rep.files,
      destinationFolder: rep.destinationFolder,
      version: rep.version,
      mainVAULT_FILENAME: rep.mainVAULT_FILENAME,
    };
    const encoded = encodeURIComponent(JSON.stringify(guideline));
    const actionHtml = `<a class="stw-run" data-command="update-command" data-query="${encoded}">${actionLabel}</a>`;
    const rawUrl = communityUdcRawFileUrl(rep.sourceFile);
    const viewLabel = t('common.view');
    const viewHtml = `<a href="${rawUrl}" class="stw-no-underline" target="_blank" rel="noopener noreferrer">${viewLabel}</a>`;

    return [
      commandBlocks.join('<br>'),
      yourVersion,
      String(rep.version),
      `${statusLabel}<br>${actionHtml} · ${viewHtml}`,
    ];
  }

  private getMainVaultPath(entry: CommunityUdcEntry): string {
    const steward = this.plugin.settings.stewardFolder;
    const parts = [steward, 'Commands'];
    if (entry.destinationFolder && entry.destinationFolder.length > 0) {
      parts.push(entry.destinationFolder);
    }
    parts.push(entry.mainVAULT_FILENAME);
    return normalizePath(parts.join('/'));
  }

  private readInstalledBundleVersion(file: TFile): number {
    try {
      const cache = this.app.metadataCache.getFileCache(file);
      const fm = cache?.frontmatter ?? {};
      const raw = fm.version;
      if (typeof raw === 'number' && Number.isFinite(raw)) {
        return raw;
      }
      if (typeof raw === 'string' && /^\d+$/.test(raw.trim())) {
        return parseInt(raw.trim(), 10);
      }
    } catch {
      return 0;
    }
    return 0;
  }

  async write(content: string): Promise<void> {
    const commandsListPath = `${this.plugin.settings.stewardFolder}/Commands.md`;
    const existingFile = this.app.vault.getFileByPath(commandsListPath);

    if (existingFile) {
      await this.app.vault.modify(existingFile, content);
      return;
    }

    await this.app.vault.create(commandsListPath, content);
  }

  async replaceHostWikilink(hostFile: TFile): Promise<void> {
    await this.app.vault.modify(hostFile, '\n![[Commands]]\n');
  }
}
