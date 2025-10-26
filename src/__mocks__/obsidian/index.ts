// Note: The obsidian package only contains type definitions, no actual runtime code.
// We use jest.requireActual to get the real js-yaml implementation (which Obsidian uses internally)
const yaml = jest.requireActual('js-yaml');

// Override specific classes with mocks
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

// Mock specific functions
export const setIcon = jest.fn();
export const setTooltip = jest.fn();
export const getLanguage = jest.fn().mockReturnValue('en');

// Export YAML utilities using js-yaml package (which Obsidian uses internally)
export const parseYaml = yaml.load;
export const stringifyYaml = (obj: unknown): string => {
  return yaml.dump(obj, {
    indent: 2,
    lineWidth: -1,
    noRefs: true,
    sortKeys: false,
  });
};
