// Mock types for Obsidian
export {};

// Extend Jest matchers using module augmentation
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace jest {
    interface Matchers<R> {
      toBeWithinRange(a: number, b: number): R;
    }
  }
}

// Global mock for getObsidianLanguage
jest.mock('./utils/getObsidianLanguage', () => ({
  getObsidianLanguage: jest.fn().mockReturnValue('en'),
}));

// Global mock for i18n module
jest.mock('./i18n', () => ({
  getTranslation: jest.fn().mockImplementation(() => {
    return (key: string) => `translated_${key}`;
  }),
  __esModule: true,
  default: {
    t: jest.fn().mockImplementation((key: string) => `translated_${key}`),
    language: 'en',
    changeLanguage: jest.fn(),
  },
}));

// Mock logger
jest.mock('./utils/logger', () => ({
  logger: {
    log: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
  },
}));
