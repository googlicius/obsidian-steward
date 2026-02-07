# Skills System Design Proposal for Steward

## Executive Summary

This document proposes a unified **Skills** system for Steward that extends and unifies the existing User-Defined Commands (UDCs) and activate tools mechanisms. Skills will provide a more flexible, discoverable, and reusable way to enhance the AI agent's capabilities.

## Current State Analysis

### User-Defined Commands (UDCs)

- **Location**: `Steward/Commands/*.md` files with YAML blocks
- **Structure**: Sequential steps with queries, models, system prompts
- **Invocation**: Via `/command_name` prefix
- **Features**:
  - File-based triggers (automated execution)
  - Placeholder substitution (`$from_user`, `$file_name`, `$steward`)
  - System prompt injection
  - Tool activation via step names
  - Versioned schema support

### Activate Tools Mechanism

- **Purpose**: Dynamic tool activation/deactivation during conversations
- **Storage**: Conversation frontmatter (`tools` array)
- **Features**:
  - Runtime tool management
  - Dependency handling (e.g., TODO_LIST_UPDATE → TODO_LIST)
  - Tool validation
  - Persistent across conversation turns

### Gaps & Opportunities

1. **No unified concept** for reusable AI guidance/instructions
2. **Limited discoverability** - UDCs are command-based, not context-aware
3. **No skill composition** - Can't easily combine multiple skills
4. **System prompts are static** - Can't dynamically inject contextual guidance
5. **No skill metadata** - Missing description, triggers, dependencies

## Proposed Skills System

### Core Concept

A **Skill** is a reusable, discoverable unit of AI guidance that can:

- Provide instructions and examples to the AI
- Activate specific tools when relevant
- Inject system prompts dynamically
- Be discovered and applied contextually (not just via command prefix)
- Compose with other skills
- Include metadata for intelligent application

### Skill Structure

```
Steward/Skills/
├── skill-name/
│   ├── SKILL.md              # Required - main skill definition
│   ├── instructions.md        # Optional - detailed instructions
│   ├── examples.md            # Optional - usage examples
│   └── scripts/               # Optional - utility scripts
│       └── helper.js
```

### SKILL.md Format

```yaml
---
name: code-review
description: Review code for quality, security, and maintainability. Use when reviewing code, pull requests, or when user asks for code review.
version: 1
triggers:
  - keywords: ["code review", "review code", "pull request", "PR review"]
  - file_patterns: ["*.ts", "*.js", "*.py"]
  - tags: ["#code", "#review"]
tools:
  activate: [CONTENT_READING, EDIT]
  deactivate: []
system_prompt: |
  When reviewing code, focus on:
  1. Correctness and edge cases
  2. Security vulnerabilities
  3. Code readability
  4. Test coverage
dependencies: []  # Other skill names this depends on
priority: 100     # Higher priority skills are applied first
---

# Code Review Skill

## Quick Start
[Essential instructions here]

## Additional Resources
- For detailed guidelines, see [instructions.md](instructions.md)
- For examples, see [examples.md](examples.md)
```

### Key Differences from UDCs

| Aspect          | User-Defined Commands         | Skills                                   |
| --------------- | ----------------------------- | ---------------------------------------- |
| **Purpose**     | Execute sequences of commands | Enhance AI capabilities contextually     |
| **Invocation**  | Explicit (`/command_name`)    | Automatic (discovery) + Explicit         |
| **Structure**   | Sequential steps              | Instructions + metadata                  |
| **Scope**       | Command execution             | AI guidance + tool activation            |
| **Composition** | Nested commands               | Multiple skills can apply simultaneously |
| **Discovery**   | Command prefix                | Keywords, file patterns, tags            |

## Architecture Design

### 1. Skill Service (`SkillService`)

**Responsibilities**:

- Load and parse skills from `Steward/Skills/`
- Index skills by metadata (keywords, file patterns, tags)
- Match skills to current context
- Manage skill lifecycle (load, reload, validate)

**Key Methods**:

