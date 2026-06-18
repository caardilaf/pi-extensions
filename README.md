# pi-extensions

Useful pi extensions that fit my workflow and hopefully support yours. 🫡

## Extensions

### SpecForge

`spec-forge/` contains a pi extension for a specification-first feature workflow.

SpecForge helps turn raw feature ideas into reviewed, implementation-ready specifications before handing work to a coding agent. `/spec-init` prepares SpecForge context from a read-only project review, while `/spec-init --plan` supports planning-only sessions; neither scaffolds a UV or application project.

See [`spec-forge/README.md`](spec-forge/README.md) for the full workflow and implementation guide.

#### Commands

- `/spec-init [--plan]`
- `/spec-refresh`
- `/spec-new <feature-id>`
- `/spec-refine <feature-id>`
- `/spec-review <feature-id>`
- `/spec-promote <feature-id>`
- `/spec-prioritize`
- `/spec-start <feature-id>`
- `/spec-complete <feature-id>`
- `/spec-status`

#### Try it locally

```bash
pi -e ./spec-forge/index.ts
```

Then run inside pi:

```text
/spec-init
```
