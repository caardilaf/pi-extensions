# SpecForge

> From idea to implementation-ready feature specifications.

SpecForge is a proposed **pi extension** that adds a specification-first workflow to a project. It helps engineers turn raw feature ideas into small, reviewed, implementation-ready specifications that can be handed to a coding agent.

SpecForge is designed for two audiences:

- **Users** who want a guided workflow for planning features before implementation.
- **Extension authors** who want a clear blueprint for implementing the workflow as a pi extension.

---

## What SpecForge Does

SpecForge acts like a senior software engineer and architect during planning. It does **not** generate production code directly.

Its purpose is to:

- Ask the right questions.
- Identify missing requirements.
- Avoid over-engineering.
- Right-size solutions according to project maturity.
- Produce implementation-ready feature specifications.
- Hand approved specifications to an implementation agent only after planning is complete.

---

## Core Rule

> **ONE SPEC = ONE FEATURE**

A specification must represent one deliverable feature.

Good examples:

- `semantic-search`
- `oauth-authentication`
- `pdf-upload`
- `anomaly-detection-endpoint`

Bad examples:

- `Build AI Platform`
- `Build Customer Support System`
- `Create Full Backend`

If a raw idea contains multiple features, SpecForge should recommend splitting it before refinement continues.

---

## User Workflow

```text
Raw Idea
   │
   ▼
/spec-new <feature-id>
   │
   ▼
specs/raw_specs/<feature-id>.md
   │
   ▼
/spec-refine <feature-id>
   │
   ▼
specs/refined_specs/<feature-id>.md
   │
   ▼
/spec-review <feature-id>
   │
   ▼
Readiness score + review notes
   │
   ▼
/spec-promote <feature-id>
   │
   ▼
specs/archived_specs/<feature-id>.md
   │
   ▼
/spec-start <feature-id>
   │
   ▼
Implementation handoff to pi
   │
   ▼
Implementation work
   │
   ▼
/spec-complete <feature-id>
```

Optional project-level commands can be used at any time:

```text
/spec-status
/spec-prioritize
/spec-refresh
```

---

## Repository Files

SpecForge stores all workflow state in Markdown files inside the repository.

```text
specs/
├── PROJECT_CONTEXT.md
├── raw_specs/
├── refined_specs/
└── archived_specs/
```

`/spec-init` creates this SpecForge file structure, updates the related `.gitignore` entries, and prepares `PROJECT_CONTEXT.md`. In codebase mode it also starts a read-only project review so useful context can be captured. It does **not** initialize or modify an application project: no `uv init`, no `pyproject.toml`, no package manager setup, and no dependency installation.

### `specs/PROJECT_CONTEXT.md`

The lightweight project memory used during refinement and review.

It should contain project-wide context only:

- Session type: `codebase` or `planning`.
- Project stage.
- Technology stack.
- Libraries and frameworks.
- Tooling.
- Architecture and implementation patterns.
- Coding style and conventions.
- Testing approach.
- Engineering principles.
- Important architectural decisions that affect future features.

Feature-specific decisions belong in promoted feature specifications, not in `PROJECT_CONTEXT.md`.

### `specs/raw_specs/`

Contains early feature ideas created by `/spec-new` or added manually.

This directory is ignored by git because raw ideas may be incomplete, messy, or exploratory.

### `specs/refined_specs/`

Contains specifications under refinement or review.

This directory is ignored by git because these files are not yet approved.

### `specs/archived_specs/`

Contains approved specifications.

This directory is committed to git and acts as the source of truth for planned, active, and completed feature work.

---

## Git Rules

`/spec-init` should add the following entries to `.gitignore` if they are missing:

```gitignore
# SpecForge
specs/raw_specs/
specs/refined_specs/
```

Only archived specifications should be committed:

```text
specs/archived_specs/
```

---

## Project Context Template

`specs/PROJECT_CONTEXT.md` should start small and evolve only when project-wide decisions are discovered.

