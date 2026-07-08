# scripts/ — Build Scripts

Build-time scripts that bundle content and heavy libraries into TypeScript payloads under `src/generated/`. Esbuild imports these at compile time when building `main.js`.

## Pipeline Overview

```
Source trees                    scripts/*.mjs                    esbuild
─────────────────              ─────────────────                ────────
community-UDCs/**/*.md    →    build-community-udc-manifest  →  communityUdcManifest.ts
standard-skills/**/SKILL.md →  build-standard-skills         →  standardSkills.ts
agents/Sub Agents.md      →    build-sub-agents              →  subAgents.ts
src/bundled-*-entry.ts    →    build-bundled-libs (manual)   →  bundled*Payload.ts (×4)
internal/bundled-internals-entry.ts
src/generated/modelsMetadata.ts  ←  build-models-metadata.mjs (manual)

All generated TS under src/generated/  →  imported by src/  →  esbuild.config.mjs  →  main.js
```

## Scripts

| Script | npm command | Source | Output | Runtime consumer |
|--------|-------------|--------|--------|------------------|
| `build-bundled-libs.mjs` | `build:bundled-libs` | `src/bundled-libs-entry.ts`, `src/bundled-libs-sync-entry.ts`, `src/bundled-libs-desktop-entry.ts`, `internal/bundled-internals-entry.ts` | `bundledLibsPayload.ts`, `bundledSyncLibsPayload.ts`, `bundledDesktopLibsPayload.ts`, `bundledInternalsPayload.ts` | `src/utils/bundledLibs.ts`, `src/utils/bundledInternals.ts` |
| `build-community-udc-manifest.mjs` | `build:community-manifest` | `community-UDCs/**/*.md` | `communityUdcManifest.ts` | `src/views/view-builders/CommandsViewBuilder.ts` |
| `build-standard-skills.mjs` | `build:standard-skills` | `standard-skills/**/SKILL.md` | `standardSkills.ts` | `src/services/SkillService/SkillService.ts` |
| `build-sub-agents.mjs` | `build:sub-agents` | `agents/Sub Agents.md` | `subAgents.ts` | `src/services/SubAgent/SubAgentDefinitionService.ts` |
| `build-models-metadata.mjs` | `build:models-metadata` | `https://models.dev/api.json` (allowlisted providers) | `modelsMetadata.ts` | `src/services/LLMService/modelMetadata.ts`, `LLMService.ts`, `ModelRegistry.ts`, `ModelSetting.ts` |

## build-bundled-libs.mjs

Bundles heavy npm/first-party deps into minified IIFEs, LZ-compresses to Base64, emits TypeScript payload constants for runtime `eval` (deferred parse at startup).

**When to run:** Manual only. Payloads are committed. Re-run after changing bundled-lib entry files or their dependencies.

**Runtime:** `getBundledLib()` / `getBundledInternal()` decompress and evaluate on first access.

See [docs/technicals/Defer AI-SDK parse and Lazy-load mechanism.md](../docs/technicals/Defer%20AI-SDK%20parse%20and%20Lazy-load%20mechanism.md).

## build-community-udc-manifest.mjs

Builds a typed manifest of community User-Defined Commands for the Commands help UI and install/update flow.

- Walks `community-UDCs/**/*.md`
- Parses YAML frontmatter (`version`, `update_instructions`) and body YAML fenced blocks
- Each block must have `command_name`; optional `description`
- Invalid blocks are silently skipped
- Exports `COMMUNITY_UDC_MANIFEST` sorted by `commandName`

## build-standard-skills.mjs

Bundles built-in skills for vault seeding/upgrades.

- Walks `standard-skills/**/SKILL.md`
- Frontmatter: required `name`, `description`; optional `version`, `tools`, `folder`
- Validates `tools` against `ToolName` enum from `src/solutions/commands/toolNames.ts`
- **Fails hard** on missing frontmatter or invalid tools

## build-sub-agents.mjs

Bundles default sub-agent definitions for vault seeding/upgrades.

- Reads `agents/Sub Agents.md`
- YAML frontmatter with `version`; body preserved
- Exports `BUNDLED_SUB_AGENTS: { version, content }`

## build-models-metadata.mjs

Snapshots model capability metadata from [models.dev](https://models.dev/api.json) for allowlisted providers.

- **Manual run only** (needs network). Output is committed — not part of `dev` or `build`.
- Fetches `https://models.dev/api.json`, filters to `PROVIDER_ALLOWLIST` in the script (`openai`, `anthropic`, `google`, `deepseek`, `groq`, `ollama`, `openrouter`, `mistral`, `xai`, `togetherai`, `fireworks-ai`, `deepinfra`, `cerebras`, `perplexity`). Providers absent from the API are skipped without failing.
- Strips each model to `context`, `output`, `toolCall`, `temperature`, `reasoning`, and `input` modalities.
- Exports `MODELS_METADATA: Record<provider, Record<modelId, BundledModelMetadata>>`.
- **Fails hard** on fetch or JSON parse errors (does not overwrite the committed snapshot with junk).

**Refresh procedure:** `npm run build:models-metadata` → review diff in `src/generated/modelsMetadata.ts` → commit.

## Integration with npm Scripts

| npm script | Content scripts | Bundled libs |
|------------|-----------------|--------------|
| `dev` | Runs UDC, skills, sub-agents in parallel at start; esbuild watch | Not run (uses committed payloads) |
| `build` | Runs UDC, skills, sub-agents sequentially; esbuild production | Not run |

**Gotcha:** Editing `community-UDCs/`, `standard-skills/`, or `agents/Sub Agents.md` requires re-running the matching script (or restarting `dev`/`build`). There is no watch on source trees — `dev` only regenerates once at startup.

## Generated Artifacts

All files in `src/generated/` are auto-generated and committed. ESLint ignores this folder.

Do not edit generated files by hand — change the source tree and re-run the matching script.

## Shared Config

`esbuild.shared.mjs` at the repo root defines `sharedExternal` used by both main esbuild and `build-bundled-libs.mjs` to keep externals consistent.
