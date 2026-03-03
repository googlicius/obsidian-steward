# Steward Agent Refactor: Config-Driven Architecture (OpenClaw-Inspired)

This document outlines the refactoring plan to evolve Steward's agent architecture toward a config-driven design inspired by OpenClaw.

---

## Part 1: OpenClaw Agent Architecture

### Structure Overview

OpenClaw uses a **config-driven agent model** with:

- **`config.agents.list`**: Array of agent entries, each with `id`, `name`, `tools`, `workspace`, etc.
- **`agent-scope.ts`**: Resolves agent config by `agentId` (`listAgentEntries`, `resolveAgentConfig`, `resolveDefaultAgentId`)
- **`workspace-run.ts`**: Resolves workspace dir and agent ID for a run
- **`pi-embedded-runner/run.ts`**: Embeds and runs the PI agent with the resolved config
- **`cli-runner.ts`**: Runs agent via Claude CLI backend

### Agent Entry Schema (from `zod-schema.agent-runtime.ts`)

```ts
AgentEntrySchema = {
  id: string,                    // Required
  default?: boolean,             // Mark as default agent
  name?: string,
  workspace?: string,
  agentDir?: string,
  model?: string | { primary?, fallbacks? },
  skills?: string[],
  memorySearch?: {...},
  heartbeat?: {...},
  identity?: {...},
  groupChat?: {...},
  subagents?: {...},
  sandbox?: {...},
  tools?: {...}                  // Tool policy/profile per agent
}
```

### Key Patterns

1. **Agent lookup by ID**: `resolveAgentConfig(cfg, agentId)` returns merged config
2. **Default agent**: First entry with `default: true` or first in list
3. **Workspace per agent**: `resolveAgentWorkspaceDir(cfg, agentId)`
4. **Runner is separate**: The runner receives `agentId` + `config`, resolves workspace and agent config, then runs

---

## Part 2: Steward Agent Architecture (Current)

### Structure Overview

```
CommandProcessorService (setupHandlers)
    └── CommandProcessor (processIntents, continueProcessing)
            └── agentHandlers: Map<agentType, Agent>
```

### Registered Agents (from `CommandProcessorService.ts`)

| Intent Type | Agent Class | Notes |
|-------------|-------------|-------|
| ` ` (space) | SuperAgent | Default, full tools |
| `udc` | UDCAgent | User-defined commands |
| `search` | SuperAgent | Only ToolName.SEARCH |
| `speech` | SuperAgent | Only ToolName.SPEECH |
| `image` | SuperAgent | Only ToolName.IMAGE |

### Other Agents (not in CommandProcessor)

| Agent | Used By | Purpose |
|-------|---------|---------|
| ConversationTitleAgent | ConversationEventHandler | Generate conversation title |
| CompactionSummaryAgent | CompactionOrchestrator | Summarize old messages |

### CommandProcessor Responsibilities

1. **Sequential intent processing**: Processes `intents[]` from index 0, advances on success
2. **Handler resolution**: `baseType` → Agent (or `udc` for UDCs)
3. **Confirmation/user-input pause**: Stores `lastResult`, returns; resumes on user action
4. **Error handling**: Stops processing on ERROR
5. **Model fallback**: Via `Agent.safeHandle`
6. **Query params**: `?tools=x,y` for active tools override

### Agent Base Class

- `plugin`, `renderer`, `obsidianAPITools`, `app`, `commandProcessor`
- `activeTools: ToolName[]` passed to constructor (used by SuperAgent variants)
- `handle()`, `safeHandle()` with model fallback, lang loading, system prompts

---

## Part 3: Refactoring Solution

### 3.1 Agent Config Schema

Create `src/solutions/commands/agents/AgentConfig.ts`:

```ts
import { z } from 'zod/v3';
import { ToolName } from '../ToolRegistry';

export const AgentConfigSchema = z.object({
  id: z.string().min(1),
  name: z.string().optional(),
  default: z.boolean().optional(),
  /** Factory: 'super' | 'udc' | 'title' | 'compaction_summary' */
  factory: z.enum(['super', 'udc', 'title', 'compaction_summary']),
  /** For factory 'super': tools to activate. Empty = all tools. */
  tools: z.array(z.string()).optional(),
  /** For factory 'udc': UDC command ID */
  udcCommandId: z.string().optional(),
  /** Whether content is required for this agent */
  contentRequired: z.boolean().optional(),
});

export type AgentConfig = z.infer<typeof AgentConfigSchema>;
```

