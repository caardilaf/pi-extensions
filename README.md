# pi-extensions

Useful pi extensions that fit my workflow and hopefully support yours. 🫡

## Extensions

### SpecForge

`spec-forge/` contains a pi extension for a specification-first feature workflow. It helps you plan one feature at a time: create an idea, refine it, review it, fix gaps, approve it, optionally export it to Azure DevOps, and hand it off for implementation. It keeps the process in Markdown files, supports planning-only sessions, uses numeric agile-style planning fields, and never scaffolds or installs application dependencies.

See [`spec-forge/README.md`](spec-forge/README.md) for the full workflow and implementation guide.

#### Commands

- `/spec-init [--plan]` initialize SpecForge artifacts if missing; default mode runs the one-time initial project context review, while `--plan` creates planning-mode context for new workspaces and skips project scanning.
- `/spec-refresh` refresh project context for codebase workspaces; exits without changes for planning-only workspaces.
- `/spec-new <spec-name>` create a raw feature idea with a generated id.
- `/spec-refine [generated-feature-id]` ask mandatory maturity-based clarification questions, then turn a raw idea into a one-feature refined spec with titled tasks; omit the id in the TUI to select from raw specs. Readiness stays unscored until review.
- `/spec-review [generated-feature-id]` certify/populate readiness and add review gaps to `Missing Before Implementation`; omit the id to select from refined specs.
- `/spec-fix [generated-feature-id]` apply review gaps before running review again; omit the id to select from refined specs.
- `/spec-promote [generated-feature-id]` approve a ready refined spec into archived specs; omit the id to select from refined specs.
- `/spec-prioritize` recommend implementation order for approved specs.
- `/spec-export-azure <parent-feature-id> [generated-feature-id-or-search]` export an archived spec to Azure DevOps as a new User Story with child Tasks using spec task titles as Azure Task titles; duplicate child titles fail instead of being reused, and task Estimated Work is applied to Azure Remaining Work; requires `az login` and a valid parent Feature id.
- `/spec-start [generated-feature-id]` start implementation from an approved spec; omit the id to select from ready archived specs.
- `/spec-complete [generated-feature-id]` mark an implemented spec as complete; omit the id to select from in-progress archived specs.
- `/spec-status` show archived spec progress and recommended next work.

#### Try it locally

```bash
pi -e ./spec-forge/index.ts
```

Then run inside pi:

```text
/spec-init
```
