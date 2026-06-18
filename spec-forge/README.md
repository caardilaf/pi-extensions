# SpecForge

SpecForge is a **pi extension** for specification-first feature work. It turns raw ideas into small, reviewed, implementation-ready specs before handing them to a coding agent.

Core rule:

> **ONE SPEC = ONE FEATURE**

If an idea contains multiple features, split it before refinement.

---

## Workflow

```text
Raw Idea
   │
   ▼
/spec-new <spec-name>
   │
   ▼
specs/raw_specs/<generated-feature-id>.md
   │
   ▼
/spec-refine <generated-feature-id>
   │
   ▼
specs/refined_specs/<generated-feature-id>.md
   │
   ▼
/spec-review <generated-feature-id>
   │
   ▼
Readiness score + comments in "Missing Before Implementation"
   │
   ├── if not ready ──► /spec-fix <generated-feature-id> ──► /spec-review <generated-feature-id>
   │
   ▼
/spec-promote <generated-feature-id>
   │
   ▼
specs/archived_specs/<generated-feature-id>.md
   │
   ▼
/spec-start <generated-feature-id>
   │
   ▼
Implementation handoff to pi
   │
   ▼
Implementation work
   │
   ▼
/spec-complete <generated-feature-id>
```

Optional anytime:

```text
/spec-status
/spec-prioritize
/spec-refresh
```

---

## Files

SpecForge stores all state in Markdown:

```text
specs/
├── PROJECT_CONTEXT.md
├── SPEC_TRACKING.md
├── raw_specs/
├── refined_specs/
└── archived_specs/
```

All SpecForge files may be tracked by git. `/spec-init` does not scaffold application projects, install dependencies, or create app config files.

---

## Project Context

`specs/PROJECT_CONTEXT.md` contains project-wide memory used during refinement and review:

- `SESSION_TYPE`: `codebase` or `planning`
- `STAGE`: `EARLY`, `MEDIUM`, or `ADVANCED`
- stack, tooling, frameworks, architecture, style, testing, constraints, open questions, principles

Project maturity:

| Stage | Meaning | Planning style |
| --- | --- | --- |
| `EARLY` | New/small project | Prefer simple direct solutions |
| `MEDIUM` | Growing project with patterns | Preserve consistency and dependencies |
| `ADVANCED` | Mature/scale/compliance/complexity | Require stronger validation |

`/spec-init` and `/spec-refresh` ask for maturity and update `## STAGE`.

Planning-only workspaces use `SESSION_TYPE: planning`. `/spec-refresh` must preserve planning mode and must not convert it to `codebase`.

---

## Commands

### `/spec-init [--plan]`

Creates or repairs SpecForge structure and tracking.

- Default mode: initializes for a codebase, asks for maturity, performs a bounded read-only project review, and updates `PROJECT_CONTEXT.md`.
- `--plan`: initializes planning-only mode, asks for maturity, skips codebase scanning and implementation-stack assumptions.
- Existing files are not overwritten.
- Existing `PROJECT_CONTEXT.md` is appended to only after confirmation.

### `/spec-refresh`

Refreshes `PROJECT_CONTEXT.md` from an intentional read-only review.

- Asks for maturity and updates `## STAGE`.
- Preserves manual notes.
- Appends a timestamped review summary.
- Preserves `SESSION_TYPE: planning` for planning-only repositories.
- Does not modify application files.

### `/spec-new <spec-name>`

Creates `specs/raw_specs/<generated-feature-id>.md` from a human-readable feature name and updates tracking to `📝 Raw`.

Example:

```text
/spec-new semantic-search
# creates specs/raw_specs/a1b2c3-semantic-search.md
```

### `/spec-refine <generated-feature-id>`

Turns a raw idea into a refined spec in `specs/refined_specs/`.

The agent should:

- act as a technical product owner;
- enforce one feature per spec;
- ask targeted clarification questions based on maturity;
- define numeric Priority (1-4), Effort, and Business Value;
- create actionable tasks;
- use the feature spec template;
- update tracking to `🔧 Refined`.

Question budget:

| Maturity | Max questions |
| --- | ---: |
| `EARLY` | 5 |
| `MEDIUM` | 8 |
| `ADVANCED` | 12 |

### `/spec-review <generated-feature-id>`

Reviews a refined spec for implementation readiness.

Important rule:

> `/spec-review` **must not rewrite or fix the refined story/spec content**. It only updates the `Implementation Readiness` section and puts comments/actionable gaps under `### Missing Before Implementation`.

Checks include scope, requirements, numeric planning fields, tasks, acceptance criteria, security/data/scalability concerns, dependencies, blockers, over-engineering, and one-feature scope.

Promotion requires readiness score `>= 8/10` and no blocking open questions.

