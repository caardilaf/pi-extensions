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
/spec-refine [generated-feature-id]
   │
   ▼
specs/refined_specs/<generated-feature-id>.md
   │
   ▼
/spec-review [generated-feature-id]
   │
   ▼
Readiness score + TODOs/fix recommendations in "Missing Before Implementation"
   │
   ├── if not ready ──► /spec-fix [generated-feature-id] [fix-context-comment] ──► /spec-review [generated-feature-id]
   │
   ▼
/spec-promote [generated-feature-id]
   │
   ▼
specs/archived_specs/<generated-feature-id>.md
   │
   ├── optional Azure DevOps export ──► /spec-export-azure <parent-feature-id> [generated-feature-id-or-search]
   │
   ▼
/spec-start [generated-feature-id]
   │
   ▼
Implementation handoff to pi
   │
   ▼
Implementation work
   │
   ▼
/spec-complete [generated-feature-id]
```

Optional commands:

```text
/spec-status
/spec-prioritize
/spec-refresh  # codebase workspaces only
/spec-export-azure <parent-feature-id> [generated-feature-id-or-search]  # after promotion
/spec-azure-import <product-backlog-item-id>  # import an Azure PBI/User Story back into archived_specs
```

For commands shown with `[generated-feature-id]`, the id is optional in the TUI. If omitted, SpecForge lists selectable specs from the relevant workflow stage. For `/spec-fix`, any text after the id is treated as an optional fix context comment; in the TUI, SpecForge prompts for that optional context after the spec is selected. For `/spec-export-azure`, the parent Feature id is always required, but the spec id/search term is optional in the TUI.

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

`/spec-init` creates missing artifacts and performs the initial project context review only once in default codebase mode. `/spec-refresh` asks for maturity and updates `## STAGE` on later codebase reviews.

Planning-only workspaces use `SESSION_TYPE: planning`. `/spec-init --plan` is project-agnostic and does not scan for project information. `/spec-refresh` is intentionally disabled for planning-only workspaces because there is no implementation codebase to review.

---

## Commands

### `/spec-init [--plan]`

Creates missing SpecForge structure and tracking. In default codebase mode, it performs a one-time read-only project review when `PROJECT_CONTEXT.md` is newly created.

- If all SpecForge artifacts already exist, reports that the project was created before and stops.
- Default mode: creates codebase-mode `PROJECT_CONTEXT.md` only for a new/missing context file.
- `--plan`: creates planning-mode `PROJECT_CONTEXT.md` only for a new/missing context file and skips project scanning/context review.
- Existing files are not overwritten or refreshed.
- Initial context review captures stack, tooling, architecture, style, testing approach, constraints, and open questions only when running `/spec-init` without `--plan`.
- Use `/spec-refresh` to update project context, maturity, or repository insights after codebase initialization.
- Do not use `/spec-refresh` for planning-only workspaces created with `--plan`; update planning assumptions through normal spec refinement instead.

### `/spec-refresh`

Refreshes `PROJECT_CONTEXT.md` from an intentional read-only codebase review.

- Only applies to codebase workspaces.
- Exits without changes when `SESSION_TYPE: planning` is active.
- Asks for maturity and updates `## STAGE`.
- Preserves manual notes.
- Appends a timestamped review summary.
- Does not modify application files.

### `/spec-new <spec-name>`

Creates `specs/raw_specs/<generated-feature-id>.md` from a human-readable feature name and updates tracking to `📝 Raw`.

Example:

```text
/spec-new semantic-search
# creates specs/raw_specs/a1b2c3-semantic-search.md
```

### `/spec-refine [generated-feature-id]`

Turns a raw idea into a refined spec in `specs/refined_specs/`. In the TUI, omit the id to select from available files in `specs/raw_specs/`.

The agent should:

- act as a technical product owner;
- enforce one feature per spec;
- ask mandatory targeted clarification questions based on maturity before drafting;
- define feature-level numeric Priority (1-4), Effort, and Business Value;
- create actionable tasks with headings like `### Task 1: Short task title` and task-level Priority, numeric Estimated Work, and Description;
- use the feature spec template;
- leave Implementation Readiness unscored except for the Score Breakdown scaffold; `/spec-review` certifies and populates readiness;
- update tracking to `🔧 Refined`.

