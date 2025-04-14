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

// This allows TypeScript to recognize the global Jest types
if (typeof global.process === 'undefined') {
	global.process = {} as any;
}

// Mock metadataCache in App
if (typeof window === 'undefined') {
	(global as any).window = {};
}
