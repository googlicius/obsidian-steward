// Mock types for Obsidian
export {};

// Node test environment has no `window`; plugin code uses window timer APIs.
/* eslint-disable obsidianmd/no-global-this -- Jest Node env window polyfill */
if (typeof globalThis.window === 'undefined') {
  (globalThis as unknown as { window: Window & typeof globalThis }).window =
    globalThis as unknown as Window & typeof globalThis;
}
/* eslint-enable obsidianmd/no-global-this */

// Extend Jest matchers using module augmentation
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace jest {
    interface Matchers<R> {
      toBeWithinRange(a: number, b: number): R;
    }
  }
}

const i18nBundleMock = {
  i18next: {
    t: jest.fn().mockImplementation((key: string) => `translated_${key}`),
    language: 'en',
    changeLanguage: jest.fn(),
    init: jest.fn(),
    getFixedT: jest.fn().mockImplementation(() => (key: string) => `translated_${key}`),
  },
  getTranslation: jest.fn().mockImplementation(() => {
    return (key: string) => `translated_${key}`;
  }),
  updateLanguageAttribute: jest.fn(),
};

jest.mock('src/utils/bundledInternals', () => ({
  ensureBundledInternalsLoadedSync: jest.fn(() => ({
    i18n: i18nBundleMock,
  })),
  getBundledInternal: jest.fn((key: string) => {
    if (key === 'i18n') {
      return i18nBundleMock;
    }
    throw new Error(`Unexpected getBundledInternal key in test: ${String(key)}`);
  }),
}));

// Mock logger
jest.mock('./utils/logger', () => ({
  logger: {
    log: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
  },
}));