Mandatory clarification budget:

| Maturity | Required questions |
| --- | ---: |
| `EARLY` | 3-5 |
| `MEDIUM` | 5-8 |
| `ADVANCED` | 8-12 |

The first `/spec-refine` response must ask the required questions and wait for answers before writing the refined spec. Questions should include suggested options/tradeoffs and cover missing product, data/storage, technology, integration, security/privacy, acceptance, and delivery decisions as applicable.

### `/spec-review [generated-feature-id]`

Reviews a refined spec for implementation readiness. In the TUI, omit the id to select from available files in `specs/refined_specs/`.

Important rule:

> `/spec-review` **must not rewrite or fix the refined story/spec content**. It only updates the `Implementation Readiness` section: it certifies/populates the Score Breakdown, adds `### Total Score`, and puts only actionable TODOs/fix recommendations under `### Missing Before Implementation`. If there are no actionable fixes, it writes `None`.

Checks include scope, requirements, numeric planning fields, titled tasks, acceptance criteria, security/data/scalability concerns, dependencies, blockers, over-engineering, and one-feature scope.

Promotion requires Total Score/readiness score `>= 8/10`. TODOs/fix recommendations under `Missing Before Implementation` are advisory for promotion; blocking concerns should be reflected in the score.

### `/spec-fix [generated-feature-id] [fix-context-comment]`

Applies `/spec-review` feedback to the refined spec. In the TUI, omit the id to select from available files in `specs/refined_specs/`. SpecForge also accepts an optional additional context comment after the id, or prompts for one in the TUI, so the developer can suggest constraints or context for the fix.

The agent should:

- implement every actionable item in `Missing Before Implementation`;
- use the developer-provided fix context only when it is consistent with one-feature scope and the reviewed scope;
- update the relevant refined spec sections;
- preserve one-feature scope;
- ensure feature-level numeric Priority (1-4), Effort, Business Value, titled tasks with Priority/numeric Estimated Work/Description, and acceptance criteria are complete;
- not calculate or certify readiness scores;
- replace resolved missing items with `- None` or reset readiness to the unreviewed Score Breakdown scaffold;
- not promote, move, or run review automatically.

Example:

```text
/spec-fix a1b2c3-semantic-search preserve the existing public API and prefer SQLite-backed storage
```

After fixing, run `/spec-review <id>` again.

### `/spec-promote [generated-feature-id]`

Moves a reviewed refined spec into `specs/archived_specs/` and adds metadata. In the TUI, omit the id to select from available files in `specs/refined_specs/`.

Promotion is denied unless:

- Total Score/readiness score is `>= 8/10`;
- numeric Priority (1-4), Effort, and Business Value are present;
- acceptance criteria exist;
- at least one task exists;
- every task has a heading title (for example `### Task 1: Create the API`), numeric Priority (1-4), numeric Estimated Work, and Description;
- the spec represents exactly one feature.

Updates tracking to `✅ Approved`.

### `/spec-prioritize`

Reads open archived specs and recommends implementation order using priority, business value, effort, blockers, status, and readiness.

### `/spec-export-azure <parent-feature-id> [generated-feature-id-or-search]`

Exports one archived specification to Azure DevOps as a User Story, then creates each spec task as an Azure Task parented to that User Story.

- Requires Azure CLI login first: `az login`; if login is missing, the command stops and suggests logging in.
- Requires the Azure DevOps CLI extension/defaults to be available for the target organization/project, for example `az devops configure --defaults organization=https://dev.azure.com/<org> project=<project>`.
- The first argument is required and must be the Azure Feature work item id that will parent the new User Story.
- The Feature parent must exist and must be a `Feature` work item.
- If the spec argument is omitted in the TUI, SpecForge lists selectable specs from `specs/archived_specs/`.
- The spec argument may be a generated id or a unique search term from the archived spec title/id.
- Existing child User Stories/Tasks with matching titles are not reused. The export fails instead of creating duplicate child items under the same parent.
- Task titles must be unique, and each task must have numeric Estimated Work so Azure Remaining Work can be set after creation.
- New User Stories and Tasks inherit the parent Feature's Area path.
- User Story field mapping:
  - Description: spec summary sections such as problem, user story, scope, requirements, dependencies, risks, future improvements, and Implementation Readiness.
  - Acceptance Criteria: spec `Acceptance Criteria` section.
  - Details: Priority, Effort, and Business Value.
