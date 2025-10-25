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

// Mock functions
export const getLanguage = jest.fn().mockReturnValue('en');