```typescript
class SkillService {
  // Load all skills from disk
  async loadAllSkills(): Promise<void>;

  // Find applicable skills for current context
  async findApplicableSkills(context: SkillContext): Promise<Skill[]>;

  // Get skill by name
  getSkill(name: string): Skill | undefined;

  // Validate skill structure
  validateSkill(skill: Skill): ValidationResult;
}
```

### 2. Skill Context

```typescript
interface SkillContext {
  // Current conversation context
  query?: string;
  conversationHistory?: ModelMessage[];

  // File context
  currentFile?: TFile;
  filePatterns?: string[];
  tags?: string[];

  // Tool context
  activeTools?: ToolName[];

  // User intent
  intent?: Intent;
}
```

### 3. Skill Application Flow

```
1. User sends query or file event occurs
   ↓
2. SkillService.findApplicableSkills(context)
   - Match keywords in query
   - Match file patterns
   - Match tags
   - Check dependencies
   ↓
3. Skills are prioritized and filtered
   ↓
4. For each applicable skill:
   - Inject system prompts
   - Activate/deactivate tools
   - Add instructions to context
   ↓
5. SuperAgent executes with enhanced context
```

### 4. Integration Points

#### A. SuperAgent Integration

**In `executeStreamText` method** (around line 451):

```typescript
// Current code:
const additionalSystemPrompts = params.intent.systemPrompts || [];

// Enhanced with Skills:
const skillService = this.plugin.skillService;
const skillContext: SkillContext = {
  query: params.intent.query,
  currentFile: await this.getCurrentFile(params.title),
  activeTools: activeToolNames,
  intent: params.intent,
};

const applicableSkills = await skillService.findApplicableSkills(skillContext);

// Collect system prompts from skills
for (const skill of applicableSkills) {
  if (skill.systemPrompt) {
    additionalSystemPrompts.push(skill.systemPrompt);
  }

  // Activate tools from skills
  if (skill.tools?.activate) {
    for (const tool of skill.tools.activate) {
      if (!activeToolNames.includes(tool)) {
        activeToolNames.push(tool);
      }
    }
  }

  // Deactivate tools from skills
  if (skill.tools?.deactivate) {
    activeToolNames = activeToolNames.filter(t => !skill.tools!.deactivate!.includes(t));
  }
}
```

#### B. Activate Tool Handler Integration

**Enhance `ActivateToolHandler`** to support skill-based tool activation:

```typescript
// When tools are activated, check if any skills should be applied
const skillContext = {
  activeTools: activeTools,
  // ... other context
};

const applicableSkills = await skillService.findApplicableSkills(skillContext);
// Apply skill system prompts and additional tool activations
```

#### C. User-Defined Commands Integration

**Enhance UDCs** to reference skills:

```yaml
command_name: review-and-fix
steps:
  - name: generate
    query: Review the code and suggest fixes
    skills: ['code-review', 'security-audit'] # Apply these skills
```

### 5. Skill Discovery Mechanisms

#### A. Keyword Matching

- Extract keywords from user query
- Match against skill `triggers.keywords`
- Use fuzzy matching for flexibility

#### B. File Pattern Matching

- When file is opened/modified
- Match file extension/name against `triggers.file_patterns`
- Useful for language-specific skills

#### C. Tag Matching

- Extract tags from current note
- Match against `triggers.tags`
- Enables tag-based skill activation

#### D. Explicit Invocation

- Skills can still be invoked explicitly: `/skill:code-review`
- Useful for testing or manual application

### 6. Skill Composition & Dependencies

**Dependency Resolution**:

```typescript
async function resolveSkillDependencies(
  skills: Skill[],
  skillService: SkillService
): Promise<Skill[]> {
  const resolved = new Set<string>();
  const result: Skill[] = [];

  function resolve(skill: Skill) {
    if (resolved.has(skill.name)) return;

    // Resolve dependencies first
    if (skill.dependencies) {
      for (const depName of skill.dependencies) {
        const dep = skillService.getSkill(depName);
        if (dep) resolve(dep);
      }
    }

    resolved.add(skill.name);
    result.push(skill);
  }

  for (const skill of skills) {
    resolve(skill);
  }

  return result;
}
```

