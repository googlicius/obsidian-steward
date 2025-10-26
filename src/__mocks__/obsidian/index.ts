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

export class App {
  vault = {
    getAbstractFileByPath: jest.fn(),
    readBinary: jest.fn(),
    read: jest.fn().mockResolvedValue(''),
    cachedRead: jest.fn().mockResolvedValue(''),
    modify: jest.fn(),
    process: jest.fn(),
    config: {
      attachmentFolderPath: 'attachments',
    },
  };
  workspace = {
    getActiveFile: jest.fn(),
    activeEditor: {
      editor: {},
    },
  };
  metadataCache = {
    getFileCache: jest.fn(),
    getFirstLinkpathDest: jest.fn(),
  };
}

// Mock specific functions
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
