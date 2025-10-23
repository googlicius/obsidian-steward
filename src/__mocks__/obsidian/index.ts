// Mock implementation for Obsidian API
export class TFile {
  path = '';
  extension = '';
  name = '';

  constructor() {
    // No parameters required
  }
}

export class TFolder {
  path = '';
  name = '';
  children = [];
}

export class WorkspaceLeaf {
  view = null;
  getViewState = jest.fn();
  setViewState = jest.fn();
}

export class MarkdownView {
  navigation = true;
  leaf: WorkspaceLeaf;

  constructor(leaf: WorkspaceLeaf) {
    this.leaf = leaf;
  }

  getViewType = jest.fn();
  getDisplayText = jest.fn();
  onOpen = jest.fn();
  onClose = jest.fn();
}

export class App {
  vault = {
    getAbstractFileByPath: jest.fn(),
    readBinary: jest.fn(),
    read: jest.fn().mockResolvedValue(''),
    createFolder: jest.fn(),
    on: jest.fn().mockReturnValue({ events: [] }),
  };
  workspace = {
    getActiveFile: jest.fn(),
    onLayoutReady: jest.fn().mockImplementation((callback: () => void) => {
      callback();
      return { events: [] };
    }),
  };
  metadataCache = {
    getFirstLinkpathDest: jest.fn(),
    getFileCache: jest.fn(),
  };
}

// Mock functions
export const setIcon = jest.fn();
export const setTooltip = jest.fn();
export const getLanguage = jest.fn().mockReturnValue('en');

// Add any other classes or functions from obsidian that you need to mock
