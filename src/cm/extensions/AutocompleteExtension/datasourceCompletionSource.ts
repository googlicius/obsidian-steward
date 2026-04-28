import { CompletionContext, CompletionResult, Completion } from '@codemirror/autocomplete';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { MarkdownView, setIcon, TFile, TFolder } from 'obsidian';
import { TWO_SPACES_PREFIX } from 'src/constants';
import type StewardPlugin from 'src/main';
import { decodePath, encodePath } from 'src/utils/pathUtils';

const DATASOURCE_FILE_TYPE = 'stw-file';
const DATASOURCE_FOLDER_TYPE = 'stw-folder';
const MAX_RESULTS = 10;

/**
 * Creates a completion source for datasource references (files and folders).
 *
 * Triggers when the user types `@` after a command prefix (e.g., `/ @`, `/search @keyword`).
 * Inserts a short `@vault/path` reference (files and folders); line selections use `{{stw-source ...}}`.
 * Files and folders matching Obsidian's excluded files config or plugin excluded folders are hidden.
 */
export function createDatasourceCompletionSource(plugin: StewardPlugin) {
  return (context: CompletionContext): CompletionResult | null => {
    const { state, pos } = context;
    const line = state.doc.lineAt(pos);
    const lineText = line.text;

    const inputPrefix = plugin.commandInputService.getInputPrefix(line, state.doc);
    if (!inputPrefix) return null;

    const contentStart = lineText.startsWith(TWO_SPACES_PREFIX)
      ? TWO_SPACES_PREFIX.length
      : lineText.indexOf(' ') + 1;

    const lineContent = lineText.substring(contentStart);
    const atIndex = lineContent.lastIndexOf('@');
    if (atIndex === -1) return null;

    const charBeforeAt = atIndex > 0 ? lineContent[atIndex - 1] : ' ';
    if (charBeforeAt !== ' ') return null;

    const keyword = lineContent.substring(atIndex + 1);

    const absoluteAtPos = line.from + contentStart + atIndex;

    const lastSlashIndex = keyword.lastIndexOf('/');
    const folderPath = lastSlashIndex === -1 ? '' : keyword.substring(0, lastSlashIndex);
    const nameFilter = lastSlashIndex === -1 ? keyword : keyword.substring(lastSlashIndex + 1);
    const lowerNameFilter = nameFilter.toLowerCase();

    const options: Completion[] = [];
    const excludePatterns = getExcludePatterns(plugin);

    const mainLeafFile = getMainLeafFile(plugin);
    if (!folderPath && !lowerNameFilter && mainLeafFile) {
      options.push(buildFileCompletion(mainLeafFile, 10));
    }

    const resolved = resolveDatasources({ plugin, folderPath });

    for (const file of resolved.files) {
      if (options.length >= MAX_RESULTS) break;
      if (mainLeafFile && file.path === mainLeafFile.path) continue;
      if (isPathExcluded(file.path, excludePatterns)) continue;
      if (lowerNameFilter && !file.name.toLowerCase().includes(lowerNameFilter)) continue;
      options.push(buildFileCompletion(file));
    }

    for (const folder of resolved.folders) {
      if (options.length >= MAX_RESULTS) break;
      if (isPathExcluded(folder.path, excludePatterns)) continue;
      if (lowerNameFilter && !folder.name.toLowerCase().includes(lowerNameFilter)) continue;
      options.push(buildFolderCompletion(folder));
    }

    if (options.length === 0) return null;

    return {
      from: absoluteAtPos,
      options,
      filter: false,
    };
  };
}

/**
 * Custom render function that prepends a file or folder icon (via Obsidian's setIcon)
 * to each datasource completion item. Non-datasource items are left unchanged.
 */
export function datasourceIconRenderer(
  completion: Completion,
  _state: EditorState,
  _view: EditorView
): Node | null {
  if (completion.type !== DATASOURCE_FILE_TYPE && completion.type !== DATASOURCE_FOLDER_TYPE) {
    return null;
  }

  const iconEl = document.createElement('span');
  iconEl.className = 'stw-autocomplete-icon';
  const iconName = completion.type === DATASOURCE_FILE_TYPE ? 'file-text' : 'folder';
  setIcon(iconEl, iconName);

  return iconEl;
}

/**
 * Resolves candidate files and folders for datasource completion.
 *
 * - When `folderPath` is empty (root, default), returns all files and folders in the vault.
 * - When `folderPath` points to an existing folder, returns that folder's direct children only.
 * - Accepts both raw (`My folder`) and encoded (`My%20folder`) segments for robustness.
 */
function resolveDatasources(params: { plugin: StewardPlugin; folderPath: string }): {
  files: TFile[];
  folders: TFolder[];
} {
  const plugin = params.plugin;
  const folderPath = params.folderPath;

  if (!folderPath) {
    return {
      files: plugin.app.vault.getFiles(),
      folders: plugin.app.vault.getAllFolders(),
    };
  }

  const folder =
    plugin.app.vault.getFolderByPath(folderPath) ??
    plugin.app.vault.getFolderByPath(decodePath(folderPath));

  if (!folder) {
    return { files: [], folders: [] };
  }

  const files: TFile[] = [];
  const folders: TFolder[] = [];
  for (const child of folder.children) {
    if (child instanceof TFile) {
      files.push(child);
      continue;
    }
    if (child instanceof TFolder) {
      folders.push(child);
    }
  }
  return { files, folders };
}

/**
 * Gets the active file from the main editor leaf (not the chat side panel).
 */
function getMainLeafFile(plugin: StewardPlugin): TFile | null {
  const mainLeaf = plugin.app.workspace.getMostRecentLeaf();
  if (!mainLeaf) return null;

  const view = mainLeaf.view;
  if (view instanceof MarkdownView && view.file) {
    return view.file;
  }

  return null;
}

/**
 * Collects all exclude patterns from both Obsidian's "Excluded files" config
 * and the plugin's own excludedFolders setting.
 */
function getExcludePatterns(plugin: StewardPlugin): string[] {
  // @ts-ignore - Accessing internal Obsidian API
  const userIgnoreFilters: string[] = plugin.app.vault.config?.userIgnoreFilters || [];
  const pluginExcluded = plugin.settings.excludedFolders || [];
  return [...userIgnoreFilters, ...pluginExcluded];
}

/**
 * Checks whether a file/folder path matches any of the exclude patterns.
 * Supports exact prefix matching (folder names) and trailing-slash folder patterns.
 */
function isPathExcluded(path: string, patterns: string[]): boolean {
  for (const pattern of patterns) {
    const normalized = pattern.endsWith('/') ? pattern.slice(0, -1) : pattern;
    if (path === normalized || path.startsWith(normalized + '/')) {
      return true;
    }
  }
  return false;
}

function buildFileCompletion(file: TFile, boost?: number): Completion {
  return {
    label: file.path,
    type: DATASOURCE_FILE_TYPE,
    apply: `@${encodePath(file.path)} `,
    boost,
  };
}

function buildFolderCompletion(folder: TFolder): Completion {
  return {
    label: `${folder.path}/`,
    type: DATASOURCE_FOLDER_TYPE,
    apply: `@${encodePath(folder.path)}/ `,
  };
}
