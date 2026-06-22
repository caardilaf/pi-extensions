import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { execFile } from "node:child_process";
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
`;

type Stage = "EARLY" | "MEDIUM" | "ADVANCED";
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
  priority?: string;
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

type SpecSelectionOption = {
  id: string;
  label: string;
};

type AzureExportArgs = {
  parentId: string;
  specQuery?: string;
};

type AzureImportArgs = {
  productBacklogItemId: string;
};

type AzureWorkItemRelation = {
  rel?: string;
  url?: string;
  attributes?: Record<string, unknown>;
};

type AzureWorkItem = {
  id?: number;
  fields?: Record<string, unknown>;
  relations?: AzureWorkItemRelation[];
};

type ParsedSpecTask = {
  heading: string;
  title: string;
  body: string;
  description: string;
  priority?: number;
  estimatedWork?: number;
};

type AzureWorkItemCreateOptions = {
  type: string;
  title: string;
  description?: string;
  areaPath?: string;
  fields?: Record<string, string | number | undefined>;
};

type AzureWorkItemExportResult = {
  id: number;
  type: string;
  created: boolean;
};

const AZURE_STORY_WORK_ITEM_TYPES = ["User Story", "Product Backlog Item", "Requirement", "Issue"];
const AZURE_TASK_WORK_ITEM_TYPES = ["Task"];
const AZURE_TASK_REMAINING_WORK_FIELD = "Microsoft.VSTS.Scheduling.RemainingWork";

export default function (pi: ExtensionAPI) {
  pi.registerMessageRenderer("spec-forge", (message, _options, theme) => {
    const title = theme.fg("accent", theme.bold("SpecForge"));
    return new Text(`${title}\n${String(message.content)}`, 0, 0);
  });

  pi.registerCommand("spec-init", {
    description: "Initialize SpecForge artifacts",
    handler: async (args, ctx) => {
      const mode = parseInitMode(args);
      if (!mode) return showUsage(ctx, "/spec-init [--plan]");

      const paths = getSpecPaths(ctx.cwd);
      const missingArtifacts = await getMissingSpecForgeArtifacts(paths);
      if (missingArtifacts.length === 0) {
        const existingContext = await readFile(paths.context, "utf8").catch(() => "");
        const refreshGuidance = isPlanningContext(existingContext)
          ? "/spec-refresh is intentionally disabled for planning-only workspaces because there is no codebase review to refresh."
          : `Use /spec-refresh to update ${paths.context}.`;
        showReport(pi, ctx, "SpecForge project already created", `All SpecForge artifacts already exist.\n/spec-init only initializes a workspace once. ${refreshGuidance}`);
        return;
      }

      const shouldReviewProjectContext = mode === "codebase" && missingArtifacts.includes(paths.context);
      const result = await initializeSpecForge(ctx, { mode });
      showReport(pi, ctx, mode === "planning" ? "Initialized SpecForge planning structure" : "Initialized SpecForge", result.join("\n"));

      if (shouldReviewProjectContext) {
        const maturity = await resolveProjectMaturity(ctx, paths.context);
        await updateProjectMaturity(paths.context, maturity);
        const scan = await scanProjectForContext(ctx.cwd);
        showReport(pi, ctx, "Started initial SpecForge context review", `Reviewing project context for ${paths.context}\nProject maturity: ${maturity}\nSession type: ${mode}`);
        pi.sendUserMessage(buildProjectContextReviewPrompt(paths.context, scan, "created", {
          maturity,
          sessionType: mode,
        }));
      }
    },
  });

  pi.registerCommand("spec-refresh", {
    description: "Refresh PROJECT_CONTEXT.md from a read-only codebase review",
    handler: async (_args, ctx) => {
      const paths = getSpecPaths(ctx.cwd);
      const existingContext = await readFile(paths.context, "utf8").catch(() => "");
      const sessionType: InitMode = isPlanningContext(existingContext) ? "planning" : "codebase";
      if (sessionType === "planning") {
        showReport(pi, ctx, "SpecForge refresh skipped", `/spec-refresh is disabled for planning-only workspaces because this session has no implementation codebase to review.\n\nPlanning context remains unchanged: ${paths.context}`);
        return;
      }
      await initializeSpecForge(ctx, { mode: sessionType });
      const maturity = await resolveProjectMaturity(ctx, paths.context);
      await updateProjectMaturity(paths.context, maturity);
      const scan = await scanProjectForContext(ctx.cwd);
      showReport(pi, ctx, "Started SpecForge context refresh", `Reviewing project context for ${paths.context}\nProject maturity: ${maturity}\nSession type: ${sessionType}`);
      pi.sendUserMessage(buildProjectContextReviewPrompt(paths.context, scan, "refresh", {
        maturity,
        sessionType,
      }));
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
      await initializeSpecForge(ctx);
      const paths = getSpecPaths(ctx.cwd);
      const id = await resolveFeatureId(args, ctx, {
        directory: paths.raw,
        prompt: "Select a raw spec to refine",
        emptyMessage: "No raw specs found. Create one with /spec-new <spec-name>.",
        usage: "/spec-refine <generated-feature-id>",
      });
      if (!id) return;

      const rawPath = join(paths.raw, `${id}.md`);
      const refinedPath = join(paths.refined, `${id}.md`);

      if (!(await exists(rawPath))) return fail(ctx, `Raw spec not found: ${rawPath}`);
      if ((await exists(refinedPath)) && !(await confirmOverwrite(ctx, refinedPath))) return;

      const [rawSpec, projectContext] = await Promise.all([
        readFile(rawPath, "utf8"),
        readFile(paths.context, "utf8").catch(() => ""),
      ]);
      const stage = detectStageFromContext(projectContext);
      const clarificationPolicy = getClarificationPolicy(stage);
      await updateSpecTracking(ctx.cwd, id, "refined", rawSpec);

      pi.sendUserMessage(`You are running SpecForge /spec-refine for feature id: ${id}.

Goal:
Create or update this refined specification file:
${refinedPath}