- Task field mapping:
  - Title: task heading title, for example `Task 1: Create the API`.
  - Description: task `Description` via `az boards work-item update --description` (`System.Description`).
  - Priority: task `Priority`.
  - Remaining Work: task `Estimated Work` from the spec is applied after task creation via `az boards work-item update --fields Microsoft.VSTS.Scheduling.RemainingWork=...`.
  - Task export intentionally does not use task Effort or Business Value; those planning fields apply to the User Story/spec level only.
  - Area: parent Feature's Area path.

Example:

```text
/spec-export-azure 556547 memoization
```

### `/spec-azure-import <product-backlog-item-id>`

Imports a SpecForge-created Azure DevOps Product Backlog Item/User Story back into `specs/archived_specs/` and reconstructs the archived Markdown schema.

- Requires Azure CLI login first: `az login`; if login is missing, the command stops and suggests logging in.
- Requires the Azure DevOps CLI extension/defaults to be available for the target organization/project.
- The argument must be the Azure Product Backlog Item/User Story id created by `/spec-export-azure`.
- The work item description must contain a `SpecForge ID`; otherwise the command reports that the User Story was not created under the SpecForge framework.
- Imports User Story/Product Backlog Item fields such as Priority, Effort, Business Value, Acceptance Criteria, Description sections, Implementation Readiness, and Area context.
- Imports child Azure Tasks as SpecForge `## Tasks`, using Azure Task title, description, priority, and Remaining Work as the task Estimated Work value.
- Writes `specs/archived_specs/<SpecForge ID>.md` and updates SpecForge tracking to `✅ Approved`.
- If the archived spec already exists, existing SpecForge metadata/readiness is preserved where Azure does not store it.

Example:

```text
/spec-azure-import 66583
```

### `/spec-start [generated-feature-id]`

Starts implementation of an archived spec. In the TUI, omit the id to select from ready specs in `specs/archived_specs/`.

- Requires `status: ready`.
- Updates metadata to `status: in_progress` and sets `started_at`.
- Sends an implementation handoff to pi.

Implementation must follow the archived spec’s Scope, Out of Scope, Tasks, and Acceptance Criteria. No extra discovery unless explicitly allowed by the spec.

### `/spec-complete [generated-feature-id]`

Marks an archived spec completed, sets `completed_at`, and updates tracking to `🎉 Completed`. In the TUI, omit the id to select from in-progress specs in `specs/archived_specs/`.

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

### Task 1: Short task title

- Priority (1-4):
- Estimated Work:
- Description:

## Acceptance Criteria

## Risks

## Future Improvements

## Implementation Readiness

### Score Breakdown

| Criterion | Score |
| --- | ---: |
| Problem Defined | Not reviewed |
| Scope Defined | Not reviewed |
| Out of Scope Defined | Not reviewed |
| Functional Requirements Defined | Not reviewed |
| Acceptance Criteria Defined | Not reviewed |
| Tasks Defined with Titles and Numeric Priority/Estimated Work/Description | Not reviewed |
| Dependencies Defined | Not reviewed |
| Technical Direction Defined | Not reviewed |

<!-- /spec-review certifies readiness by replacing the unrated breakdown with scores, adding ### Total Score, and adding ### Missing Before Implementation with only actionable TODOs/fix recommendations, or None when there are no fixes. -->
```

Readiness levels after `/spec-review`:

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
| Effort | story points such as `1,2,3,5,8,13` | Relative feature/User Story size or complexity |
| Business Value | `1–10` | Feature/User Story impact; `10` highest |
| Task Estimated Work | numeric hours estimate | Source value for Azure Task Remaining Work; task items do not use Effort, Business Value, or Original Estimate |

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
