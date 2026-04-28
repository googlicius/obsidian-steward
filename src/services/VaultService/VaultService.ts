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

  async resolvePathExistence(path: string): Promise<PathExistenceResult> {
    if (isHiddenPath(path)) {
      return this.resolveHiddenPathViaAdapter(path);
    }
    return this.resolveViaVaultApi(path);
  }

  private async resolveViaVaultApi(path: string): Promise<PathExistenceResult> {
    const vault = this.plugin.app.vault;
    const abstractFile =
      vault.getAbstractFileByPath(path) ||
      (await this.plugin.mediaTools.findFileByNameOrPath(path));

    if (abstractFile) {
      return {
        path: abstractFile.path,
        exists: true,
        abstractFile,
        type:
          abstractFile instanceof TFile
            ? 'file'
            : abstractFile instanceof TFolder
              ? 'folder'
              : null,
      };
    }

    return {
      path,
      exists: false,
      type: null,
    };
  }

  private async resolveHiddenPathViaAdapter(path: string): Promise<PathExistenceResult> {
    const { adapter } = this.plugin.app.vault;

    if (await adapter.exists(path)) {
      const st = await adapter.stat(path);
      if (st) {
        return {
          path,
          exists: true,
          type: st.type,
        };
      }
    }

    return {
      path,
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
