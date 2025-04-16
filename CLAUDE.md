# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands
- Build: `npm run build`
- Dev mode: `npm run dev`
- Run tests: `npm run test`
- Run single test: `npm run test -- -t "test name"`
- Watch tests: `npm run test:watch`
- Format code: `npm run format`
- Check formatting: `npm run format:check`

## Code Style Guidelines
- Use tabs (width: 2) for indentation
- Maximum line length: 100 characters
- Use semicolons and trailing commas (ES5 style)
- Use single quotes for strings
- Use TypeScript with strict null checks
- Arrow functions: avoid parentheses around single parameters
- Error handling: Use try/catch with specific error messages
- Naming: Use camelCase for variables/functions, PascalCase for classes/interfaces
- Documentation: Use JSDoc-style comments for functions and classes
- Imports: Group imports by external packages first, then internal modules
- State management: Use async/await for asynchronous operations