import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { randomBytes } from "node:crypto";
import { access, mkdir, readFile, readdir, rename, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";

function buildRawTemplate(title: string): string {
  return `# ${title}

## Problem

## Expected Behavior

## Notes
`;
}

const SPEC_TEMPLATE = `## Problem Statement

## Priority

## Effort

## Business Value

## Scope

## Out of Scope

## User Story

## Functional Requirements

## Technical Requirements

## Dependencies

## Tasks

### Task 1

- Priority:
- Estimated work:
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
| Tasks Defined with Priority/Estimated Work | 0/1 |
| Dependencies Defined | 0/1 |
| Technical Direction Defined | 0/1 |

### Total Score

0/10

### Missing Before Implementation

- Missing item 1
- Missing item 2
`;

type Stage = "EARLY" | "MEDIUM" | "ADVANCED";
type Priority = "high" | "medium" | "low";
type SpecStatus = "ready" | "in_progress" | "blocked" | "completed";

type SpecPaths = {
  root: string;
  specs: string;
  context: string;
  tracking: string;
  raw: string;
  refined: string;
  archived: string;
  gitignore: string;
};

type SpecMetadata = {
  id?: string;
  status?: SpecStatus | string;
  priority?: Priority | string;
  readiness_score?: string;
  depends_on?: string[];
  created_at?: string;
  started_at?: string;
  completed_at?: string;
};

type ArchivedSpec = {
  id: string;
  file: string;
  content: string;
  metadata: SpecMetadata;
};

type InitMode = "codebase" | "planning";
type ContextUpdateMode = "created" | "append" | "refresh";
type TrackingStatus = "raw" | "refined" | "approved" | "completed";

type TrackingEntry = {
  id: string;
  title: string;
  description: string;
  status: TrackingStatus;
  updated: string;
};

type ProjectScanSummary = {
  topLevelEntries: string[];
  files: string[];
  notableFiles: string[];
  snippets: Array<{ path: string; content: string }>;
};

export default function (pi: ExtensionAPI) {
  pi.registerMessageRenderer("spec-forge", (message, _options, theme) => {
    const title = theme.fg("accent", theme.bold("SpecForge"));
    return new Text(`${title}\n${String(message.content)}`, 0, 0);
  });

  pi.registerCommand("spec-init", {
    description: "Initialize SpecForge and create PROJECT_CONTEXT.md insights",
    handler: async (args, ctx) => {
      const mode = parseInitMode(args);
      if (!mode) return showUsage(ctx, "/spec-init [--plan]");

      const paths = getSpecPaths(ctx.cwd);
      const contextExisted = await exists(paths.context);
      const result = await initializeSpecForge(ctx, { mode });

      if (mode === "planning") {
        if (contextExisted) {
          const content = await readFile(paths.context, "utf8").catch(() => "");
          if (!isPlanningContext(content)) {
            const updated = await confirmContextAppend(ctx, "Mark existing PROJECT_CONTEXT.md as a planning session?");
            if (updated) {
              await markPlanningContext(paths.context);
              result.push(`Marked ${paths.context} as a planning session`);
            } else {
              result.push(`Kept existing ${paths.context} unchanged`);
            }
          }
        }
        showReport(pi, ctx, "Initialized or repaired SpecForge planning structure", result.join("\n"));
        return;
      }

      showReport(pi, ctx, "Initialized or repaired SpecForge", result.join("\n"));

      if (contextExisted) {
        const shouldAppend = await confirmContextAppend(ctx, "PROJECT_CONTEXT.md already exists. Append a timestamped project review?");
        if (!shouldAppend) return;
      }

      const scan = await scanProjectForContext(ctx.cwd);
      pi.sendUserMessage(buildProjectContextReviewPrompt(paths.context, scan, contextExisted ? "append" : "created"));
    },
  });

  pi.registerCommand("spec-refresh", {
    description: "Refresh PROJECT_CONTEXT.md from a read-only project review",
    handler: async (_args, ctx) => {
      const paths = getSpecPaths(ctx.cwd);
      await initializeSpecForge(ctx, { mode: "codebase" });
      const scan = await scanProjectForContext(ctx.cwd);
      showReport(pi, ctx, "Started SpecForge context refresh", `Reviewing project context for ${paths.context}`);
      pi.sendUserMessage(buildProjectContextReviewPrompt(paths.context, scan, "refresh"));
    },
  });

  pi.registerCommand("spec-new", {
    description: "Create a raw SpecForge feature idea",
    handler: async (args, ctx) => {
      const name = parseSpecName(args);
      if (!name) return showUsage(ctx, "/spec-new <spec-name>");

      const paths = getSpecPaths(ctx.cwd);
      await initializeSpecForge(ctx);

      const id = await createUniqueSpecId(paths, name);
      const file = join(paths.raw, `${id}.md`);
      const rawSpec = buildRawTemplate(formatSpecTitleFromName(name));
      await writeFile(file, rawSpec, "utf8");
      await updateSpecTracking(ctx.cwd, id, "raw", rawSpec);
      showReport(pi, ctx, "Created raw feature specification", `${file}\n\nFeature ID: ${id}\nNext: /spec-refine ${id}`);
    },
  });

  pi.registerCommand("spec-refine", {
    description: "Refine a raw feature idea into an implementation-ready specification",
    handler: async (args, ctx) => {
      const id = parseFeatureId(args);
      if (!id) return showUsage(ctx, "/spec-refine <generated-feature-id>");
      await initializeSpecForge(ctx);

      const paths = getSpecPaths(ctx.cwd);
      const rawPath = join(paths.raw, `${id}.md`);
      const refinedPath = join(paths.refined, `${id}.md`);

      if (!(await exists(rawPath))) return fail(ctx, `Raw spec not found: ${rawPath}`);
      if ((await exists(refinedPath)) && !(await confirmOverwrite(ctx, refinedPath))) return;

      const [rawSpec, projectContext] = await Promise.all([
        readFile(rawPath, "utf8"),
        readFile(paths.context, "utf8").catch(() => ""),
      ]);
      const stage = detectStageFromContext(projectContext);
      const questionBudget = stage === "ADVANCED" ? 12 : stage === "MEDIUM" ? 8 : 5;
      await updateSpecTracking(ctx.cwd, id, "refined", rawSpec);

      pi.sendUserMessage(`You are running SpecForge /spec-refine for feature id: ${id}.

Goal:
Create or update this refined specification file:
${refinedPath}

Rules:
- Act like a technical product owner: clarify product intent, implementation value, prioritization, scope, and delivery slices.
- Follow ONE SPEC = ONE FEATURE.
- If the raw idea contains multiple features, stop and recommend splitting it instead of writing a multi-feature spec.
- Project stage is ${stage}; ask at most ${questionBudget} targeted clarification questions.
- If the information is already sufficient, ask fewer questions or no questions.
- Avoid over-engineering and right-size the solution to the project maturity.
- Define feature-level Priority, Effort, and Business Value.
- Include at least one implementation task.
- For every task, include Priority, Estimated work, and Description.
- Remove unused task placeholders; add more task sections only when needed.
- Use this exact feature specification structure:

${SPEC_TEMPLATE}

Project context:

${projectContext || "(No PROJECT_CONTEXT.md content available.)"}

Raw feature idea from ${rawPath}:

${rawSpec}

When ready, write the refined specification to ${refinedPath}.`);
    },
  });

  pi.registerCommand("spec-review", {
    description: "Review a refined specification for implementation readiness",
    handler: async (args, ctx) => {
      const id = parseFeatureId(args);
      if (!id) return showUsage(ctx, "/spec-review <generated-feature-id>");
      await initializeSpecForge(ctx);

      const paths = getSpecPaths(ctx.cwd);
      const refinedPath = join(paths.refined, `${id}.md`);
      if (!(await exists(refinedPath))) return fail(ctx, `Refined spec not found: ${refinedPath}`);

      const [refinedSpec, projectContext, freshContext] = await Promise.all([
        readFile(refinedPath, "utf8"),
        readFile(paths.context, "utf8").catch(() => ""),
        scanProjectForContext(ctx.cwd),
      ]);
      const stage = detectStageFromContext(projectContext);

      pi.sendUserMessage(`You are running SpecForge /spec-review for feature id: ${id}.

Role:
Act like a senior software engineer auditor. Review with fresh repository context, not only the existing PROJECT_CONTEXT.md. Use fresh context for the audit only; do not refresh PROJECT_CONTEXT.md during /spec-review. Calibrate strictness and technical depth to project stage: ${stage}.

Review this refined specification and update the file in place:
${refinedPath}

Checks:
- Scope clarity.
- Missing requirements.
- Feature-level Priority, Effort, and Business Value.
- At least one implementation task exists.
- Every task has Priority, Estimated work, and Description.
- Acceptance criteria.
- Security concerns.
- Data concerns.
- Scalability assumptions appropriate for project stage ${stage}.
- Dependencies and blockers.
- Over-engineering risks.
- Whether the spec still represents exactly one feature.

Readiness rubric:
- Problem Defined: 1
- Scope Defined: 1
- Out of Scope Defined: 1
- Functional Requirements Defined: 2
- Acceptance Criteria Defined: 2
- Tasks Defined with Priority/Estimated Work: 1
- Dependencies Defined: 1
- Technical Direction Defined: 1
- Total: 10

Promotion requires readiness_score >= 8 and no blocking open questions.

Project context:

${projectContext || "(No PROJECT_CONTEXT.md content available.)"}

Fresh repository context gathered for this review:

Top-level entries:
${formatBullets(freshContext.topLevelEntries)}

Notable project files:
${formatBullets(freshContext.notableFiles)}

Sample file inventory (limited):
${formatBullets(freshContext.files)}

Selected file snippets:
${formatSnippets(freshContext.snippets)}

Current refined specification:

${refinedSpec}

Before scoring, inspect additional relevant repository files if needed so the audit uses fresh context. Update the Implementation Readiness section with score breakdown, total score, and missing items. Do not promote the spec.`);
    },
  });

  pi.registerCommand("spec-fix", {
    description: "Fix a refined specification using /spec-review notes",
    handler: async (args, ctx) => {
      const id = parseFeatureId(args);
      if (!id) return showUsage(ctx, "/spec-fix <generated-feature-id>");
      await initializeSpecForge(ctx);

      const paths = getSpecPaths(ctx.cwd);
      const refinedPath = join(paths.refined, `${id}.md`);
      if (!(await exists(refinedPath))) return fail(ctx, `Refined spec not found: ${refinedPath}`);

      const [refinedSpec, projectContext, freshContext] = await Promise.all([
        readFile(refinedPath, "utf8"),
        readFile(paths.context, "utf8").catch(() => ""),
        scanProjectForContext(ctx.cwd),
      ]);
      const stage = detectStageFromContext(projectContext);
      await updateSpecTracking(ctx.cwd, id, "refined", refinedSpec);

      pi.sendUserMessage(`You are running SpecForge /spec-fix for feature id: ${id}.

Goal:
Fix this refined specification in place using the review notes and Implementation Readiness feedback produced by /spec-review:
${refinedPath}

Role:
Act like a technical product owner applying a senior software engineer auditor's review feedback. Use fresh repository context to resolve concrete gaps, but keep the spec constrained to one feature.

Rules:
- Address the existing review notes, low-scoring rubric items, and Missing Before Implementation items in the refined specification.
- Preserve ONE SPEC = ONE FEATURE. If the review notes reveal multiple features, stop and recommend a split instead of broadening this spec.
- Project stage is ${stage}; right-size fixes to this maturity level.
- Keep or restore this feature specification structure:

${SPEC_TEMPLATE}

- Ensure Priority, Effort, and Business Value are filled.
- Ensure at least one implementation task exists.
- Ensure every task has Priority, Estimated work, and Description.
- Strengthen acceptance criteria so implementation can be verified.
- Remove resolved review placeholders or stale missing items.
- Do not promote or move the spec. After fixing, the user should run /spec-review ${id} again.

Project context:

${projectContext || "(No PROJECT_CONTEXT.md content available.)"}

Fresh repository context gathered for this fix:

Top-level entries:
${formatBullets(freshContext.topLevelEntries)}

Notable project files:
${formatBullets(freshContext.notableFiles)}

Sample file inventory (limited):
${formatBullets(freshContext.files)}

Selected file snippets:
${formatSnippets(freshContext.snippets)}

Current refined specification with review notes:

${refinedSpec}

Now update ${refinedPath} in place to address the review feedback. Do not promote the spec.`);
    },
  });

  pi.registerCommand("spec-promote", {
    description: "Promote a reviewed specification into archived_specs",
    handler: async (args, ctx) => {
      const id = parseFeatureId(args);
      if (!id) return showUsage(ctx, "/spec-promote <generated-feature-id>");
      await initializeSpecForge(ctx);

      const paths = getSpecPaths(ctx.cwd);
      const refinedPath = join(paths.refined, `${id}.md`);
      const archivedPath = join(paths.archived, `${id}.md`);
      if (!(await exists(refinedPath))) return fail(ctx, `Refined spec not found: ${refinedPath}`);
      if (await exists(archivedPath)) return fail(ctx, `Archived spec already exists: ${archivedPath}`);

      const content = await readFile(refinedPath, "utf8");
      const validation = validatePromotableSpec(content);
      if (!validation.ok) {
        return fail(ctx, `Promotion denied for ${id}:\n${validation.reasons.map((reason) => `- ${reason}`).join("\n")}`);
      }

      const split = splitFrontmatter(content);
      const existingMetadata = parseMetadata(split.frontmatter);
      const priority = await resolvePriority(ctx, existingMetadata.priority);
      const metadata = buildFrontmatter({
        ...existingMetadata,
        id,
        status: "ready",
        priority,
        readiness_score: String(validation.score),
        created_at: existingMetadata.created_at || today(),
        started_at: existingMetadata.started_at || "",
        completed_at: existingMetadata.completed_at || "",
      });

      await writeFile(refinedPath, `${metadata}\n${split.body.trimStart()}`, "utf8");
      await rename(refinedPath, archivedPath);
      await updateSpecTracking(ctx.cwd, id, "approved", content);
      showReport(pi, ctx, "Promoted specification", `${archivedPath}\n\nNext: /spec-start ${id}`);
    },
  });

  pi.registerCommand("spec-prioritize", {
    description: "Recommend implementation order for archived specifications",
    handler: async (_args, ctx) => {
      await initializeSpecForge(ctx);
      const specs = await readArchivedSpecs(ctx.cwd);
      const report = buildPrioritizationReport(specs);
      showReport(pi, ctx, "Prioritization", report);
    },
  });

  pi.registerCommand("spec-start", {
    description: "Begin implementation of a promoted feature",
    handler: async (args, ctx) => {
      const id = parseFeatureId(args);
      if (!id) return showUsage(ctx, "/spec-start <generated-feature-id>");
      await initializeSpecForge(ctx);

      const paths = getSpecPaths(ctx.cwd);
      const archivedPath = join(paths.archived, `${id}.md`);
      if (!(await exists(archivedPath))) return fail(ctx, `Archived spec not found: ${archivedPath}`);

      const content = await readFile(archivedPath, "utf8");
      const split = splitFrontmatter(content);
      const metadata = parseMetadata(split.frontmatter);
      if (metadata.status !== "ready") {
        return fail(ctx, `Spec must have status: ready before /spec-start. Current status: ${metadata.status || "missing"}`);
      }

      const nextContent = withUpdatedMetadata(content, id, {
        status: "in_progress",
        started_at: metadata.started_at || today(),
      });
      await writeFile(archivedPath, nextContent, "utf8");

      pi.sendUserMessage(`You are starting implementation for SpecForge feature: ${id}.

Archived specification path:
${archivedPath}

Important rule:
Planning is complete. Do not perform additional discovery unless the archived specification explicitly allows it.

Follow exactly:
- Scope
- Out of Scope
- Tasks
- Acceptance Criteria

Read the archived specification and implement it. Keep the implementation constrained to this one feature.`);
    },
  });

  pi.registerCommand("spec-complete", {
    description: "Mark an archived specification as completed",
    handler: async (args, ctx) => {
      const id = parseFeatureId(args);
      if (!id) return showUsage(ctx, "/spec-complete <generated-feature-id>");
      await initializeSpecForge(ctx);

      const paths = getSpecPaths(ctx.cwd);
      const archivedPath = join(paths.archived, `${id}.md`);
      if (!(await exists(archivedPath))) return fail(ctx, `Archived spec not found: ${archivedPath}`);

      if (ctx.hasUI) {
        const ok = await ctx.ui.confirm("SpecForge", `Mark ${id} as completed?`);
        if (!ok) return;
      }

      const content = await readFile(archivedPath, "utf8");
      const nextContent = withUpdatedMetadata(content, id, {
        status: "completed",
        completed_at: today(),
      });
      await writeFile(archivedPath, nextContent, "utf8");
      await updateSpecTracking(ctx.cwd, id, "completed", nextContent);
      showReport(pi, ctx, "Completed specification", archivedPath);
    },
  });

  pi.registerCommand("spec-status", {
    description: "Show SpecForge project status",
    handler: async (_args, ctx) => {
      await initializeSpecForge(ctx);
      const specs = await readArchivedSpecs(ctx.cwd);
      const report = buildStatusReport(specs);
      showReport(pi, ctx, "Project Status", report);
    },
  });
}

function getSpecPaths(root: string): SpecPaths {
  const specs = join(root, "specs");
  return {
    root,
    specs,
    context: join(specs, "PROJECT_CONTEXT.md"),
    tracking: join(specs, "SPEC_TRACKING.md"),
    raw: join(specs, "raw_specs"),
    refined: join(specs, "refined_specs"),
    archived: join(specs, "archived_specs"),
    gitignore: join(root, ".gitignore"),
  };
}

async function initializeSpecForge(ctx: ExtensionCommandContext, options: { mode?: InitMode } = {}): Promise<string[]> {
  const paths = getSpecPaths(ctx.cwd);
  const mode = options.mode ?? "codebase";
  const actions: string[] = [];

  for (const dir of [paths.specs, paths.raw, paths.refined, paths.archived]) {
    if (!(await exists(dir))) {
      await mkdir(dir, { recursive: true });
      actions.push(`Created ${dir}`);
    }
  }

  if (!(await exists(paths.context))) {
    const context = mode === "planning" ? buildPlanningProjectContext() : buildCodebaseProjectContext();
    await writeFile(paths.context, context, "utf8");
    actions.push(`Created ${paths.context}`);
  }

  if (await ensureSpecTracking(paths)) actions.push(`Created ${paths.tracking}`);

  const gitignoreChanged = await allowSpecForgeGitTracking(paths.gitignore);
  if (gitignoreChanged) actions.push(`Updated ${paths.gitignore} to allow tracking SpecForge specs`);

  if (actions.length === 0) actions.push("No changes needed.");
  return actions;
}

function buildCodebaseProjectContext(): string {
  return buildProjectContext("codebase", "This SpecForge workspace is attached to an implementation codebase. Project insights should be filled by /spec-init or /spec-refresh after a read-only review.", ["Avoid Over-Engineering"]);
}

function buildPlanningProjectContext(): string {
  return buildProjectContext("planning", "This SpecForge workspace is being used for planning. No implementation codebase has been reviewed yet.", [
    "Avoid Over-Engineering",
    "Treat technical choices as provisional until validated",
  ]);
}

function buildProjectContext(sessionType: InitMode, summary: string, extraPrinciples: string[]): string {
  return `# PROJECT_CONTEXT

## SESSION_TYPE
${sessionType}

## STAGE
EARLY

## PROJECT SUMMARY
${summary}

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
${extraPrinciples.map((principle) => `- ${principle}`).join("\n")}
`;
}

async function allowSpecForgeGitTracking(path: string): Promise<boolean> {
  const current = await readFile(path, "utf8").catch(() => undefined);
  if (current === undefined) return false;

  const removedEntries = new Set(["# SpecForge", "specs/raw_specs/", "specs/refined_specs/"]);
  const lines = current.split(/\r?\n/);
  const nextLines = lines.filter((line) => !removedEntries.has(line.trim()));
  if (nextLines.length === lines.length) return false;

  const next = nextLines.join("\n").replace(/\n{3,}/g, "\n\n");
  await writeFile(path, next.length === 0 || next === "\n" ? "" : next.endsWith("\n") ? next : `${next}\n`, "utf8");
  return true;
}

async function ensureSpecTracking(paths: SpecPaths): Promise<boolean> {
  if (await exists(paths.tracking)) return false;
  const entries = await discoverTrackingEntries(paths);
  await writeFile(paths.tracking, formatTrackingContent(entries), "utf8");
  return true;
}

async function updateSpecTracking(root: string, id: string, status: TrackingStatus, content?: string): Promise<void> {
  const paths = getSpecPaths(root);
  if (!(await exists(paths.tracking))) await ensureSpecTracking(paths);

  const current = await readFile(paths.tracking, "utf8").catch(() => "");
  const entries = parseTrackingEntries(current);
  const existing = entries.find((entry) => entry.id === id);
  const nextEntry = buildTrackingEntry(id, status, content, existing);
  const nextEntries = [...entries.filter((entry) => entry.id !== id), nextEntry]
    .sort((a, b) => a.id.localeCompare(b.id));

  await writeFile(paths.tracking, formatTrackingContent(nextEntries), "utf8");
}

async function discoverTrackingEntries(paths: SpecPaths): Promise<TrackingEntry[]> {
  const entries = new Map<string, TrackingEntry>();

  await addDiscoveredSpecs(entries, paths.raw, "raw");
  await addDiscoveredSpecs(entries, paths.refined, "refined");
  await addDiscoveredSpecs(entries, paths.archived, "approved");

  return Array.from(entries.values()).sort((a, b) => a.id.localeCompare(b.id));
}

async function addDiscoveredSpecs(entries: Map<string, TrackingEntry>, dir: string, fallbackStatus: TrackingStatus): Promise<void> {
  const files = await readdir(dir).catch(() => []);
  for (const file of files.filter((name) => name.endsWith(".md")).sort()) {
    const id = file.replace(/\.md$/, "");
    const content = await readFile(join(dir, file), "utf8").catch(() => "");
    const metadata = parseMetadata(splitFrontmatter(content).frontmatter);
    const status = metadata.status === "completed" ? "completed" : fallbackStatus;
    entries.set(id, buildTrackingEntry(id, status, content, entries.get(id)));
  }
}

function buildTrackingEntry(id: string, status: TrackingStatus, content?: string, existing?: TrackingEntry): TrackingEntry {
  return {
    id,
    title: extractSpecTitle(id, content) || existing?.title || humanizeId(id),
    description: extractSpecDescription(content) || existing?.description || "Pending details",
    status,
    updated: today(),
  };
}

function extractSpecTitle(id: string, content = ""): string {
  const heading = content.match(/^#\s+(.+)$/m)?.[1]?.trim();
  if (heading && !/^feature idea$/i.test(heading)) return truncateInline(heading, 80);
  return humanizeId(id);
}

function extractSpecDescription(content = ""): string {
  for (const heading of ["Problem Statement", "Problem", "Expected Behavior", "User Story", "Scope"]) {
    const section = extractSectionText(content, heading);
    if (section) return truncateInline(section, 140);
  }
  return "";
}

function extractSectionText(content: string, heading: string): string {
  const pattern = new RegExp(`##\\s+${escapeRegExp(heading)}\\s*\\n([\\s\\S]*?)(?=\\n##\\s+|\\n#\\s+|$)`, "i");
  const match = content.match(pattern);
  if (!match) return "";
  return match[1]
    .split(/\r?\n/)
    .map((line) => line.replace(/^[-*]\s+/, "").trim())
    .find((line) => line.length > 0 && !/^(TODO|TBD|N\/A|None)$/i.test(line)) || "";
}

function parseTrackingEntries(content: string): TrackingEntry[] {
  const sectionStart = content.search(/##\s+Specifications/i);
  if (sectionStart === -1) return [];

  const section = content.slice(sectionStart);
  const entries: TrackingEntry[] = [];
  for (const line of section.split(/\r?\n/)) {
    const cells = splitMarkdownRow(line);
    if (!cells || cells.length < 5) continue;
    if (/^spec id$/i.test(cells[0]) || /^---+$/.test(cells[0])) continue;
    const status = parseTrackingStatus(cells[3]);
    if (!status) continue;
    entries.push({
      id: cells[0],
      title: cells[1] || humanizeId(cells[0]),
      description: cells[2] || "Pending details",
      status,
      updated: cells[4] || today(),
    });
  }
  return entries;
}

function splitMarkdownRow(line: string): string[] | undefined {
  const trimmed = line.trim();
  if (!trimmed.startsWith("|") || !trimmed.endsWith("|")) return undefined;
  return trimmed.slice(1, -1).split("|").map((cell) => cell.trim().replace(/\\\|/g, "|"));
}

function parseTrackingStatus(value: string): TrackingStatus | undefined {
  const normalized = value.toLowerCase();
  if (normalized.includes("raw")) return "raw";
  if (normalized.includes("refined")) return "refined";
  if (normalized.includes("approved")) return "approved";
  if (normalized.includes("completed")) return "completed";
  return undefined;
}

function formatTrackingContent(entries: TrackingEntry[]): string {
  const counts = countTrackingStatuses(entries);
  const rows = entries.map((entry) => `| ${escapeMarkdownCell(entry.id)} | ${escapeMarkdownCell(entry.title)} | ${escapeMarkdownCell(entry.description)} | ${trackingStatusLabel(entry.status)} | ${entry.updated} |`);

  return `# SPEC_TRACKING

SpecForge specification statistics. This file is updated by /spec-new, /spec-refine, /spec-promote, and /spec-complete.

## Summary

| Status | Count |
| --- | ---: |
| ${trackingStatusLabel("raw")} | ${counts.raw} |
| ${trackingStatusLabel("refined")} | ${counts.refined} |
| ${trackingStatusLabel("approved")} | ${counts.approved} |
| ${trackingStatusLabel("completed")} | ${counts.completed} |
| **Total** | **${entries.length}** |

## Specifications

| Spec ID | Title | Description | Status | Updated |
| --- | --- | --- | --- | --- |
${rows.length > 0 ? rows.join("\n") : ""}
`;
}

function countTrackingStatuses(entries: TrackingEntry[]): Record<TrackingStatus, number> {
  return entries.reduce<Record<TrackingStatus, number>>((counts, entry) => {
    counts[entry.status] += 1;
    return counts;
  }, { raw: 0, refined: 0, approved: 0, completed: 0 });
}

function trackingStatusLabel(status: TrackingStatus): string {
  switch (status) {
    case "raw":
      return "📝 Raw";
    case "refined":
      return "🔧 Refined";
    case "approved":
      return "✅ Approved";
    case "completed":
      return "🎉 Completed";
    default:
      return status;
  }
}

function humanizeId(id: string): string {
  return id
    .split("-")
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

function escapeMarkdownCell(value: string): string {
  return value.replace(/\r?\n/g, " ").replace(/\|/g, "/").trim();
}

function truncateInline(value: string, maxLength: number): string {
  const singleLine = value.replace(/\s+/g, " ").trim();
  if (singleLine.length <= maxLength) return singleLine;
  return `${singleLine.slice(0, maxLength - 1)}…`;
}

function parseInitMode(args: string): InitMode | undefined {
  const tokens = args.trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return "codebase";
  if (tokens.length === 1 && tokens[0] === "--plan") return "planning";
  return undefined;
}

function isPlanningContext(content: string): boolean {
  return /##\s+SESSION_TYPE\s*\n\s*planning\s*$/im.test(content) || /planning session/i.test(content);
}

async function confirmContextAppend(ctx: ExtensionCommandContext, message: string): Promise<boolean> {
  if (!ctx.hasUI) {
    await fail(ctx, `${message}\nRun /spec-refresh to intentionally update PROJECT_CONTEXT.md, or update the file manually.`);
    return false;
  }
  return ctx.ui.confirm("SpecForge", message);
}

async function markPlanningContext(path: string): Promise<void> {
  const current = await readFile(path, "utf8").catch(() => "");
  const withSessionType = /##\s+SESSION_TYPE\s*\n[^\n]*/i.test(current)
    ? current.replace(/##\s+SESSION_TYPE\s*\n[^\n]*/i, "## SESSION_TYPE\nplanning")
    : `${current}${current.length > 0 && !current.endsWith("\n") ? "\n" : ""}\n## SESSION_TYPE\nplanning\n`;
  const prefix = withSessionType.length > 0 && !withSessionType.endsWith("\n") ? "\n" : "";
  await writeFile(path, `${withSessionType}${prefix}\n## Planning Session Note - ${today()}\n\nThis SpecForge workspace is being used as a planning session. No implementation codebase was reviewed by /spec-init --plan.\n`, "utf8");
}

async function scanProjectForContext(root: string): Promise<ProjectScanSummary> {
  const topLevelEntries = await listTopLevelEntries(root);
  const files = await collectProjectFiles(root);
  const notableFiles = files.filter(isNotableProjectFile).slice(0, 80);
  const snippets = await readProjectSnippets(root, notableFiles);
  return {
    topLevelEntries,
    files: files.slice(0, 250),
    notableFiles,
    snippets,
  };
}

async function listTopLevelEntries(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  return entries
    .filter((entry) => !shouldIgnoreEntry(entry.name))
    .map((entry) => `${entry.name}${entry.isDirectory() ? "/" : ""}`)
    .sort();
}

async function collectProjectFiles(root: string, relativeDir = "", depth = 0, collected: string[] = []): Promise<string[]> {
  if (depth > 4 || collected.length >= 300) return collected;

  const dir = join(root, relativeDir);
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (shouldIgnoreEntry(entry.name)) continue;
    const relativePath = relativeDir ? `${relativeDir}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      await collectProjectFiles(root, relativePath, depth + 1, collected);
    } else if (entry.isFile()) {
      collected.push(relativePath);
      if (collected.length >= 300) break;
    }
  }

  return collected;
}

function shouldIgnoreEntry(name: string): boolean {
  return new Set([
    ".git",
    ".hg",
    ".svn",
    ".cache",
    ".next",
    ".nuxt",
    ".turbo",
    ".venv",
    "venv",
    "node_modules",
    "dist",
    "build",
    "coverage",
    "target",
    "__pycache__",
    "specs",
  ]).has(name);
}

function isNotableProjectFile(path: string): boolean {
  const fileName = path.split("/").pop() || path;
  return /^(README|Dockerfile|Makefile|Gemfile|Rakefile|Pipfile)(\..*)?$/i.test(fileName)
    || /^(package|tsconfig|jsconfig|pyproject|requirements|setup|go|Cargo|composer|pom|build\.gradle|settings\.gradle|deno|bunfig)\.(json|toml|txt|py|mod|xml|kts|gradle)$/i.test(fileName)
    || /^(package-lock\.json|pnpm-lock\.yaml|yarn\.lock|uv\.lock|poetry\.lock|bun\.lock|Cargo\.lock|Pipfile\.lock)$/i.test(fileName)
    || /^(eslint\.config|biome|prettier\.config|vite\.config|next\.config|tailwind\.config|vitest\.config|jest\.config|pytest|ruff|mypy)\./i.test(fileName)
    || /^docker-compose\.(ya?ml)$/i.test(fileName)
    || /^compose\.(ya?ml)$/i.test(fileName)
    || /^\.?(eslintrc|prettierrc|editorconfig)$/i.test(fileName);
}

function isLockFile(path: string): boolean {
  const fileName = path.split("/").pop() || path;
  return /(?:^|[-.])(lock)$/i.test(fileName) || /lock\.(json|ya?ml)$/i.test(fileName);
}

async function readProjectSnippets(root: string, notableFiles: string[]): Promise<Array<{ path: string; content: string }>> {
  const snippets: Array<{ path: string; content: string }> = [];
  for (const path of notableFiles.filter((file) => !isLockFile(file)).slice(0, 12)) {
    const content = await readFile(join(root, path), "utf8").catch(() => "");
    if (!content.trim()) continue;
    snippets.push({
      path,
      content: truncate(content, 2500),
    });
  }
  return snippets;
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength)}\n... (truncated)`;
}

function buildProjectContextReviewPrompt(contextPath: string, scan: ProjectScanSummary, mode: ContextUpdateMode): string {
  const modeInstructions = mode === "created"
    ? "PROJECT_CONTEXT.md was just created from a minimal template. Update it in place with useful, concise insights from the project review."
    : mode === "append"
      ? "PROJECT_CONTEXT.md already existed. Do not rewrite or remove existing content. Append a timestamped project review section with concise insights and recommended context updates."
      : "Refresh PROJECT_CONTEXT.md intentionally. Preserve valuable manual notes, update stale insights, and append a timestamped project review summary.";

  return `You are running SpecForge ${mode === "refresh" ? "/spec-refresh" : "/spec-init"}.

Goal:
Create valuable project-level insights for:
${contextPath}

Mode:
${modeInstructions}

Rules:
- Perform a read-only review of the repository.
- Do not create or modify application project files.
- Do not run project scaffolding commands such as uv init, npm init, pnpm init, yarn init, cargo init, go mod init, etc.
- Do not install dependencies.
- Keep PROJECT_CONTEXT.md project-wide; do not add feature-specific implementation details.
- Capture technologies, libraries/frameworks, tooling, architecture patterns, coding style, testing approach, conventions, constraints, and open questions.
- If this is a planning-only/spec-only repository, set SESSION_TYPE to planning or clearly state that no codebase was reviewed.

Initial repository summary gathered by the extension:

Top-level entries:
${formatBullets(scan.topLevelEntries)}

Notable project files:
${formatBullets(scan.notableFiles)}

Sample file inventory (limited):
${formatBullets(scan.files)}

Selected file snippets:
${formatSnippets(scan.snippets)}

Now inspect additional files if useful, then update ${contextPath} according to the mode instructions.`;
}

function formatBullets(items: string[]): string {
  if (items.length === 0) return "- None detected";
  return items.map((item) => `- ${item}`).join("\n");
}

function formatSnippets(snippets: Array<{ path: string; content: string }>): string {
  if (snippets.length === 0) return "No snippets available.";
  return snippets.map((snippet) => `--- ${snippet.path} ---\n${snippet.content}`).join("\n\n");
}

function parseSpecName(args: string): string | undefined {
  const trimmed = args.trim().replace(/^['"]|['"]$/g, "");
  if (!trimmed) return undefined;
  if (!slugifySpecName(trimmed)) return undefined;
  return trimmed;
}

function formatSpecTitleFromName(name: string): string {
  return /[\s_]/.test(name) ? name.replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim() : humanizeId(slugifySpecName(name));
}

async function createUniqueSpecId(paths: SpecPaths, name: string): Promise<string> {
  const slug = slugifySpecName(name);
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const id = `${randomBytes(3).toString("hex")}-${slug}`;
    if ((await findSpecConflicts(paths, id)).length === 0) return id;
  }
  throw new Error(`Unable to create a unique spec id for ${name}`);
}

function slugifySpecName(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
}

function parseFeatureId(args: string): string | undefined {
  const trimmed = args.trim();
  if (!trimmed) return undefined;
  return trimmed.split(/\s+/)[0];
}

async function findSpecConflicts(paths: SpecPaths, id: string): Promise<string[]> {
  const candidates = [
    join(paths.raw, `${id}.md`),
    join(paths.refined, `${id}.md`),
    join(paths.archived, `${id}.md`),
  ];
  const conflicts: string[] = [];
  for (const candidate of candidates) {
    if (await exists(candidate)) conflicts.push(candidate);
  }
  return conflicts;
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function confirmOverwrite(ctx: ExtensionCommandContext, file: string): Promise<boolean> {
  if (!ctx.hasUI) {
    await fail(ctx, `Refusing to overwrite existing file without UI confirmation: ${file}`);
    return false;
  }
  return ctx.ui.confirm("SpecForge", `Overwrite existing file?\n${file}`);
}

function detectStageFromContext(content: string): Stage {
  if (/##\s+STAGE\s+ADVANCED/i.test(content) || /^ADVANCED\s*$/im.test(content)) return "ADVANCED";
  if (/##\s+STAGE\s+MEDIUM/i.test(content) || /^MEDIUM\s*$/im.test(content)) return "MEDIUM";
  return "EARLY";
}

function splitFrontmatter(content: string): { frontmatter: string; body: string } {
  if (!content.startsWith("---\n")) return { frontmatter: "", body: content };
  const end = content.indexOf("\n---", 4);
  if (end === -1) return { frontmatter: "", body: content };
  const afterEnd = content.indexOf("\n", end + 4);
  return {
    frontmatter: content.slice(4, end).trim(),
    body: afterEnd === -1 ? "" : content.slice(afterEnd + 1),
  };
}

function parseMetadata(frontmatter: string): SpecMetadata {
  const metadata: SpecMetadata = {};
  const lines = frontmatter.split(/\r?\n/);

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const scalar = line.match(/^([A-Za-z_][A-Za-z0-9_]*):\s*(.*)$/);
    if (!scalar) continue;

    const key = scalar[1] as keyof SpecMetadata;
    const value = scalar[2].trim();
    if (key === "depends_on") {
      if (value === "[]") {
        metadata.depends_on = [];
        continue;
      }
      const dependencies: string[] = [];
      while (i + 1 < lines.length && /^\s*-\s+/.test(lines[i + 1])) {
        i += 1;
        dependencies.push(lines[i].replace(/^\s*-\s+/, "").trim());
      }
      metadata.depends_on = dependencies;
      continue;
    }

    metadata[key] = value as never;
  }

  return metadata;
}

function buildFrontmatter(metadata: SpecMetadata): string {
  const dependencies = metadata.depends_on ?? [];
  const dependsOn = dependencies.length > 0
    ? ["depends_on:", ...dependencies.map((dependency) => `  - ${dependency}`)].join("\n")
    : "depends_on: []";

  return `---
id: ${metadata.id || "unknown"}
status: ${metadata.status || "ready"}
priority: ${metadata.priority || "medium"}
readiness_score: ${metadata.readiness_score || "0"}
${dependsOn}
created_at: ${metadata.created_at || today()}
started_at: ${metadata.started_at || ""}
completed_at: ${metadata.completed_at || ""}
---`;
}

function validatePromotableSpec(content: string): { ok: boolean; score: number; reasons: string[] } {
  const score = extractReadinessScore(content);
  const reasons: string[] = [];
  if (score < 8) reasons.push(`Readiness score must be >= 8/10. Found: ${Number.isFinite(score) ? `${score}/10` : "missing"}`);
  if (!sectionHasContent(content, "Priority")) reasons.push("Priority is missing or empty.");
  if (!sectionHasContent(content, "Effort")) reasons.push("Effort is missing or empty.");
  if (!sectionHasContent(content, "Business Value")) reasons.push("Business value is missing or empty.");
  if (!sectionHasContent(content, "Acceptance Criteria")) reasons.push("Acceptance criteria are missing or empty.");
  if (!sectionHasContent(content, "Tasks")) reasons.push("Tasks are missing or empty.");
  if (!tasksHaveRequiredFields(content)) reasons.push("At least one task is required, and every task must include priority, estimated work, and description.");
  if (hasBlockingMissingItems(content)) reasons.push("Missing Before Implementation contains unresolved items.");
  if (content.includes("Missing item 1") || content.includes("Missing item 2")) reasons.push("Template placeholder missing items are still present.");
  return { ok: reasons.length === 0, score, reasons };
}

function extractReadinessScore(content: string): number {
  const patterns = [
    /readiness_score:\s*(\d+(?:\.\d+)?)/i,
    /###\s+Total Score\s*\n+\s*(\d+(?:\.\d+)?)\s*\/\s*10/i,
    /Implementation Readiness:\s*(\d+(?:\.\d+)?)\s*\/\s*10/i,
    /Readiness Score:\s*(\d+(?:\.\d+)?)\s*\/\s*10/i,
  ];
  for (const pattern of patterns) {
    const match = content.match(pattern);
    if (match) return Number(match[1]);
  }
  return Number.NaN;
}

function sectionHasContent(content: string, heading: string): boolean {
  const pattern = new RegExp(`##\\s+${escapeRegExp(heading)}\\s*\\n([\\s\\S]*?)(?=\\n##\\s+|\\n#\\s+|$)`, "i");
  const match = content.match(pattern);
  if (!match) return false;
  const body = match[1]
    .replace(/###\s+Task\s+\d+/gi, "")
    .replace(/[-*]\s*(TODO|TBD|None|N\/A)\s*/gi, "")
    .trim();
  return body.length > 0;
}

function tasksHaveRequiredFields(content: string): boolean {
  const tasksSection = content.match(/##\s+Tasks\s*\n([\s\S]*?)(?=\n##\s+|$)/i)?.[1] || "";
  const tasks: string[] = [];
  const taskPattern = /###\s+[^\n]+\n([\s\S]*?)(?=\n###\s+|$)/gi;
  let match: RegExpExecArray | null;
  while ((match = taskPattern.exec(tasksSection)) !== null) tasks.push(match[1]);
  if (tasks.length === 0) return false;

  return tasks.every((task) => {
    return /Priority:\s*\S/i.test(task)
      && /Estimated work:\s*\S/i.test(task)
      && /Description:\s*\S/i.test(task);
  });
}

function hasBlockingMissingItems(content: string): boolean {
  const match = content.match(/###\s+Missing Before Implementation\s*\n([\s\S]*?)(?=\n##\s+|\n###\s+|$)/i);
  if (!match) return false;
  const body = match[1].trim();
  if (!body) return false;
  const normalized = body.toLowerCase().replace(/[-*]\s*/g, "").trim();
  return !["none", "n/a", "not applicable", "no missing items"].includes(normalized);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function resolvePriority(ctx: ExtensionCommandContext, existingPriority: string | undefined): Promise<Priority> {
  if (existingPriority === "high" || existingPriority === "medium" || existingPriority === "low") return existingPriority;
  if (!ctx.hasUI) return "medium";
  const selected = await ctx.ui.select("SpecForge priority", ["high", "medium", "low"]);
  if (selected === "high" || selected === "medium" || selected === "low") return selected;
  return "medium";
}

function withUpdatedMetadata(content: string, id: string, updates: Partial<SpecMetadata>): string {
  const split = splitFrontmatter(content);
  const current = parseMetadata(split.frontmatter);
  const metadata = buildFrontmatter({
    ...current,
    id: current.id || id,
    status: updates.status || current.status || "ready",
    priority: updates.priority || current.priority || "medium",
    readiness_score: updates.readiness_score || current.readiness_score || String(extractReadinessScore(content) || 0),
    depends_on: current.depends_on || [],
    created_at: updates.created_at || current.created_at || today(),
    started_at: updates.started_at !== undefined ? updates.started_at : current.started_at || "",
    completed_at: updates.completed_at !== undefined ? updates.completed_at : current.completed_at || "",
  });
  return `${metadata}\n${split.body.trimStart()}`;
}

async function readArchivedSpecs(root: string): Promise<ArchivedSpec[]> {
  const paths = getSpecPaths(root);
  if (!(await exists(paths.archived))) return [];
  const files = await readdir(paths.archived);
  const specs: ArchivedSpec[] = [];

  for (const file of files.filter((name) => name.endsWith(".md")).sort()) {
    const fullPath = join(paths.archived, file);
    const fileStat = await stat(fullPath).catch(() => undefined);
    if (!fileStat?.isFile()) continue;
    const content = await readFile(fullPath, "utf8");
    const split = splitFrontmatter(content);
    const metadata = parseMetadata(split.frontmatter);
    specs.push({
      id: metadata.id || file.replace(/\.md$/, ""),
      file: fullPath,
      content,
      metadata,
    });
  }

  return specs;
}

function buildStatusReport(specs: ArchivedSpec[]): string {
  const total = specs.length;
  const counts: Record<SpecStatus, number> = {
    ready: 0,
    in_progress: 0,
    blocked: 0,
    completed: 0,
  };

  for (const spec of specs) {
    const status = spec.metadata.status;
    if (status === "ready" || status === "in_progress" || status === "blocked" || status === "completed") {
      counts[status] += 1;
    }
  }

  const completion = total === 0 ? 0 : Math.round((counts.completed / total) * 100);
  const next = recommendNextSpec(specs);

  return `TOTAL FEATURES: ${total}

READY: ${counts.ready}
IN PROGRESS: ${counts.in_progress}
BLOCKED: ${counts.blocked}
COMPLETED: ${counts.completed}

COMPLETION: ${completion}%

Recommended Next Feature:
${next ? `${next.id}\nReason: ${describeRecommendation(next, specs)}` : "None"}`;
}

function buildPrioritizationReport(specs: ArchivedSpec[]): string {
  const open = specs.filter((spec) => spec.metadata.status !== "completed");
  if (open.length === 0) return "No open archived specifications.";

  const sorted = [...open].sort((a, b) => scoreSpec(b, specs) - scoreSpec(a, specs));
  const next = sorted[0];
  const lines = sorted.map((spec, index) => {
    return `${index + 1}. ${spec.id} (${spec.metadata.priority || "medium"}, ${spec.metadata.status || "unknown"}) - ${describeRecommendation(spec, specs)}`;
  });

  return `Recommended Next Feature

${next.id}

Reason:
- ${describeRecommendation(next, specs)}

Implementation Order:
${lines.join("\n")}`;
}

function recommendNextSpec(specs: ArchivedSpec[]): ArchivedSpec | undefined {
  return specs
    .filter((spec) => spec.metadata.status === "ready")
    .sort((a, b) => scoreSpec(b, specs) - scoreSpec(a, specs))[0];
}

function scoreSpec(spec: ArchivedSpec, allSpecs: ArchivedSpec[]): number {
  const priorityScore = spec.metadata.priority === "high" ? 30 : spec.metadata.priority === "low" ? 10 : 20;
  const blockerScore = countDependents(spec.id, allSpecs) * 5;
  const statusScore = spec.metadata.status === "ready" ? 10 : spec.metadata.status === "in_progress" ? 5 : 0;
  const parsedReadiness = Number(spec.metadata.readiness_score || 0);
  const readinessScore = Number.isFinite(parsedReadiness) ? parsedReadiness : 0;
  return priorityScore + blockerScore + statusScore + readinessScore;
}

function countDependents(id: string, specs: ArchivedSpec[]): number {
  return specs.filter((spec) => spec.metadata.depends_on?.includes(id)).length;
}

function describeRecommendation(spec: ArchivedSpec, specs: ArchivedSpec[]): string {
  const blockers = countDependents(spec.id, specs);
  const reasons = [`${spec.metadata.priority || "medium"} priority`];
  if (blockers > 0) reasons.push(`blocks ${blockers} feature${blockers === 1 ? "" : "s"}`);
  if (spec.metadata.readiness_score) reasons.push(`readiness ${spec.metadata.readiness_score}/10`);
  return reasons.join(", ");
}

function showReport(pi: ExtensionAPI, ctx: ExtensionCommandContext, title: string, content: string): void {
  pi.sendMessage({
    customType: "spec-forge",
    content: `${title}\n\n${content}`,
    display: true,
  });
  if (ctx.hasUI) ctx.ui.notify(title, "info");
}

async function showUsage(ctx: ExtensionCommandContext, usage: string): Promise<void> {
  await fail(ctx, `Usage: ${usage}`);
}

async function fail(ctx: ExtensionCommandContext, message: string): Promise<void> {
  if (ctx.hasUI) ctx.ui.notify(message, "error");
  else console.error(message);
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}
