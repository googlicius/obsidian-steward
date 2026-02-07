# Skills System Architecture Diagram

## System Overview

```
┌─────────────────────────────────────────────────────────────┐
│                      Steward Plugin                          │
└─────────────────────────────────────────────────────────────┘
                            │
                            │
        ┌───────────────────┼───────────────────┐
        │                   │                   │
        ▼                   ▼                   ▼
┌───────────────┐   ┌───────────────┐   ┌───────────────┐
│ SkillService  │   │  UDC Service  │   │ SuperAgent    │
│               │   │               │   │               │
│ - Load Skills │   │ - Load Commands│   │ - Execute     │
│ - Index Skills│   │ - Execute     │   │ - Stream Text │
│ - Match Skills│   │ - Triggers    │   │ - Tool Calls  │
└───────────────┘   └───────────────┘   └───────────────┘
        │                   │                   │
        │                   │                   │
        └───────────────────┼───────────────────┘
                            │
                            ▼
                    ┌───────────────┐
                    │ ToolRegistry  │
                    │               │
                    │ - Active Tools│
                    │ - Tool Schemas│
                    └───────────────┘
```

## Skill Application Flow

```
User Query/File Event
        │
        ▼
┌───────────────────────┐
│ Build SkillContext    │
│ - query                │
│ - currentFile          │
│ - tags                 │
│ - activeTools          │
└───────────────────────┘
        │
        ▼
┌───────────────────────┐
│ SkillService          │
│ findApplicableSkills()│
└───────────────────────┘
        │
        ├─── Keyword Match ────┐
        ├─── File Pattern ─────┤
        ├─── Tag Match ────────┤
        └─── Explicit Invoke ──┤
                                │
                                ▼
                    ┌───────────────────────┐
                    │ Filter & Prioritize   │
                    │ - Remove duplicates   │
                    │ - Sort by priority    │
                    │ - Resolve dependencies│
                    └───────────────────────┘
                                │
                                ▼
                    ┌───────────────────────┐
                    │ Apply Skills          │
                    │ - Inject prompts      │
                    │ - Activate tools      │
                    │ - Add instructions    │
                    └───────────────────────┘
                                │
                                ▼
                    ┌───────────────────────┐
                    │ SuperAgent Execution  │
                    │ with Enhanced Context │
                    └───────────────────────┘
```

## Skill Structure

```
Steward/Skills/
│
├── code-review/
│   ├── SKILL.md          ──┐
│   ├── instructions.md    │── Skill Definition
│   ├── examples.md        │
│   └── scripts/           │
│       └── validator.js   ──┘
│
├── writing-assistant/
│   ├── SKILL.md
│   └── style-guide.md
│
└── research/
    ├── SKILL.md
    └── methodology.md
```

## Skill Metadata Flow

```
SKILL.md Frontmatter
        │
        ├── name ────────────────► Skill Identity
        ├── description ─────────► Discovery Index
        ├── triggers ────────────► Matching Criteria
        │   ├── keywords
        │   ├── file_patterns
        │   └── tags
        ├── tools ───────────────► Tool Activation
        │   ├── activate
        │   └── deactivate
        ├── system_prompt ───────► AI Instructions
        ├── dependencies ────────► Composition
        └── priority ────────────► Application Order
```

## Integration Points

### 1. SuperAgent Integration

```
SuperAgent.executeStreamText()
        │
        ├─── Current: Load system prompts from intent
        │
        └─── Enhanced:
             │
             ├─── Get SkillContext
             │
             ├─── Find Applicable Skills
             │
             ├─── Collect System Prompts
             │    ├─── From intent.systemPrompts
             │    ├─── From llmConfig.systemPrompt
             │    └─── From applicable skills
             │
             ├─── Merge Tool Activations
             │    ├─── From activeTools (frontmatter)
             │    ├─── From classified tasks
             │    └─── From applicable skills
             │
             └─── Execute with Enhanced Context
```

### 2. Activate Tool Handler Integration