### `/spec-fix <generated-feature-id>`

Applies `/spec-review` feedback to the refined spec.

The agent should:

- implement every actionable item in `Missing Before Implementation`;
- update the relevant refined spec sections;
- preserve one-feature scope;
- ensure numeric Priority (1-4), Effort, Business Value, tasks, and acceptance criteria are complete;
- replace resolved missing items with `- None`;
- not promote, move, or run review automatically.

After fixing, run `/spec-review <id>` again.

### `/spec-promote <generated-feature-id>`

Moves a reviewed refined spec into `specs/archived_specs/` and adds metadata.

Promotion is denied unless:

- readiness score is `>= 8/10`;
- `Missing Before Implementation` is empty/`None`;
- numeric Priority (1-4), Effort, and Business Value are present;
- acceptance criteria exist;
- at least one task exists;
- every task has numeric Priority (1-4), Effort, Business Value, and Description;
- the spec represents exactly one feature.

Updates tracking to `✅ Approved`.

### `/spec-prioritize`

Reads open archived specs and recommends implementation order using priority, business value, effort, blockers, status, and readiness.

### `/spec-start <generated-feature-id>`

Starts implementation of an archived spec.

- Requires `status: ready`.
- Updates metadata to `status: in_progress` and sets `started_at`.
- Sends an implementation handoff to pi.

Implementation must follow the archived spec’s Scope, Out of Scope, Tasks, and Acceptance Criteria. No extra discovery unless explicitly allowed by the spec.

### `/spec-complete <generated-feature-id>`

Marks an archived spec completed, sets `completed_at`, and updates tracking to `🎉 Completed`.

### `/spec-status`

Shows archived feature totals, counts by status, completion percentage, blocked work, remaining work, and recommended next feature.

---

## Feature Spec Template

Every refined/archived spec should follow this structure:

```md
## Problem Statement

## Priority
Numeric priority score (1-4):

## Effort
Story points (1, 2, 3, 5, 8, 13):

## Business Value
Numeric business value score (1-10):

## Scope

## Out of Scope

## User Story

## Functional Requirements

## Technical Requirements

## Dependencies

## Tasks

### Task 1

- Priority (1-4):
- Effort (story points):
- Business Value (1-10):
- Description:

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
| Tasks Defined with Numeric Priority/Effort/Business Value | 0/1 |
| Dependencies Defined | 0/1 |
| Technical Direction Defined | 0/1 |

### Total Score

0/10

### Missing Before Implementation

- Missing item 1
```

Readiness levels:

| Score | Level | Result |
| ---: | --- | --- |
| `0–3` | Not Ready | Promotion denied |
| `4–6` | Needs Refinement | Promotion denied |
| `7` | Ready with Caution | Promotion denied by default |
| `8–10` | Implementation Ready | Promotion allowed |

---

## Archived Spec Metadata

Archived specs must have YAML front matter:

```yaml
---
id: a1b2c3-semantic-search
status: ready
priority: 3
readiness_score: 9
depends_on:
  - d4e5f6-oauth-authentication
created_at: 2026-06-16
started_at:
completed_at:
---
```

Status values:

| Status | Meaning |
| --- | --- |
| `ready` | Approved and ready for implementation |
| `in_progress` | Implementation started |
| `blocked` | Waiting on dependencies/questions |
| `completed` | Implementation complete |

Numeric planning fields:

| Field | Scale | Meaning |
| --- | --- | --- |
| `priority` / Priority | `1–4` | Urgency/order signal; `4` highest |
| Effort | story points such as `1,2,3,5,8,13` | Relative size/complexity |
| Business Value | `1–10` | Expected impact; `10` highest |

---

## Development / Loading

Recommended local layout:

```text
spec-forge/
├── README.md
└── index.ts
```

Run locally:

```bash
pi -e ./spec-forge/index.ts
```

Project-local auto-discovery:

```bash
mkdir -p .pi/extensions/spec-forge
cp spec-forge/index.ts .pi/extensions/spec-forge/index.ts
```

Global auto-discovery:

```bash
mkdir -p ~/.pi/agent/extensions/spec-forge
cp spec-forge/index.ts ~/.pi/agent/extensions/spec-forge/index.ts
```

Then run inside pi:

```text
/reload
```

---

## Extension Safety Rules

- Never overwrite user content without confirmation.
- Never promote readiness below `8/10`.
- Never silently delete raw/refined specs.
- Never scaffold projects or install dependencies from `/spec-init` or `/spec-refresh`.
- Never update `PROJECT_CONTEXT.md` with feature-only details.
- Keep archived specs as the durable source of truth.
- Use `SPEC_TRACKING.md` only as a human-friendly dashboard.