```md
# PROJECT_CONTEXT

## SESSION_TYPE
codebase

## STAGE
EARLY

## PROJECT SUMMARY
This SpecForge workspace is attached to an implementation codebase. Project insights should be filled by /spec-init or /spec-refresh after a read-only review.

## STACK
- Unknown

## TOOLING
- Unknown

## LIBRARIES AND FRAMEWORKS
- Unknown

## ARCHITECTURE AND PATTERNS
- Unknown

## CODING STYLE
- Unknown

## TESTING APPROACH
- Unknown

## CONSTRAINTS AND OPEN QUESTIONS
- Unknown

## PRINCIPLES
- One Spec = One Feature
- Avoid Over-Engineering
```

Planning-only sessions use:

```md
# PROJECT_CONTEXT

## SESSION_TYPE
planning

## STAGE
EARLY

## PROJECT SUMMARY
This SpecForge workspace is being used for planning. No implementation codebase has been reviewed yet.

## STACK
- Unknown

## TOOLING
- Unknown

## LIBRARIES AND FRAMEWORKS
- Unknown

## ARCHITECTURE AND PATTERNS
- Unknown

## CODING STYLE
- Unknown

## TESTING APPROACH
- Unknown

## CONSTRAINTS AND OPEN QUESTIONS
- Unknown

## PRINCIPLES
- One Spec = One Feature
- Avoid Over-Engineering
- Treat technical choices as provisional until validated
```

### Project Stage Values

| Stage | Meaning | Planning Style |
| --- | --- | --- |
| `EARLY` | New or small project | Prefer simple, direct solutions |
| `MEDIUM` | Growing project with established patterns | Preserve consistency and manage dependencies |
| `ADVANCED` | Mature project with scale or compliance concerns | Require stronger technical validation |

### Update Rules

`PROJECT_CONTEXT.md` may be updated when a project-wide decision is discovered, either manually or during a later command such as `/spec-promote`.

`/spec-init` creates the file if it is missing. In normal codebase mode, it starts a read-only review to fill useful insights. If `PROJECT_CONTEXT.md` already exists, `/spec-init` asks for confirmation before appending a timestamped review section. Use `/spec-refresh` for intentional re-review later.

Do not add feature-specific implementation details.

---

## Commands

The extension should register the following pi slash commands with `pi.registerCommand()`.

### `/spec-init`

Initialize or repair SpecForge in the current repository.

Modes:

```bash
/spec-init
/spec-init --plan
```

Default codebase mode responsibilities:

1. Detect an existing SpecForge installation.
2. Create missing SpecForge folders and files.
3. Update `.gitignore` without removing existing entries.
4. Generate `specs/PROJECT_CONTEXT.md` if it does not exist.
5. Gather a bounded, read-only repository summary.
6. Ask the agent to review the project and update `PROJECT_CONTEXT.md` with technologies, libraries, tooling, coding style, architecture patterns, testing approach, conventions, constraints, and open questions.

Planning mode responsibilities:

1. Create or repair the same SpecForge folders and `.gitignore` entries.
2. Generate `PROJECT_CONTEXT.md` with `SESSION_TYPE` set to `planning` if it does not exist.
3. Skip codebase scanning and implementation-stack assumptions.

Non-responsibilities:

- Do not run `uv init` or create a UV project.
- Do not create `pyproject.toml`, `package.json`, or other application project files.
- Do not install dependencies.
- Do not run package-manager, framework, or language scaffolding commands.

`/spec-init` must be idempotent.

It may be executed safely:

- On a brand-new project.
- On an existing project.
- After cloning a repository.
- After a partial SpecForge installation.

For filesystem setup, it should create missing SpecForge assets only:

```text
specs/
specs/raw_specs/
specs/refined_specs/
specs/archived_specs/
specs/PROJECT_CONTEXT.md
```

Existing files must never be overwritten. If `PROJECT_CONTEXT.md` already exists, `/spec-init` should append a timestamped review only after user confirmation.

Recommended repository inspection is read-only and bounded. It may inspect file names and selected project files, but it must not mutate application code or project configuration.

---

### `/spec-refresh`

