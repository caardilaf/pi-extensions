import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { access, mkdir, readFile, readdir, rename, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";

const RAW_TEMPLATE = `# Feature Idea

## Problem

## Expected Behavior

## Notes
`;

const SPEC_TEMPLATE = `## Problem Statement

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
`;

type Stage = "EARLY" | "MEDIUM" | "ADVANCED";
type Priority = "high" | "medium" | "low";
type SpecStatus = "ready" | "in_progress" | "blocked" | "completed";

type SpecPaths = {
  root: string;
  specs: string;
  context: string;
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

export default function (pi: ExtensionAPI) {
  pi.registerMessageRenderer("spec-forge", (message, _options, theme) => {
    const title = theme.fg("accent", theme.bold("SpecForge"));
    return new Text(`${title}\n${String(message.content)}`, 0, 0);
  });

  pi.registerCommand("spec-init", {
    description: "Initialize or repair SpecForge in this repository",
    handler: async (_args, ctx) => {
      const result = await initializeSpecForge(ctx);
      showReport(pi, ctx, "Initialized or repaired SpecForge", result.join("\n"));
    },
  });

  pi.registerCommand("spec-new", {
    description: "Create a raw SpecForge feature idea",
    handler: async (args, ctx) => {
      const id = parseFeatureId(args);
      if (!id) return showUsage(ctx, "/spec-new <feature-id>");
      if (!isKebabCase(id)) return fail(ctx, `Invalid feature id: ${id}\nUse kebab-case, for example: semantic-search`);

      const paths = getSpecPaths(ctx.cwd);
      await initializeSpecForge(ctx);
      const conflicts = await findSpecConflicts(paths, id);
      if (conflicts.length > 0) {
        return fail(ctx, `Cannot create ${id}; a spec already exists:\n${conflicts.join("\n")}`);
      }

      const file = join(paths.raw, `${id}.md`);
      await writeFile(file, RAW_TEMPLATE, "utf8");
      showReport(pi, ctx, "Created raw feature specification", `${file}\n\nNext: /spec-refine ${id}`);
    },
  });

  pi.registerCommand("spec-refine", {
    description: "Refine a raw feature idea into an implementation-ready specification",
    handler: async (args, ctx) => {
      const id = parseFeatureId(args);
      if (!id) return showUsage(ctx, "/spec-refine <feature-id>");
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

      pi.sendUserMessage(`You are running SpecForge /spec-refine for feature id: ${id}.

Goal:
Create or update this refined specification file:
${refinedPath}

Rules:
- Follow ONE SPEC = ONE FEATURE.
- If the raw idea contains multiple features, stop and recommend splitting it instead of writing a multi-feature spec.
- Project stage is ${stage}; ask at most ${questionBudget} targeted clarification questions.
- If the information is already sufficient, ask fewer questions or no questions.
- Avoid over-engineering and right-size the solution to the project maturity.
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
      if (!id) return showUsage(ctx, "/spec-review <feature-id>");
      await initializeSpecForge(ctx);

      const paths = getSpecPaths(ctx.cwd);
      const refinedPath = join(paths.refined, `${id}.md`);
      if (!(await exists(refinedPath))) return fail(ctx, `Refined spec not found: ${refinedPath}`);

      const [refinedSpec, projectContext] = await Promise.all([
        readFile(refinedPath, "utf8"),
        readFile(paths.context, "utf8").catch(() => ""),
      ]);

      pi.sendUserMessage(`You are running SpecForge /spec-review for feature id: ${id}.

Review this refined specification and update the file in place:
${refinedPath}

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

Readiness rubric:
- Problem Defined: 1
- Scope Defined: 1
- Out of Scope Defined: 1
- Functional Requirements Defined: 2
- Acceptance Criteria Defined: 2
- Tasks Defined: 1
- Dependencies Defined: 1
- Technical Direction Defined: 1
- Total: 10

Promotion requires readiness_score >= 8 and no blocking open questions.

Project context:

${projectContext || "(No PROJECT_CONTEXT.md content available.)"}

Current refined specification:

${refinedSpec}

Update the Implementation Readiness section with score breakdown, total score, and missing items. Do not promote the spec.`);
    },
  });

  pi.registerCommand("spec-promote", {
    description: "Promote a reviewed specification into archived_specs",
    handler: async (args, ctx) => {
      const id = parseFeatureId(args);
      if (!id) return showUsage(ctx, "/spec-promote <feature-id>");
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
      if (!id) return showUsage(ctx, "/spec-start <feature-id>");
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
      if (!id) return showUsage(ctx, "/spec-complete <feature-id>");
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
    raw: join(specs, "raw_specs"),
    refined: join(specs, "refined_specs"),
    archived: join(specs, "archived_specs"),
    gitignore: join(root, ".gitignore"),
  };
}

async function initializeSpecForge(ctx: ExtensionCommandContext): Promise<string[]> {
  const paths = getSpecPaths(ctx.cwd);
  const actions: string[] = [];

  for (const dir of [paths.specs, paths.raw, paths.refined, paths.archived]) {
    if (!(await exists(dir))) {
      await mkdir(dir, { recursive: true });
      actions.push(`Created ${dir}`);
    }
  }

  if (!(await exists(paths.context))) {
    const detection = await detectProjectContext(ctx.cwd);
    await writeFile(paths.context, buildProjectContext(detection.stage, detection.stack, detection.tooling), "utf8");
    actions.push(`Created ${paths.context}`);
  }

  const gitignoreChanged = await ensureGitignore(paths.gitignore);
  if (gitignoreChanged) actions.push(`Updated ${paths.gitignore}`);

  if (actions.length === 0) actions.push("No changes needed.");
  return actions;
}

async function detectProjectContext(root: string): Promise<{ stage: Stage; stack: string[]; tooling: string[] }> {
  const stack = new Set<string>();
  const tooling = new Set<string>();

  if (await exists(join(root, "package.json"))) {
    stack.add("Node.js");
    const pkg = await readFile(join(root, "package.json"), "utf8").catch(() => "");
    if (pkg.includes("typescript")) stack.add("TypeScript");
    if (pkg.includes("react")) stack.add("React");
    if (pkg.includes("vite")) tooling.add("Vite");
    if (pkg.includes("vitest")) tooling.add("Vitest");
    if (pkg.includes("jest")) tooling.add("Jest");
  }
  if (await exists(join(root, "pyproject.toml"))) stack.add("Python");
  if (await exists(join(root, "requirements.txt"))) stack.add("Python");
  if (await exists(join(root, "Dockerfile"))) tooling.add("Docker");
  if (await exists(join(root, "docker-compose.yml")) || await exists(join(root, "compose.yml"))) tooling.add("Docker Compose");
  if (await exists(join(root, "uv.lock"))) tooling.add("UV");
  if (await exists(join(root, "package-lock.json"))) tooling.add("npm");
  if (await exists(join(root, "pnpm-lock.yaml"))) tooling.add("pnpm");
  if (await exists(join(root, "yarn.lock"))) tooling.add("Yarn");

  return {
    stage: "EARLY",
    stack: Array.from(stack).sort(),
    tooling: Array.from(tooling).sort(),
  };
}

function buildProjectContext(stage: Stage, stack: string[], tooling: string[]): string {
  return `# PROJECT_CONTEXT

## STAGE
${stage}

## STACK
${formatList(stack)}

## TOOLING
${formatList(tooling)}

## PRINCIPLES
- One Spec = One Feature
- Avoid Over-Engineering
`;
}

function formatList(items: string[]): string {
  if (items.length === 0) return "- Unknown";
  return items.map((item) => `- ${item}`).join("\n");
}

async function ensureGitignore(path: string): Promise<boolean> {
  const block = ["# SpecForge", "specs/raw_specs/", "specs/refined_specs/"];
  const current = await readFile(path, "utf8").catch(() => "");
  const missing = block.filter((line) => !current.split(/\r?\n/).includes(line));
  if (missing.length === 0) return false;

  const prefix = current.length > 0 && !current.endsWith("\n") ? "\n" : "";
  const needsHeader = !current.split(/\r?\n/).includes("# SpecForge");
  const entries = [needsHeader ? "# SpecForge" : undefined, ...block.slice(1).filter((line) => missing.includes(line))]
    .filter((line): line is string => Boolean(line));
  await writeFile(path, `${current}${prefix}${entries.join("\n")}\n`, "utf8");
  return true;
}

function parseFeatureId(args: string): string | undefined {
  const trimmed = args.trim();
  if (!trimmed) return undefined;
  return trimmed.split(/\s+/)[0];
}

function isKebabCase(value: string): boolean {
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value);
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
  if (!sectionHasContent(content, "Acceptance Criteria")) reasons.push("Acceptance criteria are missing or empty.");
  if (!sectionHasContent(content, "Tasks")) reasons.push("Tasks are missing or empty.");
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
