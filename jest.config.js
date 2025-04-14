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
	},
	testPathIgnorePatterns: ['/node_modules/', '/.obsidian/'],
	setupFilesAfterEnv: ['<rootDir>/src/jest-setup.ts'],
};