Refresh `specs/PROJECT_CONTEXT.md` from an intentional read-only project review.

```bash
/spec-refresh
```

Responsibilities:

1. Ensure the SpecForge file structure exists.
2. Gather a bounded repository summary.
3. Ask the agent to inspect additional relevant files if useful.
4. Update `PROJECT_CONTEXT.md` in place while preserving valuable manual notes.
5. Append a timestamped review summary.

Use `/spec-refresh` when the codebase has changed enough that project-level context may be stale.

Safety rules:

- Do not scaffold or initialize an application project.
- Do not install dependencies.
- Do not add feature-specific details.
- Keep the review read-only except for edits to `PROJECT_CONTEXT.md`.

---

### `/spec-new`

Create a new raw feature specification.

```bash
/spec-new semantic-search
```

Creates:

```text
specs/raw_specs/semantic-search.md
```

Template:

```md
# Feature Idea

## Problem

## Expected Behavior

## Notes
```

Rules:

- The feature id must be kebab-case.
- The command must refuse to overwrite an existing raw, refined, or archived spec with the same id.
- The command should initialize SpecForge first if required assets are missing.

---

### `/spec-refine`

Convert a raw feature idea into a refined specification.

```bash
/spec-refine semantic-search
```

Input:

```text
specs/raw_specs/semantic-search.md
```

Output:

```text
specs/refined_specs/semantic-search.md
```

Responsibilities:

- Read `PROJECT_CONTEXT.md`.
- Determine the project stage.
- Ask targeted clarification questions.
- Remove ambiguity.
- Detect over-engineering.
- Suggest simpler alternatives.
- Produce a refined specification using the feature specification template.

### Question Budget

| Project Stage | Maximum Questions |
| --- | ---: |
| `EARLY` | 5 |
| `MEDIUM` | 8 |
| `ADVANCED` | 12 |

If the raw idea is already clear, SpecForge may ask fewer questions.

If multiple features are detected, SpecForge should stop and recommend a split instead of refining a multi-feature specification.

---

### `/spec-review`

Review a refined specification for implementation readiness.

```bash
/spec-review semantic-search
```

Input:

```text
specs/refined_specs/semantic-search.md
```

Checks:

- Scope clarity.
- Missing requirements.
- Acceptance criteria.
- Security concerns.
- Data concerns.
- Scalability assumptions.
- Dependencies and blockers.
- Over-engineering risks.
- Whether the spec still represents exactly one feature.

Output:

- Review notes added to the refined spec.
- An implementation readiness score from `0/10` to `10/10`.
- A list of missing items, if any.

### Implementation Readiness Rubric

Readiness measures whether an implementation agent can begin work without another planning session.

| Criterion | Score |
| --- | ---: |
| Problem Defined | 1 |
| Scope Defined | 1 |
| Out of Scope Defined | 1 |
| Functional Requirements Defined | 2 |
| Acceptance Criteria Defined | 2 |
| Tasks Defined | 1 |
| Dependencies Defined | 1 |
| Technical Direction Defined | 1 |
| **Total** | **10** |

### Readiness Levels

| Score | Level | Result |
| ---: | --- | --- |
| `0–3` | Not Ready | Promotion denied |
| `4–6` | Needs Refinement | Promotion denied |
| `7` | Ready with Caution | Promotion denied by default |
| `8–10` | Implementation Ready | Promotion allowed |

---

### `/spec-promote`

Promote a reviewed specification into the archived source of truth.

```bash
/spec-promote semantic-search
```

Input:

```text
specs/refined_specs/semantic-search.md
```

Output:

```text
specs/archived_specs/semantic-search.md
```

Responsibilities:

1. Validate completeness.
2. Refuse promotion if readiness is below `8/10`.
3. Refuse promotion if blocking open questions remain.
4. Refuse promotion if the specification contains more than one feature.
5. Add or normalize metadata front matter.
6. Move the file into `archived_specs/`.
7. Update `PROJECT_CONTEXT.md` only when project-wide decisions were introduced.

Promotion is allowed only when:

