# pi-extensions

Useful pi extensions that fit my workflow and hopefully support yours. 🫡

## Extensions

### SpecForge

`spec-forge/` contains a pi extension for a specification-first feature workflow. It helps you plan one feature at a time: create an idea, refine it, review it, fix gaps, approve it, and hand it off for implementation. It keeps the process in Markdown files, supports planning-only sessions, uses numeric agile-style planning fields, and never scaffolds or installs application dependencies.

See [`spec-forge/README.md`](spec-forge/README.md) for the full workflow and implementation guide.

#### Commands

- `/spec-init [--plan]` initialize SpecForge context and tracking, optionally planning-only.
- `/spec-refresh` refresh project context without changing planning-only workspaces to codebase mode.
- `/spec-new <spec-name>` create a raw feature idea with a generated id.
- `/spec-refine <generated-feature-id>` turn a raw idea into a one-feature refined spec.
- `/spec-review <generated-feature-id>` score readiness and add review gaps to `Missing Before Implementation`.
- `/spec-fix <generated-feature-id>` apply review gaps before running review again.
- `/spec-promote <generated-feature-id>` approve a ready refined spec into archived specs.
- `/spec-prioritize` recommend implementation order for approved specs.
- `/spec-start <generated-feature-id>` start implementation from an approved spec.
- `/spec-complete <generated-feature-id>` mark an implemented spec as complete.
- `/spec-status` show archived spec progress and recommended next work.

#### Try it locally

```bash
pi -e ./spec-forge/index.ts
```

Then run inside pi:

```text
/spec-init
```
