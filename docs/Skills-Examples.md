# Skills System - Example Definitions

This document provides concrete examples of how Skills would be defined and used in Steward.

## Example 1: Code Review Skill

**Location**: `Steward/Skills/code-review/SKILL.md`

```yaml
---
name: code-review
description: Review code for quality, security, and maintainability. Use when reviewing code, pull requests, or when user asks for code review.
version: 1
triggers:
  keywords: 
    - "code review"
    - "review code"
    - "review this"
    - "pull request"
    - "PR review"
    - "code quality"
  file_patterns:
    - "*.ts"
    - "*.js"
    - "*.tsx"
    - "*.jsx"
    - "*.py"
  tags:
    - "#code"
    - "#review"
tools:
  activate:
    - CONTENT_READING
    - EDIT
  deactivate: []
system_prompt: |
  When reviewing code, follow this structured approach:
  
  1. **Correctness**: Check for logic errors, edge cases, and potential bugs
  2. **Security**: Identify security vulnerabilities (SQL injection, XSS, etc.)
  3. **Maintainability**: Assess code readability, structure, and documentation
  4. **Performance**: Look for performance bottlenecks or inefficiencies
  5. **Testing**: Evaluate test coverage and test quality
  
  Format feedback as:
  - 🔴 **Critical**: Must fix before merge
  - 🟡 **Suggestion**: Consider improving
  - 🟢 **Nice to have**: Optional enhancement
  
dependencies: []
priority: 100
---

# Code Review Skill

## Review Checklist

- [ ] Logic is correct and handles edge cases
- [ ] No security vulnerabilities
- [ ] Code follows project style conventions
- [ ] Functions are appropriately sized and focused
- [ ] Error handling is comprehensive
- [ ] Tests cover the changes

## Additional Resources

- For detailed coding standards, see [instructions.md](instructions.md)
- For example reviews, see [examples.md](examples.md)
```

**Usage Scenario**:
- User opens a TypeScript file and asks: "Review this code"
- Skill automatically applies:
  - Activates `CONTENT_READING` and `EDIT` tools
  - Injects code review guidelines into system prompt
  - AI follows structured review process

---

## Example 2: Writing Assistant Skill

**Location**: `Steward/Skills/writing-assistant/SKILL.md`

```yaml
---
name: writing-assistant
description: Provides writing assistance, grammar checks, and style improvements. Use when user is writing content, asks for writing help, or when note has writing-related tags.
version: 1
triggers:
  keywords:
    - "improve writing"
    - "grammar check"
    - "fix grammar"
    - "writing style"
    - "make it clearer"
  tags:
    - "#writing"
    - "#draft"
    - "#essay"
tools:
  activate:
    - EDIT
  deactivate: []
system_prompt: |
  You are a writing assistant helping improve clarity, grammar, and style.
  
  Guidelines:
  - Maintain the author's voice and intent
  - Focus on clarity and readability
  - Suggest improvements, don't rewrite completely
  - Explain why changes improve the text
  
  When editing:
  1. Fix grammar and spelling errors
  2. Improve sentence structure for clarity
  3. Enhance word choice for precision
  4. Ensure consistent tone and style
dependencies: []
priority: 80
---

# Writing Assistant Skill

## Quick Start

When helping with writing:
1. Read the content carefully
2. Identify areas for improvement
3. Make edits with explanations
4. Preserve the author's voice

## Style Guidelines

- Prefer active voice over passive
- Use clear, concise sentences
- Avoid jargon unless necessary
- Maintain consistent terminology
```

**Usage Scenario**:
- User tags a note with `#writing` and asks: "Can you improve this?"
- Skill automatically applies:
  - Activates `EDIT` tool
  - Injects writing guidelines
  - AI provides focused writing assistance

---

## Example 3: Research Skill

**Location**: `Steward/Skills/research/SKILL.md`