- `readiness_score >= 8`.
- No blocking open questions exist.
- Acceptance criteria are defined.
- Tasks are scoped and actionable.
- The specification represents exactly one feature.

---

### `/spec-prioritize`

Analyze archived specifications that are not completed and recommend implementation order.

```bash
/spec-prioritize
```

Responsibilities:

- Read all files in `specs/archived_specs/`.
- Ignore specs with `status: completed`.
- Recalculate priority suggestions.
- Detect blockers.
- Recommend the next feature to implement.

Example output:

```text
Recommended Next Feature

oauth-authentication

Reason:
- High priority
- Blocks 3 features
- Small implementation effort
```

---

### `/spec-start`

Begin implementation of a promoted feature.

```bash
/spec-start semantic-search
```

Input:

```text
specs/archived_specs/semantic-search.md
```

Responsibilities:

1. Verify the spec has `status: ready`.
2. Update metadata to `status: in_progress`.
3. Set `started_at` if empty.
4. Generate an implementation handoff prompt.
5. Send the handoff to pi for implementation.

Important rule:

> Planning is complete. No additional discovery should occur during implementation unless the archived specification explicitly allows it.

The implementation agent must follow:

- Scope.
- Out of Scope.
- Tasks.
- Acceptance Criteria.

Example metadata update:

```yaml
status: in_progress
started_at: 2026-06-16
```

---

### `/spec-complete`

Mark implementation as completed.

```bash
/spec-complete semantic-search
```

Responsibilities:

1. Verify the archived spec exists.
2. Confirm the feature is implemented.
3. Update metadata to `status: completed`.
4. Set `completed_at`.

Example metadata update:

```yaml
status: completed
completed_at: 2026-06-18
```

---

### `/spec-status`

Generate a project summary from archived specifications.

```bash
/spec-status
```

Example output:

```text
TOTAL FEATURES: 15

READY: 4
IN PROGRESS: 2
BLOCKED: 1
COMPLETED: 8

COMPLETION: 53%
```

The status report should show:

- Total archived features.
- Counts by status.
- Blocked work.
- Remaining work.
- Recommended next feature.

---

## Feature Specification Template

Every refined and archived specification should follow this structure.

```md
## Problem Statement

## Scope

## Out of Scope

## User Story

## Functional Requirements

## Technical Requirements

## Dependencies

## Tasks

### Task 1

### Task 2

### Task 3

## Acceptance Criteria

## Risks

## Future Improvements

## Implementation Readiness

### Score Breakdown

| Criterion | Score |
| --- | ---: |
| Problem Defined | 0/1 |
| Scope Defined | 0/1 |
| Out of Scope Defined | 0/1 |
| Functional Requirements Defined | 0/2 |
| Acceptance Criteria Defined | 0/2 |
| Tasks Defined | 0/1 |
| Dependencies Defined | 0/1 |
| Technical Direction Defined | 0/1 |

### Total Score

0/10

### Missing Before Implementation

- Missing item 1
- Missing item 2
```

---

## Archived Specification Metadata

Every archived specification must contain YAML front matter.

```yaml
---
id: semantic-search
status: ready
priority: high
readiness_score: 9
depends_on:
  - oauth-authentication
created_at: 2026-06-16
started_at:
completed_at:
---
```

### Status Values

| Status | Meaning |
| --- | --- |
| `ready` | Approved and ready for implementation |
| `in_progress` | Implementation has started |
| `blocked` | Cannot proceed until dependencies or questions are resolved |
| `completed` | Implementation is complete |

### Priority Values

| Priority | Meaning |
| --- | --- |
| `high` | Important, urgent, or blocks other work |
| `medium` | Valuable but not immediately blocking |
| `low` | Nice-to-have or future improvement |

---

## Source of Truth

Archived specifications are the source of truth.

All project progress is derived from:

```text
specs/archived_specs/
```

No external database is required.

Future integrations such as Azure DevOps, Jira, or GitHub Issues should be generated from archived specifications instead of replacing them.

---

## pi Extension Implementation Guide