Rules:
- Act like a technical product owner: clarify product intent, implementation value, prioritization, scope, and delivery slices.
- Follow ONE SPEC = ONE FEATURE.
- If the raw idea contains multiple features, stop and recommend splitting it instead of writing a multi-feature spec.
- Project maturity/stage is ${stage}; clarification questions are mandatory for this stage.
- Ask between ${clarificationPolicy.minQuestions} and ${clarificationPolicy.maxQuestions} targeted clarification questions before drafting or writing the refined spec.
- Even if the raw idea seems sufficient, ask at least ${clarificationPolicy.minQuestions} validation questions or assumption-confirmation questions.
- Your first response must only ask the mandatory clarification questions and may include concise suggested options/tradeoffs; do not write ${refinedPath} until the user answers.
- Question focus for ${stage}: ${clarificationPolicy.focus}.
- Cover missing product, data, technology, integration, security/privacy, acceptance, and delivery-slice decisions as applicable. For example, a request like "create a RAG system" must ask about storage/vector database technology, data sources/ingestion, embedding/retrieval choices, permissions, evaluation criteria, and deployment constraints instead of assuming them.
- Avoid over-engineering and right-size the solution to the project maturity.
- Define feature-level numeric Priority (1-4), Effort (story points: 1, 2, 3, 5, 8, 13), and Business Value (1-10).
- Include at least one implementation task.
- For every task, use the heading format \`### Task N: Short task title\` and include numeric Priority (1-4), numeric Estimated Work, and Description.
- Remove unused task placeholders; add more task sections only when needed.
- Do not evaluate or certify Implementation Readiness during /spec-refine. Include only the unrated Score Breakdown scaffold from the template; /spec-review is responsible for scoring, total score, and Missing Before Implementation.
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
      await initializeSpecForge(ctx);
      const paths = getSpecPaths(ctx.cwd);
      const id = await resolveFeatureId(args, ctx, {
        directory: paths.refined,
        prompt: "Select a refined spec to review",
        emptyMessage: "No refined specs found. Run /spec-refine first.",
        usage: "/spec-review <generated-feature-id>",
      });
      if (!id) return;

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
Act like a senior software engineer auditor. Review with fresh repository context, not only the existing PROJECT_CONTEXT.md. Use fresh context for the audit only; do not refresh PROJECT_CONTEXT.md during /spec-review. Calibrate strictness and technical depth to project maturity/stage: ${stage}.

Review this refined specification without changing the refined story/specification content. Update only its Implementation Readiness section in place:
${refinedPath}

Checks:
- Scope clarity.
- Missing requirements.
- Feature-level numeric Priority (1-4), Effort (story points), and Business Value (1-10).
- At least one implementation task exists.
- Every task has a heading title in the format \`### Task N: Short task title\`, numeric Priority (1-4), numeric Estimated Work, and Description.
- Acceptance criteria.
- Security concerns.
- Data concerns.
- Scalability assumptions appropriate for project maturity/stage ${stage}.
- Dependencies and blockers.
- Over-engineering risks.
- Whether the spec still represents exactly one feature.

Readiness rubric:
- Problem Defined: 1
- Scope Defined: 1
- Out of Scope Defined: 1
- Functional Requirements Defined: 2
- Acceptance Criteria Defined: 2
- Tasks Defined with Titles and Numeric Priority/Estimated Work/Description: 1
- Dependencies Defined: 1
- Technical Direction Defined: 1
- Total: 10

Promotion requires Total Score/readiness score >= 8. TODOs/fix recommendations under Missing Before Implementation are advisory for promotion; any blocking concern should be reflected in the score.

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

Before scoring, inspect additional relevant repository files if needed so the audit uses fresh context. Do not rewrite, expand, or correct the refined story/specification sections. Only update the Implementation Readiness section: populate/certify the Score Breakdown, add ### Total Score, and add ### Missing Before Implementation. Under ### Missing Before Implementation, include only actionable TODOs or fix recommendations; do not add feature descriptions, positive summaries, general review notes, or restatements of what is already good. If there are no actionable fixes to recommend, write exactly "None". Do not add review notes anywhere else. Do not promote the spec.`);
    },
  });

  pi.registerCommand("spec-fix", {
    description: "Fix a refined specification using /spec-review notes",
    handler: async (args, ctx) => {
      await initializeSpecForge(ctx);
      const paths = getSpecPaths(ctx.cwd);
      const id = await resolveFeatureId(args, ctx, {
        directory: paths.refined,
        prompt: "Select a refined spec to fix",
        emptyMessage: "No refined specs found. Run /spec-refine first.",
        usage: "/spec-fix <generated-feature-id> [fix-context-comment]",
      });
      if (!id) return;

      const refinedPath = join(paths.refined, `${id}.md`);
      if (!(await exists(refinedPath))) return fail(ctx, `Refined spec not found: ${refinedPath}`);

      const [refinedSpec, projectContext, freshContext] = await Promise.all([
        readFile(refinedPath, "utf8"),
        readFile(paths.context, "utf8").catch(() => ""),
        scanProjectForContext(ctx.cwd),
      ]);
      const stage = detectStageFromContext(projectContext);
      const fixContextComment = await resolveFixContextComment(args, id, ctx);
      await updateSpecTracking(ctx.cwd, id, "refined", refinedSpec);

      pi.sendUserMessage(`You are running SpecForge /spec-fix for feature id: ${id}.

Goal:
Fix this refined specification in place using the review notes and Implementation Readiness feedback produced by /spec-review:
${refinedPath}

Role:
Act like a technical product owner applying a senior software engineer auditor's review feedback. Use fresh repository context to resolve concrete gaps, but keep the spec constrained to one feature.

Rules:
- Address the existing review notes, low-scoring rubric items, and Missing Before Implementation items in the refined specification.
- Treat the developer-provided additional fix context/comment as supplemental guidance for resolving gaps. Use it only when it is consistent with ONE SPEC = ONE FEATURE and the reviewed scope; if it would broaden or split the feature, stop and explain the conflict instead of applying it.
- Preserve ONE SPEC = ONE FEATURE. If the review notes reveal multiple features, stop and recommend a split instead of broadening this spec.
- Project maturity/stage is ${stage}; right-size fixes to this maturity level.
- Keep or restore this feature specification structure:

${SPEC_TEMPLATE}

- Implement every TODO/fix recommendation listed under ### Missing Before Implementation by updating the relevant refined specification sections.
- Ensure feature-level Priority (1-4), Effort (story points), and Business Value (1-10) are numeric.
- Ensure at least one implementation task exists.
- Ensure every task has a heading title in the format \`### Task N: Short task title\`, numeric Priority (1-4), numeric Estimated Work, and Description.
- Strengthen acceptance criteria so implementation can be verified.
- Do not calculate or certify readiness scores during /spec-fix. After implementing the Missing Before Implementation TODOs/fix recommendations, either replace that list with "- None" or reset Implementation Readiness to the unreviewed Score Breakdown scaffold so the next /spec-review can audit the updated spec from a clean state.
- Do not run /spec-review yourself, promote, or move the spec. After fixing, the user should run /spec-review ${id} again.

Developer-provided additional fix context/comment:

${fixContextComment || "(No additional fix context provided.)"}

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
      await initializeSpecForge(ctx);
      const paths = getSpecPaths(ctx.cwd);
      const id = await resolveFeatureId(args, ctx, {
        directory: paths.refined,
        prompt: "Select a refined spec to promote",
        emptyMessage: "No refined specs found. Run /spec-refine and /spec-review first.",
        usage: "/spec-promote <generated-feature-id>",
      });
      if (!id) return;

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
      const priority = await resolvePriority(ctx, existingMetadata.priority, content);
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
      await initializeSpecForge(ctx);
      const paths = getSpecPaths(ctx.cwd);
      const id = await resolveFeatureId(args, ctx, {
        directory: paths.archived,
        prompt: "Select an approved spec to start",
        emptyMessage: "No ready archived specs found. Run /spec-promote first.",
        usage: "/spec-start <generated-feature-id>",
        statusFilter: (metadata) => metadata.status === "ready",
      });
      if (!id) return;

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
      await initializeSpecForge(ctx);
      const paths = getSpecPaths(ctx.cwd);
      const id = await resolveFeatureId(args, ctx, {
        directory: paths.archived,
        prompt: "Select an in-progress spec to complete",
        emptyMessage: "No in-progress archived specs found. Run /spec-start first.",
        usage: "/spec-complete <generated-feature-id>",
        statusFilter: (metadata) => metadata.status === "in_progress",
      });
      if (!id) return;

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

  pi.registerCommand("spec-export-azure", {
    description: "Export an archived specification to Azure DevOps as a User Story with child tasks",
    handler: async (args, ctx) => {
      await initializeSpecForge(ctx);
      const parsed = parseAzureExportArgs(args);
      if (!parsed) return showUsage(ctx, "/spec-export-azure <parent-feature-id> [archived-spec-id-or-search]");

      if (!(await ensureAzureCliLoggedIn(ctx))) return;

      const paths = getSpecPaths(ctx.cwd);
      const spec = await resolveArchivedSpecForAzure(parsed.specQuery, ctx, paths);
      if (!spec) return;

      const storyTitle = buildAzureStoryTitle(spec);
      const tasks = parseSpecTasks(spec.content);
      if (tasks.length === 0) return fail(ctx, `Archived spec ${spec.id} has no tasks to export.`);
      const tasksMissingWork = tasks.filter((task) => task.estimatedWork === undefined || task.estimatedWork <= 0);
      if (tasksMissingWork.length > 0) {
        return fail(ctx, `Cannot export Azure tasks without numeric task Estimated Work values; these values are used to set Azure Remaining Work after task creation. Missing/invalid: ${tasksMissingWork.map((task) => task.title).join(", ")}`);
      }
      const duplicateTaskTitles = tasks
        .map((task) => task.title)
        .filter((title, index, titles) => titles.indexOf(title) !== index);
      if (duplicateTaskTitles.length > 0) return fail(ctx, `Cannot export Azure tasks with duplicate titles under the same User Story: ${Array.from(new Set(duplicateTaskTitles)).join(", ")}`);
      const parent = await readAzureWorkItem(parsed.parentId).catch(async (error: unknown) => {
        await fail(ctx, `Azure parent Feature not found or Azure DevOps CLI is not configured for this project.\nParent id: ${parsed.parentId}\n\n${formatAzureError(error)}`);
        return undefined;
      });
      if (!parent) return;

      const parentType = getAzureField(parent, "System.WorkItemType");
      if (parentType !== "Feature") {
        return fail(ctx, `Parent work item ${parsed.parentId} exists but is type "${parentType || "unknown"}". /spec-export-azure requires an Azure DevOps Feature parent.`);
      }
      const parentAreaPath = getAzureField(parent, "System.AreaPath");

      if (ctx.hasUI) {
        const ok = await ctx.ui.confirm("SpecForge Azure Export", `Create a new story work item "${storyTitle}" under Feature ${parsed.parentId} and create ${tasks.length} task item(s)? Existing child items with the same title will fail instead of being reused.`);
        if (!ok) return;
      }

      try {
        const storyResult = await createAzureChildWorkItem({
          parentId: parsed.parentId,
          typeCandidates: AZURE_STORY_WORK_ITEM_TYPES,
          title: storyTitle,
          duplicateMessage: `A User Story named "${storyTitle}" already exists under Feature ${parsed.parentId}. SpecForge will not reuse it or create a duplicate. Rename the archived spec or choose a different parent Feature.`,
          create: (type) => createAzureWorkItem(buildAzureStoryCreateOptions(spec, storyTitle, parentAreaPath, type)),
        });

        const taskResults: AzureWorkItemExportResult[] = [];
        for (const task of tasks) {
          const taskResult = await createAzureChildWorkItem({
            parentId: String(storyResult.id),
            typeCandidates: AZURE_TASK_WORK_ITEM_TYPES,
            title: task.title,
            duplicateMessage: `A Task named "${task.title}" already exists under User Story ${storyResult.id}. SpecForge will not reuse it or create a duplicate. Rename the task in the spec before exporting.`,
            create: (type) => createAzureWorkItem(buildAzureTaskCreateOptions(task, parentAreaPath, type)),
          });
          await updateAzureTaskWorkItem(taskResult.id, task);
          taskResults.push(taskResult);
        }

        const createdTaskIds = taskResults.map((item) => item.id);
        const taskType = taskResults[0]?.type || AZURE_TASK_WORK_ITEM_TYPES[0];
        showReport(pi, ctx, "Exported specification to Azure DevOps", `Feature parent: ${parsed.parentId}\nArea: ${parentAreaPath || "not set"}\n${storyResult.type}: ${storyResult.id} - ${storyTitle} (created)\n${taskType}s created: ${createdTaskIds.length}${createdTaskIds.length > 0 ? `\nCreated task ids: ${createdTaskIds.join(", ")}` : ""}`);
      } catch (error) {
        await fail(ctx, `Azure export failed. Some Azure work items may have been created before the failure.\n\n${formatAzureError(error)}`);
      }
    },
  });

  pi.registerCommand("spec-azure-import", {
    description: "Import a SpecForge-created Azure DevOps Product Backlog Item into archived_specs",
    handler: async (args, ctx) => {
      await initializeSpecForge(ctx);
      const parsed = parseAzureImportArgs(args);
      if (!parsed) return showUsage(ctx, "/spec-azure-import <product-backlog-item-id>");

      if (!(await ensureAzureCliLoggedIn(ctx))) return;

      const paths = getSpecPaths(ctx.cwd);
      const story = await readAzureWorkItemWithRelations(parsed.productBacklogItemId).catch(async (error: unknown) => {
        await fail(ctx, `Azure Product Backlog Item/User Story not found or Azure DevOps CLI is not configured for this project.\nWork item id: ${parsed.productBacklogItemId}\n\n${formatAzureError(error)}`);
        return undefined;
      });
      if (!story) return;

      const storyType = getAzureField(story, "System.WorkItemType") || "unknown";
      if (!AZURE_STORY_WORK_ITEM_TYPES.includes(storyType)) {
        return fail(ctx, `Work item ${parsed.productBacklogItemId} is type "${storyType}". /spec-azure-import expects a SpecForge-created Product Backlog Item/User Story.`);
      }

      const storyDescription = getAzureField(story, "System.Description") || "";
      const specId = extractSpecForgeIdFromAzureDescription(storyDescription);
      if (!specId) {
        return fail(ctx, `The Product Backlog Item/User Story ${parsed.productBacklogItemId} was not created under the SpecForge framework because its description does not contain a SpecForge ID.`);
      }

      let childIds = getAzureChildWorkItemIds(story);
      if (childIds.length === 0) {
        childIds = await findAzureDirectChildWorkItemIds(parsed.productBacklogItemId).catch(() => []);
      }
      const childItems: AzureWorkItem[] = [];
      for (const childId of childIds) {
        const child = await readAzureWorkItem(String(childId)).catch(async (error: unknown) => {
          await fail(ctx, `Could not read Azure child work item ${childId}.\n\n${formatAzureError(error)}`);
          return undefined;
        });
        if (child) childItems.push(child);
      }

      const tasks = childItems
        .filter((item) => AZURE_TASK_WORK_ITEM_TYPES.includes(getAzureField(item, "System.WorkItemType") || ""))
        .sort((a, b) => (getAzureWorkItemId(a) || 0) - (getAzureWorkItemId(b) || 0));
      if (tasks.length === 0) {
        return fail(ctx, `No child Azure Task work items found under ${storyType} ${parsed.productBacklogItemId}. SpecForge Azure imports require the tasks created as children of the Product Backlog Item/User Story.`);
      }

      const archivedPath = join(paths.archived, `${specId}.md`);
      const existingContent = await readFile(archivedPath, "utf8").catch(() => "");
      const imported = buildArchivedSpecFromAzure(story, tasks, specId, existingContent);

      if (ctx.hasUI && existingContent) {
        const ok = await ctx.ui.confirm("SpecForge Azure Import", `Update archived spec from Azure work item ${parsed.productBacklogItemId}?\n${archivedPath}`);
        if (!ok) return;
      }

      await writeFile(archivedPath, imported, "utf8");
      const importedStatus = parseMetadata(splitFrontmatter(imported).frontmatter).status;
      await updateSpecTracking(ctx.cwd, specId, importedStatus === "completed" ? "completed" : "approved", imported);
      showReport(pi, ctx, "Imported specification from Azure DevOps", `${archivedPath}\n\nProduct Backlog Item/User Story: ${parsed.productBacklogItemId}\nSpecForge ID: ${specId}\nType: ${storyType}\nArea: ${getAzureField(story, "System.AreaPath") || "not set"}\nChild tasks imported: ${tasks.length}`);
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

async function getMissingSpecForgeArtifacts(paths: SpecPaths): Promise<string[]> {
  const artifacts = [paths.specs, paths.raw, paths.refined, paths.archived, paths.context, paths.tracking];
  const missing: string[] = [];

  for (const artifact of artifacts) {
    if (!(await exists(artifact))) missing.push(artifact);
  }

  return missing;
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
  return buildProjectContext("codebase", "This SpecForge workspace is attached to an implementation codebase. Project insights should be filled by /spec-refresh after a read-only review.", ["Avoid Over-Engineering"]);
}

function buildPlanningProjectContext(): string {
  return buildProjectContext("planning", "This SpecForge workspace is being used for planning. No implementation codebase has been reviewed, and /spec-refresh is not applicable.", [
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

async function resolveProjectMaturity(ctx: ExtensionCommandContext, contextPath: string): Promise<Stage> {
  const current = detectStageFromContext(await readFile(contextPath, "utf8").catch(() => ""));
  if (!ctx.hasUI) return current;

  const selected = await ctx.ui.select("SpecForge project maturity", [
    "EARLY - New or small project; prefer simple, direct solutions",
    "MEDIUM - Growing project with established patterns",
    "ADVANCED - Mature project with scale, compliance, or complex dependencies",
  ]);
  const selectedText = String(selected || "");
  if (/^ADVANCED\b/.test(selectedText)) return "ADVANCED";
  if (/^MEDIUM\b/.test(selectedText)) return "MEDIUM";
  return "EARLY";
}

async function updateProjectMaturity(contextPath: string, maturity: Stage): Promise<boolean> {
  const current = await readFile(contextPath, "utf8").catch(() => "");
  if (!current) return false;

  let next: string;
  if (/##\s+STAGE\s*\n[^\n]*/i.test(current)) {
    next = current.replace(/##\s+STAGE\s*\n[^\n]*/i, `## STAGE\n${maturity}`);
  } else if (/##\s+SESSION_TYPE\s*\n[^\n]*/i.test(current)) {
    next = current.replace(/(##\s+SESSION_TYPE\s*\n[^\n]*\n?)/i, `$1\n## STAGE\n${maturity}\n`);
  } else {
    next = `${current}${current.endsWith("\n") ? "" : "\n"}\n## STAGE\n${maturity}\n`;
  }

  if (next === current) return false;
  await writeFile(contextPath, next, "utf8");
  return true;
}

function isPlanningContext(content: string): boolean {
  return /##\s+SESSION_TYPE\s*\n\s*planning\s*$/im.test(content) || /planning session/i.test(content);
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

function buildProjectContextReviewPrompt(contextPath: string, scan: ProjectScanSummary, mode: ContextUpdateMode, options: { maturity: Stage; sessionType: InitMode }): string {
  const modeInstructions = mode === "created"
    ? "PROJECT_CONTEXT.md was just created from a minimal template. Update it in place with useful, concise insights from the project review."
    : mode === "append"
      ? "PROJECT_CONTEXT.md already existed. Do not rewrite or remove existing content. Append a timestamped project review section with concise insights and recommended context updates."
      : "Refresh PROJECT_CONTEXT.md intentionally. Preserve valuable manual notes, update stale insights, and append a timestamped project review summary.";
  const sessionRule = options.sessionType === "planning"
    ? "- Preserve SESSION_TYPE as planning. This is a planning-only SpecForge workspace; do not convert it to codebase during refresh."
    : "- Keep SESSION_TYPE as codebase only when an implementation codebase is actually being reviewed.";

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
- Set ## STAGE to the user-selected project maturity: ${options.maturity}.
${sessionRule}
- If this is a planning-only/spec-only repository, keep or set SESSION_TYPE to planning and clearly state that no codebase was reviewed.

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

function parseInlineFixContextComment(args: string, id: string): string {
  const trimmed = args.trim();
  const firstToken = trimmed.split(/\s+/)[0];
  if (!firstToken || firstToken !== id) return "";

  const remainder = trimmed.slice(firstToken.length).trim();
  return remainder.replace(/^--\s*/, "").trim();
}

async function resolveFixContextComment(args: string, id: string, ctx: ExtensionCommandContext): Promise<string> {
  const inlineComment = parseInlineFixContextComment(args, id);
  if (inlineComment) return inlineComment;
  if (!ctx.hasUI) return "";

  const comment = await ctx.ui.input(
    "Additional /spec-fix context (optional)",
    "Leave blank to skip; e.g. prefer SQLite, preserve current API, use existing auth context",
  );
  return (comment || "").trim();
}

async function resolveFeatureId(args: string, ctx: ExtensionCommandContext, options: {
  directory: string;
  prompt: string;
  emptyMessage: string;
  usage: string;
  statusFilter?: (metadata: SpecMetadata) => boolean;
}): Promise<string | undefined> {
  const parsed = parseFeatureId(args);
  if (parsed) return parsed;

  if (!ctx.hasUI) {
    await showUsage(ctx, options.usage);
    return undefined;
  }

  const choices = await listSelectableSpecs(options.directory, options.statusFilter);
  if (choices.length === 0) {
    await fail(ctx, options.emptyMessage);
    return undefined;
  }

  const selected = await ctx.ui.select(options.prompt, choices.map((choice) => choice.label));
  const selectedLabel = String(selected || "");
  return choices.find((choice) => choice.label === selectedLabel)?.id;
}

async function listSelectableSpecs(directory: string, statusFilter?: (metadata: SpecMetadata) => boolean): Promise<SpecSelectionOption[]> {
  const files = await readdir(directory).catch(() => []);
  const choices: SpecSelectionOption[] = [];

  for (const file of files.filter((name) => name.endsWith(".md")).sort()) {
    const id = file.replace(/\.md$/, "");
    const content = await readFile(join(directory, file), "utf8").catch(() => "");
    const metadata = parseMetadata(splitFrontmatter(content).frontmatter);
    if (statusFilter && !statusFilter(metadata)) continue;

    const title = extractSpecTitle(id, content);
    const status = metadata.status ? ` [${metadata.status}${metadata.readiness_score ? `, readiness ${metadata.readiness_score}/10` : ""}]` : "";
    choices.push({
      id,
      label: `${id} — ${title}${status}`,
    });
  }

  return choices;
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

function getClarificationPolicy(stage: Stage): { minQuestions: number; maxQuestions: number; focus: string } {
  switch (stage) {
    case "ADVANCED":
      return {
        minQuestions: 8,
        maxQuestions: 12,
        focus: "validate scale, compliance, data/security, architecture integration, operational constraints, migration/rollout, observability, and measurable acceptance criteria",
      };
    case "MEDIUM":
      return {
        minQuestions: 5,
        maxQuestions: 8,
        focus: "confirm product boundaries, stack consistency, data model/storage, integrations, risks, testing strategy, and delivery slices",
      };
    case "EARLY":
    default:
      return {
        minQuestions: 3,
        maxQuestions: 5,
        focus: "clarify the core user outcome, simplest viable technical choice, data/storage needs, success criteria, and first delivery slice",
      };
  }
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
priority: ${metadata.priority || "2"}
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
  if (!Number.isFinite(score) || score < 8) reasons.push(`Readiness score must be >= 8/10. Found: ${Number.isFinite(score) ? `${score}/10` : "missing"}`);
  const priorityScore = extractNumericSectionValue(content, "Priority");
  const effortScore = extractNumericSectionValue(content, "Effort");
  const businessValueScore = extractNumericSectionValue(content, "Business Value");
  if (priorityScore === undefined || priorityScore < 1 || priorityScore > 4) reasons.push("Priority must be a numeric score from 1 to 4.");
  if (effortScore === undefined || effortScore <= 0) reasons.push("Effort must be numeric story points.");
  if (businessValueScore === undefined || businessValueScore < 1 || businessValueScore > 10) reasons.push("Business value must be a numeric score from 1 to 10.");
  if (!sectionHasContent(content, "Acceptance Criteria")) reasons.push("Acceptance criteria are missing or empty.");
  if (!sectionHasContent(content, "Tasks")) reasons.push("Tasks are missing or empty.");
  if (!tasksHaveRequiredFields(content)) reasons.push("At least one task is required, and every task must include a task title, numeric priority (1-4), numeric Estimated Work/Remaining Work, and description.");
  return { ok: reasons.length === 0, score, reasons };
}

function extractReadinessScore(content: string): number {
  const patterns = [
    /###\s+Total Score\s*\n+\s*(\d+(?:\.\d+)?)\s*\/\s*10/i,
    /readiness_score:\s*(\d+(?:\.\d+)?)/i,
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

function extractNumericSectionValue(content: string, heading: string): number | undefined {
  const pattern = new RegExp(`##\\s+${escapeRegExp(heading)}\\s*\\n([\\s\\S]*?)(?=\\n##\\s+|\\n#\\s+|$)`, "i");
  const body = content.match(pattern)?.[1] || "";
  const searchable = body
    .replace(/\([^)]*\)/g, "")
    .replace(/\b\d+\s*-\s*\d+\b/g, "");
  const match = searchable.match(/\b\d+(?:\.\d+)?\b/);
  if (!match) return undefined;
  const value = Number(match[0]);
  return Number.isFinite(value) ? value : undefined;
}

function parseBoundedNumber(value: string | undefined, min: number, max: number): number | undefined {
  if (!value) return undefined;
  const match = value.match(/\b\d+(?:\.\d+)?\b/);
  if (!match) return undefined;
  const parsed = Number(match[0]);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) return undefined;
  return parsed;
}

function tasksHaveRequiredFields(content: string): boolean {
  const tasksSection = content.match(/##\s+Tasks\s*\n([\s\S]*?)(?=\n##\s+|$)/i)?.[1] || "";
  const tasks: Array<{ heading: string; body: string }> = [];
  const taskPattern = /###\s+([^\n]+)\n([\s\S]*?)(?=\n###\s+|$)/gi;
  let match: RegExpExecArray | null;
  while ((match = taskPattern.exec(tasksSection)) !== null) {
    tasks.push({ heading: match[1].trim(), body: match[2] });
  }
  if (tasks.length === 0) return false;

  return tasks.every((task) => {
    const priority = extractTaskFieldNumber(task.body, "Priority");
    const estimatedWork = extractTaskEstimatedWork(task.body);
    return taskHeadingHasTitle(task.heading)
      && priority !== undefined && priority >= 1 && priority <= 4
      && estimatedWork !== undefined && estimatedWork > 0
      && extractTaskTextField(task.body, "Description").length > 0;
  });
}

function taskHeadingHasTitle(heading: string): boolean {
  const trimmed = heading.trim();
  const numbered = trimmed.match(/^Task\s+\d+\s*:\s*(.+)$/i);
  if (numbered) return numbered[1].trim().length > 0;
  return trimmed.length > 0 && !/^Task\s+\d+$/i.test(trimmed);
}

function extractTaskFieldNumber(task: string, field: string): number | undefined {
  const pattern = new RegExp(`${escapeRegExp(field)}(?:\\s*\\([^)]*\\))?:\\s*(\\d+(?:\\.\\d+)?)`, "i");
  const value = Number(task.match(pattern)?.[1]);
  return Number.isFinite(value) ? value : undefined;
}

function extractTaskEstimatedWork(task: string): number | undefined {
  return extractTaskFieldNumber(task, "Estimated Work") ?? extractTaskFieldNumber(task, "Remaining Work") ?? extractTaskFieldNumber(task, "Effort");
}

function extractTaskTextField(task: string, field: string): string {
  const labels = ["Priority", "Estimated Work", "Remaining Work", "Effort", "Business Value", "Description"];
  const labelPattern = labels.map((label) => `${escapeRegExp(label)}(?:\\s*\\([^)]*\\))?`).join("|");
  const pattern = new RegExp(`(?:^|\\n)\\s*-?\\s*${escapeRegExp(field)}(?:\\s*\\([^)]*\\))?:\\s*([\\s\\S]*?)(?=\\n\\s*-?\\s*(?:${labelPattern})\\s*:|$)`, "i");
  return task.match(pattern)?.[1]?.trim() || "";
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function resolvePriority(ctx: ExtensionCommandContext, existingPriority: string | undefined, content = ""): Promise<string> {
  const metadataPriority = parseBoundedNumber(existingPriority, 1, 4);
  if (metadataPriority !== undefined) return String(metadataPriority);

  const sectionPriority = extractNumericSectionValue(content, "Priority");
  if (sectionPriority !== undefined && sectionPriority >= 1 && sectionPriority <= 4) return String(sectionPriority);

  if (!ctx.hasUI) return "2";
  const selected = await ctx.ui.select("SpecForge numeric priority (1 low, 4 highest)", ["1", "2", "3", "4"]);
  return parseBoundedNumber(String(selected || ""), 1, 4)?.toString() || "2";
}

function withUpdatedMetadata(content: string, id: string, updates: Partial<SpecMetadata>): string {
  const split = splitFrontmatter(content);
  const current = parseMetadata(split.frontmatter);
  const metadata = buildFrontmatter({
    ...current,
    id: current.id || id,
    status: updates.status || current.status || "ready",
    priority: updates.priority || current.priority || "2",
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
    return `${index + 1}. ${spec.id} (priority ${spec.metadata.priority || "2"}/4, ${spec.metadata.status || "unknown"}) - ${describeRecommendation(spec, specs)}`;
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
  const priority = parseBoundedNumber(spec.metadata.priority, 1, 4) ?? 2;
  const businessValue = extractNumericSectionValue(spec.content, "Business Value") ?? 5;
  const effort = extractNumericSectionValue(spec.content, "Effort") ?? 5;
  const valueScore = (priority * 7.5) + (businessValue * 3);
  const effortPenalty = Math.min(Math.max(effort, 1), 13);
  const blockerScore = countDependents(spec.id, allSpecs) * 5;
  const statusScore = spec.metadata.status === "ready" ? 10 : spec.metadata.status === "in_progress" ? 5 : 0;
  const parsedReadiness = Number(spec.metadata.readiness_score || 0);
  const readinessScore = Number.isFinite(parsedReadiness) ? parsedReadiness : 0;
  return valueScore - effortPenalty + blockerScore + statusScore + readinessScore;
}

function countDependents(id: string, specs: ArchivedSpec[]): number {
  return specs.filter((spec) => spec.metadata.depends_on?.includes(id)).length;
}

function describeRecommendation(spec: ArchivedSpec, specs: ArchivedSpec[]): string {
  const blockers = countDependents(spec.id, specs);
  const priority = parseBoundedNumber(spec.metadata.priority, 1, 4) ?? 2;
  const businessValue = extractNumericSectionValue(spec.content, "Business Value");
  const effort = extractNumericSectionValue(spec.content, "Effort");
  const reasons = [`priority ${priority}/4`];
  if (businessValue !== undefined) reasons.push(`business value ${businessValue}/10`);
  if (effort !== undefined) reasons.push(`effort ${effort} story points`);
  if (blockers > 0) reasons.push(`blocks ${blockers} feature${blockers === 1 ? "" : "s"}`);
  if (spec.metadata.readiness_score) reasons.push(`readiness ${spec.metadata.readiness_score}/10`);
  return reasons.join(", ");
}

function parseAzureExportArgs(args: string): AzureExportArgs | undefined {
  const tokens = args.trim().split(/\s+/).filter(Boolean);
  const parentId = tokens.shift();
  if (!parentId || !/^\d+$/.test(parentId)) return undefined;
  const specQuery = tokens.join(" ").trim();
  return { parentId, specQuery: specQuery || undefined };
}

function parseAzureImportArgs(args: string): AzureImportArgs | undefined {
  const tokens = args.trim().split(/\s+/).filter(Boolean);
  if (tokens.length !== 1 || !/^\d+$/.test(tokens[0])) return undefined;
  return { productBacklogItemId: tokens[0] };
}

async function resolveArchivedSpecForAzure(query: string | undefined, ctx: ExtensionCommandContext, paths: SpecPaths): Promise<ArchivedSpec | undefined> {
  const specs = await readArchivedSpecs(paths.root);
  if (specs.length === 0) {
    await fail(ctx, "No archived specs found. Run /spec-promote before exporting to Azure DevOps.");
    return undefined;
  }

  if (!query) {
    if (!ctx.hasUI) {
      await showUsage(ctx, "/spec-export-azure <parent-feature-id> <archived-spec-id-or-search>");
      return undefined;
    }
    const choices = specs.map((spec) => azureSpecChoiceLabel(spec));
    const selected = await ctx.ui.select("Select an archived spec to export to Azure DevOps", choices);
    const selectedLabel = String(selected || "");
    return specs.find((spec) => azureSpecChoiceLabel(spec) === selectedLabel);
  }

  const normalized = query.replace(/\.md$/i, "").toLowerCase();
  const exact = specs.find((spec) => spec.id.toLowerCase() === normalized || buildAzureStoryTitle(spec).toLowerCase() === normalized);
  if (exact) return exact;

  const matches = specs.filter((spec) => {
    const title = buildAzureStoryTitle(spec).toLowerCase();
    return spec.id.toLowerCase().includes(normalized) || title.includes(normalized);
  });

  if (matches.length === 1) return matches[0];
  if (matches.length > 1 && ctx.hasUI) {
    const choices = matches.map((spec) => azureSpecChoiceLabel(spec));
    const selected = await ctx.ui.select(`Multiple archived specs match "${query}"`, choices);
    const selectedLabel = String(selected || "");
    return matches.find((spec) => azureSpecChoiceLabel(spec) === selectedLabel);
  }

  await fail(ctx, matches.length > 1
    ? `Multiple archived specs match "${query}". Provide a full generated spec id.`
    : `Archived spec not found for "${query}".`);
  return undefined;
}

function azureSpecChoiceLabel(spec: ArchivedSpec): string {
  const status = spec.metadata.status ? ` [${spec.metadata.status}]` : "";
  return `${spec.id} — ${buildAzureStoryTitle(spec)}${status}`;
}

function buildAzureStoryTitle(spec: ArchivedSpec): string {
  const heading = spec.content.match(/^#\s+(.+)$/m)?.[1]?.trim();
  if (heading && !/^feature idea$/i.test(heading)) return truncateInline(heading, 120);
  const idWithoutPrefix = spec.id.replace(/^[0-9a-f]{6}-/i, "");
  return truncateInline(humanizeId(idWithoutPrefix || spec.id), 120);
}

async function ensureAzureCliLoggedIn(ctx: ExtensionCommandContext): Promise<boolean> {
  try {
    await runAzJson(["account", "show", "--output", "json"]);
    return true;
  } catch (error) {
    await fail(ctx, `Azure CLI login is required before using SpecForge Azure commands. Run:\n\naz login\n\nThen make sure Azure DevOps defaults are configured, for example:\naz devops configure --defaults organization=https://dev.azure.com/<org> project=<project>\n\n${formatAzureError(error)}`);
    return false;
  }
}

async function readAzureWorkItem(id: string): Promise<AzureWorkItem> {
  return runAzJson<AzureWorkItem>(["boards", "work-item", "show", "--id", id, "--output", "json"]);
}

async function readAzureWorkItemWithRelations(id: string): Promise<AzureWorkItem> {
  return runAzJson<AzureWorkItem>(["boards", "work-item", "show", "--id", id, "--expand", "relations", "--output", "json"]);
}

async function findAzureChildWorkItemIds(parentId: string, type: string, title: string): Promise<number[]> {
  const wiql = `SELECT [System.Id], [System.Title] FROM WorkItems WHERE [System.TeamProject] = @project AND [System.WorkItemType] = '${escapeWiqlString(type)}' AND [System.Parent] = ${parentId} AND [System.Title] = '${escapeWiqlString(title)}'`;
  const result = await runAzJson<unknown>(["boards", "query", "--wiql", wiql, "--output", "json"]);
  return collectAzureWorkItemIds(result);
}

async function findAzureDirectChildWorkItemIds(parentId: string): Promise<number[]> {
  const wiql = `SELECT [System.Id] FROM WorkItems WHERE [System.TeamProject] = @project AND [System.Parent] = ${parentId}`;
  const result = await runAzJson<unknown>(["boards", "query", "--wiql", wiql, "--output", "json"]);
  return collectAzureWorkItemIds(result);
}

async function createAzureChildWorkItem(options: { parentId: string; typeCandidates: string[]; title: string; duplicateMessage: string; create: (type: string) => Promise<AzureWorkItem> }): Promise<AzureWorkItemExportResult> {
  const skippedTypes: string[] = [];
  const creatableTypes: string[] = [];

  for (const type of options.typeCandidates) {
    const existingIds = await findAzureChildWorkItemIds(options.parentId, type, options.title).catch((error: unknown) => {
      if (isAzureWorkItemTypeMissingError(error, type)) {
        skippedTypes.push(type);
        return undefined;
      }
      throw error;
    });
    if (!existingIds) continue;

    if (existingIds.length > 0) {
      throw new Error(`${options.duplicateMessage}\nExisting ${type} id${existingIds.length === 1 ? "" : "s"}: ${existingIds.join(", ")}`);
    }

    creatableTypes.push(type);
  }

  for (const type of creatableTypes) {
    const item = await options.create(type).catch((error: unknown) => {
      if (isAzureWorkItemTypeMissingError(error, type)) {
        if (!skippedTypes.includes(type)) skippedTypes.push(type);
        return undefined;
      }
      throw error;
    });
    if (!item) continue;

    const id = getAzureWorkItemId(item);
    if (!id) throw new Error(`Azure CLI did not return an id for ${type} "${options.title}".`);
    await linkAzureParent(String(id), options.parentId);
    return { id, type, created: true };
  }

  throw new Error(`Could not create "${options.title}". Tried Azure work item type(s): ${options.typeCandidates.join(", ")}.${skippedTypes.length > 0 ? ` Missing type(s): ${skippedTypes.join(", ")}.` : ""}`);
}

function isAzureWorkItemTypeMissingError(error: unknown, type: string): boolean {
  const text = formatAzureError(error).toLowerCase();
  return text.includes("work item type") && text.includes(type.toLowerCase()) && text.includes("does not exist");
}

async function createAzureWorkItem(options: AzureWorkItemCreateOptions): Promise<AzureWorkItem> {
  const args = [
    "boards",
    "work-item",
    "create",
    "--type",
    options.type,
    "--title",
    options.title,
    "--output",
    "json",
  ];

  if (options.description) args.push("--description", options.description);
  if (options.areaPath) args.push("--area", options.areaPath);

  const fieldArgs = Object.entries(options.fields || {})
    .filter((entry): entry is [string, string | number] => entry[1] !== undefined && entry[1] !== "")
    .map(([field, value]) => `${field}=${value}`);
  if (fieldArgs.length > 0) args.push("--fields", ...fieldArgs);

  return runAzJson<AzureWorkItem>(args);
}

async function updateAzureTaskWorkItem(taskId: number, task: ParsedSpecTask): Promise<void> {
  if (task.description) {
    await runAzJson<AzureWorkItem>([
      "boards",
      "work-item",
      "update",
      "--id",
      String(taskId),
      "--description",
      formatAzureTextField(task.description),
      "--output",
      "json",
    ]);
  }

  if (task.estimatedWork !== undefined) {
    await runAzJson<AzureWorkItem>([
      "boards",
      "work-item",
      "update",
      "--id",
      String(taskId),
      "--fields",
      `${AZURE_TASK_REMAINING_WORK_FIELD}=${task.estimatedWork}`,
      "--output",
      "json",
    ]);
  }
}

async function linkAzureParent(childId: string, parentId: string): Promise<void> {
  await runAzJson([
    "boards",
    "work-item",
    "relation",
    "add",
    "--id",
    childId,
    "--relation-type",
    "parent",
    "--target-id",
    parentId,
    "--output",
    "json",
  ]);
}

function parseSpecTasks(content: string): ParsedSpecTask[] {
  const tasksSection = content.match(/##\s+Tasks\s*\n([\s\S]*?)(?=\n##\s+|$)/i)?.[1] || "";
  const tasks: ParsedSpecTask[] = [];
  const taskPattern = /###\s+([^\n]+)\n([\s\S]*?)(?=\n###\s+|$)/gi;
  let match: RegExpExecArray | null;

  while ((match = taskPattern.exec(tasksSection)) !== null) {
    const heading = match[1].trim();
    const body = match[2].trim();
    const description = extractTaskTextField(body, "Description") || heading;
    tasks.push({
      heading,
      title: truncateInline(extractTaskTitle(heading, description), 120),
      body,
      description,
      priority: extractTaskFieldNumber(body, "Priority"),
      estimatedWork: extractTaskEstimatedWork(body),
    });
  }

  return tasks;
}

function extractTaskTitle(heading: string, fallback: string): string {
  const normalizedHeading = heading.replace(/^[-*]\s*/, "").trim();
  if (taskHeadingHasTitle(normalizedHeading)) return normalizedHeading;
  return fallback.replace(/^[-*]\s*/, "").trim();
}

function buildAzureStoryCreateOptions(spec: ArchivedSpec, title: string, areaPath: string | undefined, type: string): AzureWorkItemCreateOptions {
  return {
    type,
    title,
    areaPath,
    description: buildAzureStoryDescription(spec),
    fields: {
      "Microsoft.VSTS.Common.AcceptanceCriteria": formatAzureTextField(extractFullSection(spec.content, "Acceptance Criteria")),
      "Microsoft.VSTS.Common.Priority": extractNumericSectionValue(spec.content, "Priority"),
      "Microsoft.VSTS.Scheduling.Effort": extractNumericSectionValue(spec.content, "Effort"),
      "Microsoft.VSTS.Common.BusinessValue": extractNumericSectionValue(spec.content, "Business Value"),
    },
  };
}

function buildAzureTaskCreateOptions(task: ParsedSpecTask, areaPath: string | undefined, type: string): AzureWorkItemCreateOptions {
  return {
    type,
    title: task.title,
    areaPath,
    fields: {
      "Microsoft.VSTS.Common.Priority": task.priority,
    },
  };
}

function buildAzureStoryDescription(spec: ArchivedSpec): string {
  return formatAzureSections([
    ["SpecForge ID", spec.id],
    ["Problem Statement", extractFullSection(spec.content, "Problem Statement")],
    ["User Story", extractFullSection(spec.content, "User Story")],
    ["Scope", extractFullSection(spec.content, "Scope")],
    ["Out of Scope", extractFullSection(spec.content, "Out of Scope")],
    ["Functional Requirements", extractFullSection(spec.content, "Functional Requirements")],
    ["Technical Requirements", extractFullSection(spec.content, "Technical Requirements")],
    ["Dependencies", extractFullSection(spec.content, "Dependencies")],
    ["Risks", extractFullSection(spec.content, "Risks")],
    ["Future Improvements", extractFullSection(spec.content, "Future Improvements")],
    ["Implementation Readiness", extractImplementationReadinessSection(spec.content)],
  ]);
}

function buildArchivedSpecFromAzure(story: AzureWorkItem, tasks: AzureWorkItem[], specId: string, existingContent = ""): string {
  const sections = parseAzureDescriptionSections(getAzureField(story, "System.Description") || "");
  const existingSplit = splitFrontmatter(existingContent);
  const existingMetadata = parseMetadata(existingSplit.frontmatter);
  const importedReadiness = normalizeImportedImplementationReadiness(sections.get("implementation readiness") || "");
  const implementationReadiness = importedReadiness || extractImplementationReadinessSection(existingContent) || buildUnreviewedImplementationReadinessSection();
  const priority = getAzureNumericField(story, "Microsoft.VSTS.Common.Priority") ?? parseBoundedNumber(existingMetadata.priority, 1, 4) ?? 2;
  const importedReadinessScore = extractReadinessScore(implementationReadiness);
  const existingReadinessScore = extractReadinessScore(existingContent);
  const readinessScore = Number.isFinite(importedReadinessScore)
    ? String(importedReadinessScore)
    : existingMetadata.readiness_score || (Number.isFinite(existingReadinessScore) ? String(existingReadinessScore) : "0");
  const metadata = buildFrontmatter({
    ...existingMetadata,
    id: specId,
    status: existingMetadata.status || "ready",
    priority: String(priority),
    readiness_score: readinessScore,
    depends_on: existingMetadata.depends_on || [],
    created_at: existingMetadata.created_at || today(),
    started_at: existingMetadata.started_at || "",
    completed_at: existingMetadata.completed_at || "",
  });
  const effort = getAzureNumericField(story, "Microsoft.VSTS.Scheduling.Effort")
    ?? getAzureNumericField(story, "Microsoft.VSTS.Scheduling.StoryPoints")
    ?? getAzureNumericField(story, "Microsoft.VSTS.Scheduling.Size");
  const businessValue = getAzureNumericField(story, "Microsoft.VSTS.Common.BusinessValue");
  const acceptanceCriteria = htmlToText(getAzureField(story, "Microsoft.VSTS.Common.AcceptanceCriteria") || "");
  const taskSections = tasks.map((task, index) => buildImportedTaskSection(task, index + 1)).join("\n\n");

  return `${metadata}
## Problem Statement

${sections.get("problem statement") || ""}

## Priority
Numeric priority score (1-4): ${priority}

## Effort
Story points (1, 2, 3, 5, 8, 13): ${formatOptionalNumber(effort)}

## Business Value
Numeric business value score (1-10): ${formatOptionalNumber(businessValue)}

## Scope

${sections.get("scope") || ""}

## Out of Scope

${sections.get("out of scope") || ""}

## User Story

${sections.get("user story") || ""}

## Functional Requirements

${sections.get("functional requirements") || ""}

## Technical Requirements

${sections.get("technical requirements") || ""}

## Dependencies

${sections.get("dependencies") || ""}

## Tasks

${taskSections}

## Acceptance Criteria

${acceptanceCriteria}

## Risks

${sections.get("risks") || ""}

## Future Improvements

${sections.get("future improvements") || ""}

${implementationReadiness.trim()}
`;
}

function buildImportedTaskSection(task: AzureWorkItem, index: number): string {
  const rawTitle = getAzureField(task, "System.Title") || `Task ${index}`;
  const title = /^Task\s+\d+\s*:/i.test(rawTitle) ? rawTitle : `Task ${index}: ${rawTitle}`;
  const description = htmlToText(getAzureField(task, "System.Description") || "") || title;
  const priority = getAzureNumericField(task, "Microsoft.VSTS.Common.Priority") ?? 2;
  const remainingWork = getAzureNumericField(task, AZURE_TASK_REMAINING_WORK_FIELD) ?? 1;

  return `### ${title}

- Priority (1-4): ${priority}
- Estimated Work: ${remainingWork}
- Description: ${description}`;
}

function extractSpecForgeIdFromAzureDescription(description: string): string | undefined {
  const sections = parseAzureDescriptionSections(description);
  const sectionValue = sections.get("specforge id")?.match(/\b[0-9a-f]{6}-[a-z0-9][a-z0-9-]*\b/i)?.[0];
  if (sectionValue) return sectionValue;
  return htmlToText(description).match(/SpecForge\s+ID\s*[:\n\r ]+\s*([0-9a-f]{6}-[a-z0-9][a-z0-9-]*)/i)?.[1];
}

function parseAzureDescriptionSections(description: string): Map<string, string> {
  const sections = new Map<string, string>();
  const headingPattern = /<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/gi;
  const headings: Array<{ title: string; start: number; end: number }> = [];
  let match: RegExpExecArray | null;

  while ((match = headingPattern.exec(description)) !== null) {
    headings.push({
      title: htmlToText(match[1]).toLowerCase(),
      start: match.index,
      end: match.index + match[0].length,
    });
  }

  headings.forEach((heading, index) => {
    const nextStart = headings[index + 1]?.start ?? description.length;
    const body = htmlToText(description.slice(heading.end, nextStart));
    if (heading.title) sections.set(heading.title, body);
  });

  return sections;
}

function extractImplementationReadinessSection(content: string): string {
  return content.match(/##\s+Implementation Readiness\s*\n[\s\S]*$/i)?.[0]?.trim() || "";
}

function normalizeImportedImplementationReadiness(content: string): string {
  const trimmed = content.trim();
  if (!trimmed) return "";
  if (/^##\s+Implementation Readiness\b/im.test(trimmed)) return trimmed;
  return `## Implementation Readiness\n\n${trimmed}`;
}

function buildUnreviewedImplementationReadinessSection(): string {
  return `## Implementation Readiness

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
| Technical Direction Defined | Not reviewed |`;
}

function getAzureChildWorkItemIds(item: AzureWorkItem): number[] {
  return (item.relations || [])
    .filter((relation) => relation.rel === "System.LinkTypes.Hierarchy-Forward" || relation.attributes?.name === "Child")
    .map((relation) => Number(relation.url?.match(/workItems\/(\d+)$/i)?.[1]))
    .filter(Number.isFinite);
}

function formatOptionalNumber(value: number | undefined): string {
  return value === undefined ? "" : String(value);
}

function extractFullSection(content: string, heading: string): string {
  const pattern = new RegExp(`##\\s+${escapeRegExp(heading)}\\s*\\n([\\s\\S]*?)(?=\\n##\\s+|\\n#\\s+|$)`, "i");
  return content.match(pattern)?.[1]?.trim() || "";
}

function formatAzureSections(sections: Array<[string, string]>): string {
  const rendered = sections
    .filter(([, body]) => body.trim().length > 0)
    .map(([title, body]) => `<h3>${escapeHtml(title)}</h3>\n${formatAzureTextField(body)}`);
  return rendered.join("\n");
}

function formatAzureTextField(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  return `<pre>${escapeHtml(trimmed)}</pre>`;
}

function getAzureWorkItemId(item: AzureWorkItem): number | undefined {
  const id = Number(item.id);
  return Number.isFinite(id) ? id : undefined;
}

function getAzureField(item: AzureWorkItem, field: string): string | undefined {
  const value = item.fields?.[field];
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  return undefined;
}

function getAzureNumericField(item: AzureWorkItem, field: string): number | undefined {
  const value = item.fields?.[field];
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : undefined;
}

function collectAzureWorkItemIds(value: unknown): number[] {
  if (Array.isArray(value)) {
    return value.map((item) => Number((item as AzureWorkItem).id)).filter(Number.isFinite);
  }
  if (!value || typeof value !== "object") return [];
  const record = value as Record<string, unknown>;
  for (const key of ["workItems", "value", "items"]) {
    const nested = record[key];
    if (Array.isArray(nested)) return collectAzureWorkItemIds(nested);
  }
  return [];
}

function escapeWiqlString(value: string): string {
  return value.replace(/'/g, "''");
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function htmlToText(value: string): string {
  return unescapeHtml(value
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6]|pre)>/gi, "\n")
    .replace(/<li[^>]*>/gi, "- ")
    .replace(/<[^>]+>/g, ""))
    .replace(/\r\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function unescapeHtml(value: string): string {
  return value
    .replace(/&nbsp;/g, " ")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function runAzJson<T = unknown>(args: string[]): Promise<T> {
  return new Promise((resolve, reject) => {
    execFile("az", args, { maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        reject(Object.assign(error, { stdout, stderr }));
        return;
      }

      try {
        resolve(JSON.parse(stdout || "{}") as T);
      } catch (parseError) {
        reject(Object.assign(parseError instanceof Error ? parseError : new Error(String(parseError)), { stdout, stderr }));
      }
    });
  });
}

function formatAzureError(error: unknown): string {
  if (!error || typeof error !== "object") return String(error);
  const record = error as Record<string, unknown>;
  const stderr = typeof record.stderr === "string" ? record.stderr.trim() : "";
  const stdout = typeof record.stdout === "string" ? record.stdout.trim() : "";
  const message = error instanceof Error ? error.message : String(error);
  const details = [stderr, stdout].filter(Boolean).join("\n");
  return details ? `${message}\n${details}` : message;
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