```yaml
---
name: research
description: Conducts research, analyzes information, and synthesizes findings. Use when user asks to research, investigate, or analyze a topic.
version: 1
triggers:
  keywords:
    - "research"
    - "investigate"
    - "analyze"
    - "find information about"
    - "what is"
    - "tell me about"
tools:
  activate:
    - SEARCH
    - CONTENT_READING
    - SEARCH_MORE
  deactivate: []
system_prompt: |
  You are a research assistant. When conducting research:
  
  1. **Search Strategy**: Use multiple search queries to gather comprehensive information
  2. **Source Evaluation**: Consider credibility and relevance of sources
  3. **Synthesis**: Combine information from multiple sources
  4. **Structure**: Present findings in a clear, organized manner
  
  Output Format:
  - Executive Summary
  - Key Findings (with sources)
  - Analysis
  - Recommendations (if applicable)
dependencies: []
priority: 90
---

# Research Skill

## Research Workflow

1. **Define Research Question**: Clarify what needs to be researched
2. **Search**: Use multiple queries and search strategies
3. **Evaluate Sources**: Assess credibility and relevance
4. **Synthesize**: Combine information from multiple sources
5. **Present Findings**: Structure results clearly
```

**Usage Scenario**:
- User asks: "Research the latest developments in TypeScript 5.0"
- Skill automatically applies:
  - Activates `SEARCH`, `CONTENT_READING`, `SEARCH_MORE` tools
  - Injects research methodology
  - AI follows structured research process

---

## Example 4: Security Audit Skill (with Dependency)

**Location**: `Steward/Skills/security-audit/SKILL.md`

```yaml
---
name: security-audit
description: Performs security audits on code, focusing on vulnerabilities and best practices. Use when reviewing security, auditing code, or when security is mentioned.
version: 1
triggers:
  keywords:
    - "security"
    - "security audit"
    - "vulnerability"
    - "security review"
    - "secure code"
  file_patterns:
    - "*.ts"
    - "*.js"
    - "*.py"
tools:
  activate:
    - CONTENT_READING
  deactivate: []
system_prompt: |
  You are a security auditor. Focus on:
  
  Common Vulnerabilities:
  - SQL Injection
  - Cross-Site Scripting (XSS)
  - Cross-Site Request Forgery (CSRF)
  - Authentication/Authorization flaws
  - Insecure data storage
  - Insecure communication
  - Input validation issues
  
  Check for:
  - Hardcoded secrets or credentials
  - Insecure random number generation
  - Missing input validation
  - Insecure API endpoints
  - Weak encryption or hashing
dependencies:
  - code-review
priority: 95
---

# Security Audit Skill

## Security Checklist

- [ ] No hardcoded secrets or credentials
- [ ] Input validation present
- [ ] Authentication properly implemented
- [ ] Authorization checks in place
- [ ] Secure communication (HTTPS)
- [ ] No SQL injection vulnerabilities
- [ ] XSS protection implemented
- [ ] CSRF protection where needed

## Additional Resources

See [instructions.md](instructions.md) for detailed security guidelines.
```

**Usage Scenario**:
- User asks: "Review this code for security issues"
- Both `code-review` and `security-audit` skills apply:
  - `code-review` provides general review structure
  - `security-audit` adds security-specific focus
  - Dependencies ensure correct application order

---

## Example 5: TypeScript Helper Skill (File Pattern Trigger)

**Location**: `Steward/Skills/typescript-helper/SKILL.md`

```yaml
---
name: typescript-helper
description: Provides TypeScript-specific assistance, type checking, and best practices. Automatically applies when working with TypeScript files.
version: 1
triggers:
  file_patterns:
    - "*.ts"
    - "*.tsx"
tools:
  activate:
    - EDIT
  deactivate: []
system_prompt: |
  You are a TypeScript expert. When working with TypeScript:
  
  Best Practices:
  - Use strict type checking
  - Prefer interfaces over type aliases for object shapes
  - Use const assertions for literal types
  - Leverage discriminated unions for type safety
  - Avoid `any` type - use `unknown` if needed
  
  Common Patterns:
  - Use utility types (Partial, Pick, Omit, etc.)
  - Leverage type guards for runtime checks
  - Use generics for reusable code
dependencies: []
priority: 70
---

# TypeScript Helper Skill

## Type Safety Guidelines

- Always use explicit types for function parameters and return values
- Leverage TypeScript's type inference where appropriate
- Use type guards to narrow types safely
- Prefer type-safe patterns over type assertions

## Common Patterns

See [patterns.md](patterns.md) for TypeScript design patterns.
```