SpecForge should be implemented as a TypeScript pi extension.

Recommended project-local layout:

```text
.pi/extensions/spec-forge/
└── index.ts
```

Recommended repository layout while developing this extension:

```text
spec-forge/
├── README.md
└── index.ts
```

For quick local testing:

```bash
pi -e ./spec-forge/index.ts
```

For project-local auto-discovery:

```bash
mkdir -p .pi/extensions/spec-forge
cp spec-forge/index.ts .pi/extensions/spec-forge/index.ts
```

Then run this inside pi:

```text
/reload
```

For global auto-discovery:

```bash
mkdir -p ~/.pi/agent/extensions/spec-forge
cp spec-forge/index.ts ~/.pi/agent/extensions/spec-forge/index.ts
```

Then run this inside pi:

```text
/reload
```

### Extension Responsibilities

The extension should:

- Register slash commands with `pi.registerCommand()`.
- Use Node file APIs to create, move, and update specification files.
- Keep `/spec-init` and `/spec-refresh` read-only with respect to application files; they must not scaffold application projects or package-manager projects.
- Use `ctx.ui` for confirmations and guided questions when UI is available.
- Use `pi.sendUserMessage()` when a command needs the agent to perform reasoning or generate a refined document.
- Avoid long-lived background resources.
- Avoid overwriting user content without confirmation.
- Keep archived specifications as the only durable source of truth.

### Command Registration Sketch

```ts
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function (pi: ExtensionAPI) {
  pi.registerCommand("spec-init", {
    description: "Initialize SpecForge and create PROJECT_CONTEXT.md insights",
    handler: async (args, ctx) => {
      // /spec-init creates the spec structure and starts a read-only context review.
      // /spec-init --plan creates planning-session context and skips codebase scanning.
      // Do not run uv/npm/pnpm/yarn or create application project files.
      ctx.ui.notify("SpecForge initialized", "info");
    },
  });

  pi.registerCommand("spec-refresh", {
    description: "Refresh PROJECT_CONTEXT.md from a read-only project review",
    handler: async (_args, ctx) => {
      // Gather project summary and ask pi to update PROJECT_CONTEXT.md.
    },
  });

  pi.registerCommand("spec-new", {
    description: "Create a raw SpecForge feature idea",
    handler: async (args, ctx) => {
      // Validate feature id and create specs/raw_specs/<id>.md.
    },
  });

  pi.registerCommand("spec-refine", {
    description: "Refine a raw feature idea into an implementation-ready specification",
    handler: async (args, ctx) => {
      // Read raw spec and project context, ask questions, then send a guided prompt to pi.
      pi.sendUserMessage(`Refine the SpecForge feature spec: ${args}`);
    },
  });
}
```

### Recommended Command Strategy

Use deterministic file operations for commands that only move or update files:

- `/spec-new`
- `/spec-promote` after validation
- `/spec-start` metadata updates
- `/spec-complete`
- `/spec-status`

Use deterministic setup plus agent assistance for project-context commands:

- `/spec-init`
- `/spec-init --plan`
- `/spec-refresh`

Use the agent for reasoning-heavy commands:

- `/spec-refine`
- `/spec-review`
- `/spec-prioritize`
- Implementation handoff generated by `/spec-start`

### Safety Rules for the Extension

- Never overwrite an existing spec unless the user confirms.
- Never promote a spec with readiness below `8/10`.
- Never silently delete raw or refined specs; moving to archive is allowed only during promotion.
- Never add raw or refined specs to git tracking by default.
- Never update `PROJECT_CONTEXT.md` with feature-only details.
- Never use `/spec-init` or `/spec-refresh` to scaffold projects or install dependencies.
- If command arguments are missing, show usage and ask for the missing value.
- If `ctx.hasUI` is false, avoid interactive prompts and print actionable instructions instead.

---

## Future Extensions

Possible future commands:

```bash
/spec-export-azure
/spec-export-jira
/spec-export-github
/spec-plan
```

These commands should consume archived specifications and create project-management artifacts automatically.
