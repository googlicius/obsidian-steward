import { CompletionContext, CompletionResult, Completion } from '@codemirror/autocomplete';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { MarkdownView, setIcon, TFile, TFolder } from 'obsidian';
import { COMMAND_PREFIXES } from 'src/constants';
import type StewardPlugin from 'src/main';

const DATASOURCE_FILE_TYPE = 'stw-file';
const DATASOURCE_FOLDER_TYPE = 'stw-folder';
const MAX_RESULTS = 10;

/**
 * Creates a completion source for datasource references (files and folders).
 *
 * Triggers when the user types `@` after a command prefix (e.g., `/ @`, `/search @keyword`).
 * Files and folders matching Obsidian's excluded files config or plugin excluded folders are hidden.
 */
export function createDatasourceCompletionSource(plugin: StewardPlugin) {
  return (context: CompletionContext): CompletionResult | null => {
    const { state, pos } = context;
    const line = state.doc.lineAt(pos);
    const lineText = line.text;

    if (!lineText.startsWith('/')) return null;

    const commandEnd = findCommandEnd(lineText, plugin);
    if (commandEnd === -1) return null;

    const afterCommand = lineText.substring(commandEnd);
    const atIndex = afterCommand.lastIndexOf('@');
    if (atIndex === -1) return null;

    const charBeforeAt = atIndex > 0 ? afterCommand[atIndex - 1] : ' ';
    if (charBeforeAt !== ' ') return null;

    const keyword = afterCommand.substring(atIndex + 1);
    if (keyword.includes(' ')) return null;

    const absoluteAtPos = line.from + commandEnd + atIndex;

    const options: Completion[] = [];
    const lowerKeyword = keyword.toLowerCase();
    const excludePatterns = getExcludePatterns(plugin);

    const mainLeafFile = getMainLeafFile(plugin);
    if (!lowerKeyword && mainLeafFile) {
      options.push(buildFileCompletion(mainLeafFile, 10));
    }

    const allFiles = plugin.app.vault.getFiles();
    for (const file of allFiles) {
      if (options.length >= MAX_RESULTS) break;
      if (mainLeafFile && file.path === mainLeafFile.path) continue;
      if (isPathExcluded(file.path, excludePatterns)) continue;
      if (lowerKeyword && !file.name.toLowerCase().includes(lowerKeyword)) continue;
      options.push(buildFileCompletion(file));
    }

    const allFolders = plugin.app.vault.getAllFolders();
    for (const folder of allFolders) {
      if (options.length >= MAX_RESULTS) break;
      if (isPathExcluded(folder.path, excludePatterns)) continue;
      if (lowerKeyword && !folder.name.toLowerCase().includes(lowerKeyword)) continue;
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

/**
 * Finds the end position of a recognized command prefix in the line text.
 * Returns the index right after the command + trailing space, or -1 if no command is found.
 */
function findCommandEnd(lineText: string, plugin: StewardPlugin): number {
  const matchedBuiltIn = COMMAND_PREFIXES.find(prefix => {
    if (prefix === '/ ') {
      return lineText === '/ ' || lineText.startsWith('/ ');
    }
    return lineText === prefix + ' ' || lineText.startsWith(prefix + ' ');
  });

  if (matchedBuiltIn) {
    return matchedBuiltIn === '/ ' ? 2 : matchedBuiltIn.length + 1;
  }

  const customCommands = plugin.userDefinedCommandService.getCommandNames();
  const matchedCustom = customCommands.find((cmd: string) => {
    const commandPrefix = '/' + cmd;
    return lineText === commandPrefix + ' ' || lineText.startsWith(commandPrefix + ' ');
  });

  if (!matchedCustom) return -1;

  return ('/' + matchedCustom).length + 1;
}

function buildFileCompletion(file: TFile, boost?: number): Completion {
  return {
    label: file.name,
    type: DATASOURCE_FILE_TYPE,
    apply: `{{stw-source type:file,path:${file.path}}} `,
    boost,
  };
}

function buildFolderCompletion(folder: TFolder): Completion {
  return {
    label: folder.name,
    type: DATASOURCE_FOLDER_TYPE,
    apply: `{{stw-source type:folder,path:${folder.path}}} `,
  };
}