### 3.2 Default Agent Configs

Create `src/solutions/commands/agents/defaultAgents.ts`:

```ts
import { ToolName } from '../ToolRegistry';
import type { AgentConfig } from './AgentConfig';

export const DEFAULT_AGENT_CONFIGS: AgentConfig[] = [
  {
    id: 'super',
    name: 'Super Agent',
    default: true,
    factory: 'super',
    tools: [], // All tools
  },
  {
    id: 'udc',
    name: 'User-Defined Commands',
    factory: 'udc',
  },
  {
    id: 'search',
    name: 'Search Agent',
    factory: 'super',
    tools: [ToolName.SEARCH],
  },
  {
    id: 'speech',
    name: 'Speech Agent',
    factory: 'super',
    tools: [ToolName.SPEECH],
  },
  {
    id: 'image',
    name: 'Image Agent',
    factory: 'super',
    tools: [ToolName.IMAGE],
  },
  {
    id: 'title',
    name: 'Conversation Title Agent',
    factory: 'title',
  },
  {
    id: 'compaction_summary',
    name: 'Compaction Summary Agent',
    factory: 'compaction_summary',
  },
];
```

### 3.3 Agent Factory

Create `src/solutions/commands/agents/AgentFactory.ts`:

```ts
import type StewardPlugin from 'src/main';
import { SuperAgent } from './SuperAgent';
import { UDCAgent } from './UDCAgent';
import { ConversationTitleAgent } from './ConversationTitleAgent';
import { CompactionSummaryAgent } from './CompactionSummaryAgent';
import type { AgentConfig } from './AgentConfig';
import { ToolName } from '../ToolRegistry';

export function createAgentFromConfig(
  plugin: StewardPlugin,
  config: AgentConfig
): Agent {
  const tools = (config.tools ?? []).map(t => t as ToolName);
  switch (config.factory) {
    case 'super':
      return new SuperAgent(plugin, tools);
    case 'udc':
      return new UDCAgent(plugin);
    case 'title':
      return new ConversationTitleAgent(plugin);
    case 'compaction_summary':
      return new CompactionSummaryAgent(plugin);
    default:
      throw new Error(`Unknown agent factory: ${(config as AgentConfig).factory}`);
  }
}
```

### 3.4 AgentRunner (Replaces CommandProcessor)

Create `src/solutions/commands/agents/AgentRunner.ts`:

```ts
/**
 * AgentRunner: Runs agents based on config.
 * Replaces CommandProcessor's agent dispatch + sequential intent processing.
 *
 * Responsibilities:
 * - Resolve agent by intent type (config id or UDC command id)
 * - Process intents sequentially (same as CommandProcessor.continueProcessing)
 * - Handle confirmation/user-input pause
 * - Model fallback (delegated to Agent.safeHandle)
 */
export class AgentRunner {
  private static lastResults: Map<string, AgentResult> = new Map();
  private pendingIntents: Map<string, PendingIntent> = new Map();
  private agentCache: Map<string, Agent> = new Map();

  constructor(
    private readonly plugin: StewardPlugin,
    private readonly agentConfigs: AgentConfig[]
  ) {}

  private getOrCreateAgent(agentId: string): Agent | null {
    if (this.agentCache.has(agentId)) {
      return this.agentCache.get(agentId)!;
    }
    const config = this.agentConfigs.find(c => c.id === agentId);
    if (!config) return null;
    const agent = createAgentFromConfig(this.plugin, config);
    this.agentCache.set(agentId, agent);
    return agent;
  }

  private resolveAgentId(intentType: string): string {
    const baseType = intentType.split('?')[0];
    if (this.plugin.userDefinedCommandService.hasCommand(baseType)) {
      return 'udc';
    }
    return baseType;
  }

  public async processIntents(
    payload: ConversationIntentReceivedPayload,
    options: ProcessIntentsOptions = {}
  ): Promise<void> {
    // Same loop as CommandProcessor.continueProcessing
    // but resolve agent via getOrCreateAgent(resolveAgentId(baseType))
  }

  // Migrate: getLastResult, setLastResult, clearLastResult, deleteNextPendingIntent,
  // getPendingIntent, setCurrentIndex, hasBuiltInHandler, clearIntents, isProcessing
}
```

