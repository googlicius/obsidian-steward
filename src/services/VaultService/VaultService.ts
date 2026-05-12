import { TAbstractFile, TFile, TFolder } from 'obsidian';
import type StewardPlugin from 'src/main';
import { isHiddenPath } from 'src/utils/pathUtils';

export type PathExistenceResult = {
  path: string;
  exists: boolean;
  type: 'file' | 'folder' | null;
  /** File or folder - available only for visible paths */
  abstractFile?: TAbstractFile;
};

/**
 * Vault path resolution: non-hidden paths use the vault file index and media tools;
 * dot-prefixed (hidden) paths use the vault adapter because they are omitted from the abstract tree.
 */
export class VaultService {
  static instance: VaultService;

  private constructor(private plugin: StewardPlugin) {}

  static getInstance(plugin?: StewardPlugin): VaultService {
    if (plugin) {
      VaultService.instance = new VaultService(plugin);
      return VaultService.instance;
    }
    if (!VaultService.instance) {
      throw new Error('VaultService is not initialized');
    }
    return VaultService.instance;
  }

  /**
   * @param pathOrName Vault-relative path (e.g. `folder/note.md`) or a file/folder name alone.
   */
  async resolvePathExistence(pathOrName: string): Promise<PathExistenceResult> {
    if (isHiddenPath(pathOrName)) {
      return this.resolveHiddenPathViaAdapter(pathOrName);
    }
    return this.resolveViaVaultApi(pathOrName);
  }

  private normalizeVaultRelativePath(p: string): string {
    return p.replace(/\\/g, '/');
  }

  /**
   * {@link MediaTools.findFileByNameOrPath} may return a similar but non-matching file; only treat
   * as a hit when the vault path or leaf name equals the query.
   */
  private resolvedMatchesPathOrName(
    normalizedPathOrName: string,
    abstractFile: TAbstractFile
  ): boolean {
    const resolved = this.normalizeVaultRelativePath(abstractFile.path);
    if (resolved === normalizedPathOrName) {
      return true;
    }
    if (!normalizedPathOrName.includes('/')) {
      return abstractFile instanceof TFile && abstractFile.name === normalizedPathOrName;
    }
    return false;
  }

  private async resolveViaVaultApi(pathOrName: string): Promise<PathExistenceResult> {
    const vault = this.plugin.app.vault;
    const normalizedPathOrName = this.normalizeVaultRelativePath(pathOrName);

    const direct = vault.getAbstractFileByPath(normalizedPathOrName);
    if (direct) {
      return {
        path: direct.path,
        exists: true,
        abstractFile: direct,
        type:
          direct instanceof TFile
            ? 'file'
            : direct instanceof TFolder
              ? 'folder'
              : null,
      };
    }

    const fromSearch = await this.plugin.mediaTools.findFileByNameOrPath(normalizedPathOrName);
    if (fromSearch && this.resolvedMatchesPathOrName(normalizedPathOrName, fromSearch)) {
      return {
        path: fromSearch.path,
        exists: true,
        abstractFile: fromSearch,
        type: 'file',
      };
    }

    return {
      path: pathOrName,
      exists: false,
      type: null,
    };
  }

  private async resolveHiddenPathViaAdapter(pathOrName: string): Promise<PathExistenceResult> {
    const { adapter } = this.plugin.app.vault;

    if (await adapter.exists(pathOrName)) {
      const st = await adapter.stat(pathOrName);
      if (st) {
        return {
          path: pathOrName,
          exists: true,
          type: st.type,
        };
      }
    }

    return {
      path: pathOrName,
      exists: false,
      type: null,
    };
  }

  /**
   * Rename or move a file or folder. Same shape as {@link FileManager.renameFile} (first arg is a
   * {@link TAbstractFile}) or {@link DataAdapter.rename} (both args are vault path strings).
   */
  async rename(from: TAbstractFile, newPath: string): Promise<void>;
  async rename(fromPath: string, newPath: string): Promise<void>;
  async rename(from: TAbstractFile | string, newPath: string): Promise<void> {
    if (typeof from !== 'string') {
      await this.plugin.app.fileManager.renameFile(from, newPath);
      return;
    }

    const fromResolved = await this.resolvePathExistence(from);
    if (!fromResolved.exists || (fromResolved.type !== 'file' && fromResolved.type !== 'folder')) {
      throw new Error(`Cannot rename: source is not a file or folder, or does not exist: ${from}`);
    }
    if (fromResolved.abstractFile) {
      await this.plugin.app.fileManager.renameFile(fromResolved.abstractFile, newPath);
      return;
    }
    await this.plugin.app.vault.adapter.rename(fromResolved.path, newPath);
  }

  /**
   * Permanently delete a file or folder (not OS/vault trash). Same idea as {@link Vault#delete}:
   * pass a {@link TAbstractFile}, or a vault path string when the item may be hidden from the index.
   */
  async delete(target: TAbstractFile): Promise<void>;
  async delete(path: string): Promise<void>;
  async delete(target: TAbstractFile | string): Promise<void> {
    if (typeof target !== 'string') {
      if (target instanceof TFolder) {
        await this.plugin.app.vault.delete(target, true);
      } else {
        await this.plugin.app.vault.delete(target);
      }
      return;
    }

    const resolved = await this.resolvePathExistence(target);
    if (!resolved.exists || !resolved.type) {
      throw new Error(`Cannot delete: path does not exist: ${target}`);
    }
    if (resolved.abstractFile) {
      if (resolved.abstractFile instanceof TFolder) {
        await this.plugin.app.vault.delete(resolved.abstractFile, true);
      } else {
        await this.plugin.app.vault.delete(resolved.abstractFile);
      }
      return;
    }

    const { adapter } = this.plugin.app.vault;
    if (resolved.type === 'file') {
      await adapter.remove(resolved.path);
    } else {
      await adapter.rmdir(resolved.path, true);
    }
  }

  /**
   * Move a file or folder into Obsidian’s trash (as in {@link FileManager.trashFile}). For items
   * only on disk (hidden from the index), uses {@link DataAdapter.trashSystem} and falls back to
   * {@link DataAdapter.trashLocal}.
   */
  async trashFile(target: TAbstractFile): Promise<void>;
  async trashFile(path: string): Promise<void>;
  async trashFile(target: TAbstractFile | string): Promise<void> {
    if (typeof target !== 'string') {
      await this.plugin.app.fileManager.trashFile(target);
      return;
    }

    const resolved = await this.resolvePathExistence(target);
    if (!resolved.exists || (resolved.type !== 'file' && resolved.type !== 'folder')) {
      throw new Error(`Cannot trash: path is not a file or folder, or does not exist: ${target}`);
    }
    if (resolved.abstractFile) {
      await this.plugin.app.fileManager.trashFile(resolved.abstractFile);
      return;
    }
    const { adapter } = this.plugin.app.vault;
    const movedToSystem = await adapter.trashSystem(resolved.path);
    if (!movedToSystem) {
      await adapter.trashLocal(resolved.path);
    }
  }
}
