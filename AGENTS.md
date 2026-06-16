# AGENTS.md

## Cursor Cloud specific instructions

This is an **Obsidian plugin** (client-side only, no backend server). It builds a `main.js` bundle + `styles.css` via esbuild and PostCSS.

### Key commands

All standard commands are defined in `package.json` scripts:

| Task         | Command                                              |
| ------------ | ---------------------------------------------------- |
| Install deps | `npm install` (runs `patch-package` via postinstall) |
| Build        | `npm run build`                                      |
| Test         | `npm test`                                           |
| Format check | `npm run format:check`                               |
| Dev (watch)  | `npm run dev`                                        |

### Notes

- CI uses Node 18, but the codebase builds and tests fine on Node 22.
- `npm install` automatically applies `patches/ai+6.0.5.patch` via `patch-package` postinstall hook.
- There are no environment variables, `.env` files, or external services required. API keys are configured through the Obsidian plugin settings UI at runtime.
- The `wiki/` directory is a git submodule (`obsidian-steward.wiki.git`); it is not required for building or testing.
- `npm run dev` spawns two parallel watchers (esbuild + PostCSS). It watches for file changes and rebuilds `main.js` and `styles.css` automatically.
- Build output files (`main.js`, `styles.css`) are generated in the repo root. These are the artifacts loaded by Obsidian.
- Since this is an Obsidian plugin, there is no standalone web UI or server to start. Manual/integration testing requires loading the built plugin into an Obsidian vault.