### 3.5 Migration Path

1. **Add AgentConfig + defaultAgents + AgentFactory** (no behavior change)
2. **Add AgentRunner** that uses config + factory; keep CommandProcessor as-is
3. **CommandProcessorService**: Switch from CommandProcessor to AgentRunner, loading configs from `defaultAgents` (or later from settings)
4. **Deprecate CommandProcessor**; move remaining helpers (parseIntentType, extractToolsFromQuery, processSystemPromptsWikilinks) into AgentRunner or a shared util
5. **Optional**: Allow user-defined agent configs in settings (similar to OpenClaw's `agents.list`)

### 3.6 File Changes Summary

| Action | File |
|--------|------|
| Create | `src/solutions/commands/agents/AgentConfig.ts` |
| Create | `src/solutions/commands/agents/defaultAgents.ts` |
| Create | `src/solutions/commands/agents/AgentFactory.ts` |
| Create | `src/solutions/commands/agents/AgentRunner.ts` |
| Modify | `src/services/CommandProcessorService.ts` – use AgentRunner + configs |
| Deprecate | `src/solutions/commands/CommandProcessor.ts` – logic moved to AgentRunner |

### 3.7 ConversationTitleAgent & CompactionSummaryAgent

These are **not** intent-based (no `intent.type` routing). They are invoked directly:

- **ConversationTitleAgent**: `ConversationEventHandler` creates and calls it
- **CompactionSummaryAgent**: `CompactionOrchestrator` creates and calls it

For the config-driven design:

- Include them in `DEFAULT_AGENT_CONFIGS` for consistency and future settings (e.g. model override per agent)
- **AgentFactory** can create them, but they are **not** registered in AgentRunner's routing
- AgentRunner only routes `intent.type` → agent for conversation commands
- Title and Compaction agents stay as direct instantiation from their call sites, OR we add a `getAgent('title')` / `getAgent('compaction_summary')` on a shared registry if we want them configurable

---

## Part 4: OpenClaw vs Steward Comparison

| Aspect | OpenClaw | Steward (Current) | Steward (Proposed) |
|--------|----------|-------------------|--------------------|
| Config | `agents.list[]` with id, name, tools, workspace, etc. | Hardcoded in CommandProcessorService | `AgentConfig[]` in defaultAgents (extensible to settings) |
| Agent resolution | `resolveAgentConfig(cfg, agentId)` | `agentHandlers.get(baseType)` | `getOrCreateAgent(resolveAgentId(baseType))` |
| Agent creation | Implicit in runner/bootstrap | `new SuperAgent(plugin, [ToolName.SEARCH])` | `createAgentFromConfig(plugin, config)` |
| Runner | pi-embedded-runner, cli-runner | CommandProcessor | AgentRunner |
| Tools per agent | `entry.tools` (policy) | `activeTools` in constructor | `config.tools` → constructor |

---

## Part 5: Implementation Order

1. **Phase 1 (Foundation)**
   - Add `AgentConfig` schema and `defaultAgents.ts`
   - Add `AgentFactory.createAgentFromConfig()`
   - Keep existing CommandProcessor; add tests for factory

2. **Phase 2 (AgentRunner)**
   - Implement `AgentRunner` with same behavior as `CommandProcessor.continueProcessing`
   - Extract shared helpers (parseIntentType, extractToolsFromQuery) to a util
   - Unit test AgentRunner against CommandProcessor behavior

3. **Phase 3 (Switch)**
   - Update `CommandProcessorService` to use `AgentRunner` with `DEFAULT_AGENT_CONFIGS`
   - Update any direct `commandProcessor` references to use `agentRunner` (or keep a facade that delegates)
   - Deprecate `CommandProcessor`

4. **Phase 4 (Optional)**
   - Add settings UI for custom agent configs
   - Merge user configs with defaults