```
ActivateToolHandler.handle()
        │
        ├─── Current: Validate & activate/deactivate tools
        │
        └─── Enhanced:
             │
             ├─── Update activeTools
             │
             ├─── Check for Skill Context Changes
             │
             ├─── Re-evaluate Applicable Skills
             │    (skills may have tool-based triggers)
             │
             └─── Apply New Skills if Needed
```

### 3. File Event Integration

```
File Event (create/modify/delete)
        │
        ├─── Current: UDC Trigger Check
        │
        └─── Enhanced:
             │
             ├─── Check UDC Triggers (existing)
             │
             └─── Check Skill Triggers (new)
                  │
                  ├─── Match file patterns
                  ├─── Match tags
                  └─── Apply Skills
                       │
                       └─── Create/Update Conversation
                            with Skill Context
```

## Skill Composition Example

```
User Query: "Review this TypeScript code for security issues"
        │
        ▼
┌─────────────────────────────────────┐
│ Skill Discovery                     │
├─────────────────────────────────────┤
│ 1. code-review (priority: 100)      │
│    - Matches: "review" keyword      │
│    - Activates: [CONTENT_READING]   │
│    - Dependencies: []                │
│                                     │
│ 2. security-audit (priority: 90)    │
│    - Matches: "security" keyword    │
│    - Activates: [CONTENT_READING]   │
│    - Dependencies: [code-review]    │
│                                     │
│ 3. typescript-helper (priority: 80) │
│    - Matches: *.ts file pattern     │
│    - Activates: [EDIT]              │
│    - Dependencies: []                │
└─────────────────────────────────────┘
        │
        ▼
┌─────────────────────────────────────┐
│ Dependency Resolution                │
├─────────────────────────────────────┤
│ Order:                              │
│ 1. code-review (no deps)            │
│ 2. security-audit (dep: code-review)│
│ 3. typescript-helper (no deps)      │
└─────────────────────────────────────┘
        │
        ▼
┌─────────────────────────────────────┐
│ Merged Application                  │
├─────────────────────────────────────┤
│ System Prompts:                     │
│ - code-review guidelines            │
│ - security-audit checklist          │
│ - typescript-helper tips            │
│                                     │
│ Active Tools:                       │
│ - CONTENT_READING (from 1, 2)      │
│ - EDIT (from 3)                     │
└─────────────────────────────────────┘
```

## Data Structures

### Skill Interface

```typescript
interface Skill {
  name: string;
  description: string;
  version: number;
  triggers?: {
    keywords?: string[];
    file_patterns?: string[];
    tags?: string[];
  };
  tools?: {
    activate?: ToolName[];
    deactivate?: ToolName[];
  };
  systemPrompt?: string;
  content?: string; // SKILL.md body
  dependencies?: string[]; // Other skill names
  priority?: number;
  filePath: string;
}
```

### SkillContext Interface

```typescript
interface SkillContext {
  query?: string;
  conversationHistory?: ModelMessage[];
  currentFile?: TFile;
  filePatterns?: string[];
  tags?: string[];
  activeTools?: ToolName[];
  intent?: Intent;
}
```

## Comparison: UDCs vs Skills

```
┌─────────────────────┬──────────────────────┬─────────────────────┐
│ Aspect              │ User-Defined Commands│ Skills              │
├─────────────────────┼──────────────────────┼─────────────────────┤
│ Invocation          │ Explicit (/command)  │ Auto + Explicit     │
│ Structure           │ Sequential steps     │ Instructions        │
│ Purpose             │ Execute commands      │ Enhance AI          │
│ Discovery           │ Command prefix       │ Context matching    │
│ Composition         │ Nested commands      │ Multiple skills     │
│ Tool Activation     │ Via step names        │ Via metadata        │
│ System Prompts      │ Static (YAML)        │ Dynamic (context)  │
│ File Triggers       │ Yes                  │ Yes (enhanced)     │
│ Reusability         │ Command-level         │ Instruction-level  │
└─────────────────────┴──────────────────────┴─────────────────────┘
```