**Priority Handling**:

- Skills with higher `priority` values are applied first
- System prompts are concatenated in priority order
- Tool activations are merged (union of all activate sets)

## Migration Strategy

### Phase 1: Foundation (No Breaking Changes)

1. Create `SkillService` class
2. Implement skill loading and parsing
3. Add skill discovery (keyword matching)
4. Integrate with SuperAgent system prompt injection
5. **UDCs remain unchanged**

### Phase 2: Enhanced Discovery

1. Add file pattern matching
2. Add tag-based matching
3. Implement skill dependencies
4. Add explicit skill invocation (`/skill:name`)

### Phase 3: Tool Integration

1. Integrate skill-based tool activation
2. Merge with existing activate tools mechanism
3. Add skill composition support

### Phase 4: UDC Evolution (Optional)

1. Allow UDCs to reference skills
2. Consider converting simple UDCs to skills
3. Provide migration path for users

## Benefits

### For Users

1. **Easier to create** - Focus on instructions, not command sequences
2. **More discoverable** - Skills apply automatically when relevant
3. **More flexible** - Can combine multiple skills
4. **Better organization** - Skills folder structure

### For Developers

1. **Unified abstraction** - Single concept for AI enhancement
2. **Extensible** - Easy to add new discovery mechanisms
3. **Composable** - Skills can build on each other
4. **Testable** - Clear separation of concerns

### For the System

1. **Better context awareness** - Skills apply based on context, not just commands
2. **Reduced redundancy** - Share common instructions across use cases
3. **Improved maintainability** - Clear skill boundaries

## Example Use Cases

### Use Case 1: Code Review Skill

**Trigger**: User mentions "review this code" or opens a `.ts` file
**Action**:

- Activates `CONTENT_READING` tool
- Injects code review guidelines
- Provides examples of good reviews

### Use Case 2: Writing Assistant Skill

**Trigger**: User is in a note with tag `#writing`
**Action**:

- Activates `EDIT` tool
- Injects writing style guidelines
- Provides grammar and style checks

### Use Case 3: Research Skill

**Trigger**: Keywords like "research", "analyze", "investigate"
**Action**:

- Activates `SEARCH` and `CONTENT_READING` tools
- Injects research methodology
- Provides structured output format

## Open Questions

1. **Skill Conflicts**: What happens when multiple skills activate conflicting tools?

   - **Proposal**: Last-wins or priority-based resolution

2. **Performance**: How to avoid loading all skills on every query?

   - **Proposal**: Index skills by triggers, lazy load content

3. **Skill Versioning**: How to handle skill updates?

   - **Proposal**: Version field in frontmatter, support multiple versions

4. **Skill Marketplace**: Should skills be shareable?

   - **Proposal**: Future consideration, start with local-only

5. **Backward Compatibility**: How to ensure UDCs still work?
   - **Proposal**: Keep UDC system intact, skills are additive

## Implementation Checklist

### Core Infrastructure

- [ ] Create `SkillService` class
- [ ] Define `Skill` interface/type
- [ ] Implement skill loading from `Steward/Skills/`
- [ ] Add skill validation
- [ ] Create skill indexing system

### Discovery Mechanisms

- [ ] Keyword matching
- [ ] File pattern matching
- [ ] Tag matching
- [ ] Explicit invocation (`/skill:name`)

### Integration

- [ ] Integrate with SuperAgent system prompts
- [ ] Integrate with tool activation
- [ ] Add skill context to conversation frontmatter (optional)

### User Experience

- [ ] Create example skills
- [ ] Add skill management UI (future)
- [ ] Document skill creation guide

## Conclusion

The Skills system provides a natural evolution of Steward's capabilities, unifying UDCs and tool activation into a more flexible, discoverable framework. By starting with additive changes and maintaining backward compatibility, we can introduce this powerful feature without disrupting existing workflows.
