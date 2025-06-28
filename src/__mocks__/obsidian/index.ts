// Mock implementation for Obsidian API
export class TFile {
  path: string;
  extension: string;

  constructor(path: string, extension: string) {
    this.path = path;
    this.extension = extension;
  }
}

export class App {
  vault = {
    getAbstractFileByPath: jest.fn(),
    readBinary: jest.fn(),
  };
}

// Add any other classes or functions from obsidian that you need to mock
