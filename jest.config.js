module.exports = {
	preset: 'ts-jest',
	testEnvironment: 'node',
	roots: ['<rootDir>/src/'],
	transform: {
		'^.+\\.tsx?$': 'ts-jest',
	},
	testRegex: '(/__tests__/.*|(\\.|/)(test|spec))\\.[jt]sx?$',
	moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'node'],
	moduleNameMapper: {
		// Add any module name mappings if needed
		'^obsidian$': '<rootDir>/src/__mocks__/obsidian',
		'^src/(.*)$': '<rootDir>/src/$1',
	},
	testPathIgnorePatterns: ['/node_modules/', '/.obsidian/'],
	setupFilesAfterEnv: ['<rootDir>/src/jest-setup.ts'],
};
