# pi-extensions

Useful pi extensions that fit my workflow and hopefully support yours. 🫡

## Extensions

### SpecForge

`spec-forge/` contains a pi extension for a specification-first feature workflow.

SpecForge helps turn raw feature ideas into reviewed, implementation-ready specifications before handing work to a coding agent. `/spec-new` prefixes a unique short id to each spec name, and `/spec-init` asks for project maturity before preparing SpecForge context plus a `SPEC_TRACKING.md` dashboard from a read-only project review. `/spec-init --plan` supports planning-only sessions, and `/spec-refresh` preserves planning mode instead of converting it to a codebase. Refined specs use numeric agile-style Priority, Effort, and Business Value. Neither mode scaffolds a UV or application project, and all SpecForge files may be tracked with git.

See [`spec-forge/README.md`](spec-forge/README.md) for the full workflow and implementation guide.

#### Commands

- `/spec-init [--plan]`
- `/spec-refresh`
- `/spec-new <spec-name>`
- `/spec-refine <generated-feature-id>`
- `/spec-review <generated-feature-id>`
- `/spec-fix <generated-feature-id>`
- `/spec-promote <generated-feature-id>`
- `/spec-prioritize`
- `/spec-start <generated-feature-id>`
- `/spec-complete <generated-feature-id>`
- `/spec-status`

#### Try it locally

```bash
pi -e ./spec-forge/index.ts
```

Then run inside pi:

```text
/spec-init
```
