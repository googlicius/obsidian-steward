// Mock implementation for Obsidian API
export class TFile {
  path = '';
  extension = '';
  name = '';

  constructor() {
    // No parameters required
  }
}

export class App {
  vault = {
    getAbstractFileByPath: jest.fn(),
    readBinary: jest.fn(),
    read: jest.fn().mockResolvedValue(''),
  };
  workspace = {
    getActiveFile: jest.fn(),
  };
}

// Add any other classes or functions from obsidian that you need to mock