**Usage Scenario**:
- User opens any `.ts` or `.tsx` file
- Skill automatically applies:
  - Activates `EDIT` tool
  - Injects TypeScript-specific guidance
  - AI provides TypeScript-aware assistance

---

## Example 6: Explicit Skill Invocation

**Scenario**: User wants to apply a skill manually

**Command**: `/skill:code-review`

**Behavior**:
- Skill is explicitly applied regardless of context
- System prompts and tool activations are applied
- Useful for:
  - Testing skills
  - Applying skills in non-standard contexts
  - Manual skill activation

---

## Example 7: Skill Composition

**Scenario**: User asks "Review this TypeScript code for security"

**Applied Skills** (in order):
1. `typescript-helper` (file pattern: `*.ts`, priority: 70)
2. `code-review` (keyword: "review", priority: 100)
3. `security-audit` (keyword: "security", dependency: code-review, priority: 95)

**Result**:
- System prompts merged in priority order
- Tools activated: `CONTENT_READING`, `EDIT`
- AI has comprehensive context for:
  - TypeScript best practices
  - Code review structure
  - Security audit focus

---

## Example 8: Skill with File Trigger

**Location**: `Steward/Skills/meeting-notes/SKILL.md`

```yaml
---
name: meeting-notes
description: Helps structure and format meeting notes. Applies when working with meeting-related files.
version: 1
triggers:
  file_patterns:
    - "**/Meetings/*.md"
    - "**/meetings/*.md"
  tags:
    - "#meeting"
tools:
  activate:
    - EDIT
  deactivate: []
system_prompt: |
  You are a meeting notes assistant. Help structure meeting notes:
  
  Format:
  - Date and attendees
  - Agenda items
  - Discussion points
  - Action items (with owners and deadlines)
  - Decisions made
  
  Style:
  - Use clear headings
  - Bullet points for action items
  - Bold for decisions
dependencies: []
priority: 60
---

# Meeting Notes Skill

## Meeting Notes Template

```markdown
# Meeting: [Topic] - [Date]

## Attendees
- [Name] ([Role])

## Agenda
1. [Item 1]
2. [Item 2]

## Discussion
[Discussion points]

## Decisions
- **Decision 1**: [Description]

## Action Items
- [ ] [Task] - Owner: [Name], Due: [Date]
```
```

**Usage Scenario**:
- User creates/modifies a file in `Meetings/` folder
- Skill automatically applies:
  - Activates `EDIT` tool
  - Provides meeting notes structure
  - AI helps format and organize meeting content

---

## Comparison: UDC vs Skill for Same Use Case

### As User-Defined Command

```yaml
command_name: code-review
query_required: true
steps:
  - name: read
    query: Read the code in $from_user
  - name: generate
    query: Review the code for quality, security, and maintainability
    system_prompt:
      - "Focus on correctness, security, and maintainability"
```

**Limitations**:
- Must be explicitly invoked with `/code-review`
- Sequential execution (read, then review)
- System prompt is static

### As Skill

```yaml
---
name: code-review
triggers:
  keywords: ["review", "code review"]
  file_patterns: ["*.ts", "*.js"]
tools:
  activate: [CONTENT_READING, EDIT]
system_prompt: |
  Review code for quality, security, and maintainability...
---
```

**Advantages**:
- Automatically applies when relevant
- Can work with any query structure
- More flexible and composable
- Context-aware activation

---

## Migration Example: Converting UDC to Skill

**Original UDC** (`Steward/Commands/writing-help.md`):
```yaml
command_name: writing-help
query_required: true
steps:
  - name: edit
    query: Improve the writing: $from_user
    system_prompt:
      - "Focus on clarity and grammar"
```

**Converted Skill** (`Steward/Skills/writing-assistant/SKILL.md`):
```yaml
---
name: writing-assistant
description: Provides writing assistance and improvements
triggers:
  keywords: ["improve writing", "writing help"]
  tags: ["#writing"]
tools:
  activate: [EDIT]
system_prompt: |
  Focus on clarity and grammar when improving writing...
---
```

**Benefits**:
- More discoverable (applies automatically)
- Can be composed with other skills
- More flexible (not tied to specific command structure)
