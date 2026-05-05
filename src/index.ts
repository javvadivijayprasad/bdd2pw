/**
 * Public programmatic API for `@vijaypjavvadi/bdd2pw`.
 *
 * The CLI (`src/cli.ts`) and HTTP service (`src/server.ts`) are thin shells
 * over these three functions. See docs/ARCHITECTURE.md §1.
 */

import * as fs from "fs-extra";
import * as path from "path";
import type {
  AnalyzeOptions,
  AnalyzeResult,
  PageObjectIR,
  ReviewItem,
  ScaffoldOptions,
  ScaffoldResult,
  StepBinding,
  UpdatePomOptions,
  UpdatePomResult,
} from "./types";
import { parseFeature, substituteOutlinePlaceholders } from "./parser/gherkinParser";
import { scanRepo } from "./repo/repoScanner";
import { scaffoldProject } from "./repo/projectScaffolder";
import { scanPage } from "./discovery/mcpClient";
import { parseSnapshot } from "./discovery/snapshotParser";
import { dedupeLocators, pickLocator } from "./transformers/locatorPicker";
import { resolvePom } from "./transformers/pomResolver";
import { matchStep } from "./transformers/stepMatcher";
import { emitPageObject, emitTestFile } from "./emitters/facade";
import { tscValidate } from "./validate/tscRunner";
import { writeReviewReport } from "./reports/reviewReport";
import { camelCase } from "./utils/naming";
import { pageObjectFileName, renderLocatorExpr } from "@vijaypjavvadi/pw-emit";
import { logger } from "./utils/logger";

/**
 * Field names we never count as "missing" on a POM, because they're
 * synthetic (provided by the Playwright test fixture or by the POM base
 * class) rather than discovered locators.
 */
const RESERVED_FIELD_NAMES = new Set(["page", "context", "browser"]);

export type {
  AnalyzeOptions,
  AnalyzeResult,
  ScaffoldOptions,
  ScaffoldResult,
  UpdatePomOptions,
  UpdatePomResult,
  FeatureIR,
  ScenarioIR,
  StepIR,
  ElementIR,
  LocatorChoice,
  PageObjectIR,
  PomMethodIR,
  StepBinding,
  ReviewItem,
} from "./types";

class NotImplementedError extends Error {
  constructor(fn: string, phase: string) {
    super(
      `bdd2pw.${fn}() is not implemented yet — landing in ${phase}. ` +
        `See docs/SCOPE.md §16 (Phasing) for the rollout plan.`,
    );
    this.name = "NotImplementedError";
  }
}

/**
 * Scaffold a Playwright TS test repo from a Gherkin .feature file.
 *
 * Pipeline (see docs/ARCHITECTURE.md §2):
 *   gherkin parse → repo scan → POM resolve → MCP discover →
 *   locator pick → step match → emit → tsc validate → review report.
 *
 * Phase 1a: MCP page discovery uses the file-snapshot fallback. Pass
 * `opts.snapshotFile` to bypass the (not-yet-implemented) real browser
 * scan. Real `@playwright/mcp` integration lands in Phase 1b.
 */
export async function scaffold(opts: ScaffoldOptions): Promise<ScaffoldResult> {
  const reviewItems: ReviewItem[] = [];
  logger.info({ feature: opts.feature, page: opts.page, repo: opts.repo }, "scaffold start");

  // 1) Parse Gherkin
  const feature = await parseFeature(opts.feature);
  reviewItems.push({
    severity: "info",
    message: `Parsed feature "${feature.name}" — ${feature.scenarios.length} scenario(s)${feature.background ? " + Background" : ""}`,
  });

  // 2) Scaffold target repo if missing playwright.config.ts
  const scaffoldResult = await scaffoldProject({
    repoRoot: opts.repo,
    templatesDir: opts.templates,
    baseUrl: opts.url,
    projectName: feature.name.toLowerCase().replace(/\s+/g, "-"),
    selfHealing: opts.selfHealing,
  });
  reviewItems.push(...scaffoldResult.warnings);

  // 3) Scan target repo for existing POMs
  const repoState = await scanRepo(opts.repo);

  // 4) Discover page elements
  //    Three modes:
  //      - --no-discovery → skip the scan, use empty list (rule-only probing)
  //      - --snapshot-file → read from disk (CI / regression test path)
  //      - default → real Chromium via @playwright/mcp / playwright
  //    Navigation errors are SOFT-FAILED — they get logged as a warning and
  //    we proceed with an empty element list. This way `BDD_REVIEW.md` still
  //    lands and rule-only steps (`I am on the page`, `should be redirected`)
  //    still produce useful output even when the URL isn't reachable.
  let elements: ReturnType<typeof parseSnapshot> = [];
  if (opts.noDiscovery) {
    reviewItems.push({
      severity: "info",
      message: "Page discovery skipped (--no-discovery). Field-referencing rules will fall to TODO.",
    });
  } else {
    try {
      const snapshot = await scanPage({
        url: opts.url,
        storageState: opts.storageState,
        headed: opts.headed,
        snapshotFile: opts.snapshotFile,
      });
      elements = parseSnapshot(snapshot);
    } catch (err) {
      reviewItems.push({
        severity: "warn",
        message: `Page discovery failed: ${(err as Error).message.split("\n")[0]}. Continuing with empty element list — POM will be created with the synthesised goto() only, and field-referencing steps will fall to TODO.`,
        suggestion: "Pass --snapshot-file <path.json> to use a captured snapshot, or --no-discovery to skip discovery silently.",
      });
    }
  }
  const candidateChoices = dedupeLocators(elements.map((e) => pickLocator(e, elements)));
  reviewItems.push({
    severity: "info",
    message: `Discovered ${elements.length} element(s); picked ${candidateChoices.length} unique locator(s)`,
  });

  // 5) Resolve POM decision
  // Predict referenced fields by matching steps against a "POM with all candidates"
  const pageVar = camelCase(opts.page);
  const pomFileName = pageObjectFileName(opts.page); // "LoginPage" → "login.page.ts"
  const candidatePom: PageObjectIR = {
    className: opts.page,
    filePath: path.join(opts.repo, "pages", pomFileName),
    fields: candidateChoices,
    methods: [],
    exists: false,
  };
  const provisionalBindings: StepBinding[] = [];
  for (const scenario of feature.scenarios) {
    for (const step of scenario.steps) {
      provisionalBindings.push(matchStep(step, candidatePom, pageVar));
    }
  }
  if (feature.background) {
    for (const step of feature.background) {
      provisionalBindings.push(matchStep(step, candidatePom, pageVar));
    }
  }
  const referencedFields = new Set<string>();
  for (const b of provisionalBindings) {
    if (b.pomCall) {
      const m = b.pomCall.method.match(/^(\w+)\./);
      if (m && !RESERVED_FIELD_NAMES.has(m[1])) referencedFields.add(m[1]);
    }
    if (b.assertion) {
      const m = b.assertion.locator.match(/^[a-zA-Z_$][\w$]*\.(\w+)/);
      if (m && !RESERVED_FIELD_NAMES.has(m[1])) referencedFields.add(m[1]);
    }
  }
  const decision = resolvePom({
    requestedName: opts.page,
    existing: repoState.pageObjects,
    referencedFields: [...referencedFields],
  });
  reviewItems.push({
    severity: "info",
    message: `POM decision for ${opts.page}: ${decision.decision}${decision.missingFields.length ? ` (missing fields: ${decision.missingFields.join(", ")})` : ""}`,
  });

  // 6) Build the final POM IR (existing fields + only the new ones we need)
  const finalPom: PageObjectIR = buildFinalPom(decision, opts.page, candidatePom, candidateChoices);

  // 6.5) Synthesise a `goto()` method so the spec's `await loginPage.goto()`
  //      actually navigates. Skipped if the POM already has one (e.g. on AUGMENT)
  //      or if no URL was provided.
  if (opts.url && !finalPom.methods.some((m) => m.name === "goto")) {
    finalPom.methods.push({
      name: "goto",
      params: [],
      body: `await this.page.goto(${JSON.stringify(opts.url)});`,
      origin: "generated",
    });
  }

  // 7) Re-match steps now that the final POM is known
  const finalBindingsByScenario: { name: string; bindings: StepBinding[] }[] = [];
  for (const scenario of feature.scenarios) {
    const bindings = scenario.steps.map((s) => matchStep(s, finalPom, pageVar));
    finalBindingsByScenario.push({ name: scenario.name, bindings });
  }
  const beforeEachBindings = (feature.background ?? []).map((s) =>
    matchStep(s, finalPom, pageVar),
  );

  // Outline scenarios — flatten Examples into one test per row
  const flattened: { name: string; bindings: StepBinding[] }[] = [];
  for (const scenario of feature.scenarios) {
    if (scenario.examples && scenario.examples.length > 0) {
      for (const row of scenario.examples) {
        const expanded = scenario.steps.map((step) => {
          const text = substituteOutlinePlaceholders(step.text, row);
          return matchStep({ ...step, text }, finalPom, pageVar);
        });
        const labels = Object.entries(row).map(([k, v]) => `${k}=${v}`).join(", ");
        flattened.push({ name: `${scenario.name} [${labels}]`, bindings: expanded });
      }
    } else {
      flattened.push(finalBindingsByScenario.find((s) => s.name === scenario.name)!);
    }
  }

  for (const sc of flattened) {
    for (const b of sc.bindings) {
      if (b.warning) {
        reviewItems.push({
          severity: "warn",
          message: `[${sc.name}] ${b.warning}`,
          suggestion: "Add a custom step rule, enable --llm fallback, or hand-edit the spec.",
        });
      }
    }
  }
  // Background bindings emit into beforeEach but their warnings were being
  // dropped from the review report. Surface them with a [Background] tag.
  for (const b of beforeEachBindings) {
    if (b.warning) {
      reviewItems.push({
        severity: "warn",
        message: `[Background] ${b.warning}`,
        suggestion: "Add a custom step rule, enable --llm fallback, or hand-edit the spec.",
      });
    }
  }

  const filesWritten: string[] = [...scaffoldResult.filesWritten];

  if (!opts.dryRun) {
    // 8) Emit Page Object
    const pomEmitMode = decision.decision === "CREATE" ? "create" : "augment";
    const pomEmit = emitPageObject({
      pom: finalPom,
      mode: pomEmitMode,
      existing: decision.existing
        ? await fs.readFile(decision.existing.filePath, "utf8").catch(() => undefined)
        : undefined,
      selfHealingShim: opts.selfHealing,
    });
    reviewItems.push(
      ...pomEmit.warnings.map((w) => ({ ...w, file: finalPom.filePath })),
    );
    await fs.ensureDir(path.dirname(finalPom.filePath));
    await fs.writeFile(finalPom.filePath, pomEmit.contents, "utf8");
    filesWritten.push(finalPom.filePath);

    // 9) Emit spec file. pageObjectFileName returns "login.page.ts"; strip
    //    the trailing ".ts" for both the spec file stem and the import path.
    const pomStem = pomFileName.replace(/\.ts$/, ""); // "login.page"
    const specStem = pomStem.replace(/\.page$/, ""); // "login"
    const specPath = path.join(opts.repo, "tests", `${specStem}.spec.ts`);
    const specEmit = emitTestFile({
      describeName: feature.name,
      beforeEach: beforeEachBindings.length ? beforeEachBindings : undefined,
      scenarios: flattened,
      pomImports: [
        {
          className: opts.page,
          fromPath: `../pages/${pomStem}`,
        },
      ],
    });
    reviewItems.push(...specEmit.warnings.map((w) => ({ ...w, file: specPath })));
    await fs.ensureDir(path.dirname(specPath));
    await fs.writeFile(specPath, specEmit.contents, "utf8");
    filesWritten.push(specPath);
  }

  // 10) Validate
  let tscErrorCount = 0;
  if (!opts.dryRun && !opts.noValidate) {
    const tscResult = await tscValidate(opts.repo);
    tscErrorCount = tscResult.errorCount;
    reviewItems.push(...tscResult.items);
  }

  // 11) Review report
  const reviewReportPath = await writeReviewReport({
    repoRoot: opts.repo,
    items: reviewItems,
    feature: opts.feature,
    url: opts.url,
  });
  filesWritten.push(reviewReportPath);

  logger.info(
    { filesWritten: filesWritten.length, reviewItems: reviewItems.length, tscErrorCount },
    "scaffold complete",
  );

  return { filesWritten, reviewItems, tscErrorCount, reviewReportPath };
}

/**
 * Construct the final POM IR based on the resolver decision.
 *
 *   CREATE  → the candidate POM as-is
 *   REUSE   → the existing POM as-is (no new fields)
 *   AUGMENT → existing fields + missing fields appended (existing kept verbatim)
 */
function buildFinalPom(
  decision: ReturnType<typeof resolvePom>,
  className: string,
  candidatePom: PageObjectIR,
  candidateChoices: PageObjectIR["fields"],
): PageObjectIR {
  if (decision.decision === "CREATE" || !decision.existing) {
    return { ...candidatePom, className };
  }
  if (decision.decision === "REUSE") {
    return decision.existing;
  }
  // AUGMENT: existing fields + only the new ones we need
  const presentNames = new Set(decision.existing.fields.map((f) => f.fieldName));
  const newFields = candidateChoices.filter((c) => !presentNames.has(c.fieldName));
  return {
    ...decision.existing,
    fields: [...decision.existing.fields, ...newFields],
  };
}

/**
 * Dry-run analyser. Parses the .feature, scans the URL (or snapshot file),
 * picks locators, matches steps — but writes nothing.
 */
export async function analyze(opts: AnalyzeOptions): Promise<AnalyzeResult> {
  const feature = await parseFeature(opts.feature);
  const snapshotFile = (opts as AnalyzeOptions & { snapshotFile?: string }).snapshotFile;
  const snapshot = await scanPage({
    url: opts.url,
    storageState: opts.storageState,
    headed: opts.headed,
    snapshotFile,
  });
  const elements = parseSnapshot(snapshot);
  const discoveredLocators = dedupeLocators(elements.map((e) => pickLocator(e, elements)));
  const provisionalPom: PageObjectIR = {
    className: "AnalyzedPage",
    filePath: "",
    fields: discoveredLocators,
    methods: [],
    exists: false,
  };
  const bindings: StepBinding[] = [];
  for (const scenario of feature.scenarios) {
    for (const step of scenario.steps) {
      bindings.push(matchStep(step, provisionalPom, "analyzedPage"));
    }
  }
  const warnings: ReviewItem[] = bindings
    .filter((b) => b.warning)
    .map((b) => ({ severity: "warn" as const, message: b.warning! }));
  return { feature, discoveredLocators, bindings, warnings };
}

/**
 * Re-scan a URL and merge any newly-discovered locators into an existing
 * Page Object. **Append-only by construction:**
 *
 *   - Never deletes any property, method, or import.
 *   - Never renames anything.
 *   - Never modifies any existing method body — hand-edits are preserved
 *     byte-identical.
 *   - Skips field-name collisions (existing field wins).
 *   - Adds new locator fields + their constructor assignments only.
 *   - Method synthesis is opt-in and deferred to v1.1.
 *
 * Implementation: AST surgery via `ts-morph`. We read the existing file,
 * compute a diff against the freshly-scanned IR, and use `ts-morph`'s
 * `addProperty` / `addStatements` APIs to splice new content into the
 * existing class. Then `save()` writes back. No re-emit, no overwrite.
 *
 * Hard fails:
 *   - The POM file at `pages/<name>.page.ts` does not exist.
 *   - The class declared in the file doesn't match `--page <Name>`.
 *
 * See docs/ARCHITECTURE.md §4.
 */
export async function updatePom(opts: UpdatePomOptions): Promise<UpdatePomResult> {
  const reviewItems: ReviewItem[] = [];
  logger.info({ page: opts.page, repo: opts.repo, url: opts.url }, "updatePom start");

  // 1) Find the existing POM file.
  const repoState = await scanRepo(opts.repo);
  const existing = repoState.pageObjects.get(opts.page);
  if (!existing) {
    throw new Error(
      `Page Object "${opts.page}" not found in ${path.join(opts.repo, "pages")}. ` +
        `Use \`bdd2pw scaffold\` to create it first.`,
    );
  }

  // 2) Discover live elements.
  const noDiscovery = (opts as UpdatePomOptions & { noDiscovery?: boolean }).noDiscovery;
  const snapshotFile = (opts as UpdatePomOptions & { snapshotFile?: string }).snapshotFile;
  let elements: ReturnType<typeof parseSnapshot> = [];
  if (noDiscovery) {
    reviewItems.push({
      severity: "info",
      message: "Page discovery skipped (--no-discovery). updatePom will be a no-op.",
    });
  } else {
    try {
      const snapshot = await scanPage({
        url: opts.url,
        storageState: opts.storageState,
        headed: opts.headed,
        snapshotFile,
      });
      elements = parseSnapshot(snapshot);
    } catch (err) {
      reviewItems.push({
        severity: "warn",
        message: `Page discovery failed: ${(err as Error).message.split("\n")[0]}. updatePom is a no-op.`,
        suggestion: "Pass --snapshot-file <path.json> for offline merging.",
      });
    }
  }
  const allChoices = dedupeLocators(elements.map((e) => pickLocator(e, elements)));

  // 3) Diff against the existing POM. New = not present by fieldName.
  const existingFieldNames = new Set(existing.fields.map((f) => f.fieldName));
  const newChoices = allChoices.filter((c) => !existingFieldNames.has(c.fieldName));

  reviewItems.push({
    severity: "info",
    message:
      `Existing fields: ${existing.fields.length}. ` +
      `Discovered: ${allChoices.length}. ` +
      `New (to append): ${newChoices.length}. ` +
      `Skipped collisions: ${allChoices.length - newChoices.length}.`,
  });

  // 4) If nothing new, no-op.
  if (newChoices.length === 0) {
    const reviewReportPath = await writeReviewReport({
      repoRoot: opts.repo,
      items: reviewItems,
      feature: "(updatePom — no feature file)",
      url: opts.url,
    });
    logger.info({ reviewReportPath }, "updatePom complete (no-op)");
    return {
      added: { fields: 0, methods: 0 },
      preserved: {
        fields: existing.fields.length,
        methods: existing.methods.length,
      },
      filePath: existing.filePath,
      reviewItems,
    };
  }

  // 5) AST surgery — append new properties + constructor lines.
  //    Using ts-morph against the same file the repoScanner already loaded
  //    would re-parse, but the API surface is fluent so this is fine.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { Project } = require("ts-morph");
  const project = new Project({
    skipAddingFilesFromTsConfig: true,
    compilerOptions: { allowJs: false, noEmit: true, target: 99 },
  });
  const sourceFile = project.addSourceFileAtPath(existing.filePath);
  const cls = sourceFile.getClass(opts.page);
  if (!cls) {
    throw new Error(
      `File ${existing.filePath} exists but does not declare class "${opts.page}". ` +
        `Found classes: ${sourceFile
          .getClasses()
          .map((c: { getName: () => string | undefined }) => c.getName() ?? "(anonymous)")
          .join(", ") || "(none)"}.`,
    );
  }

  // Append a new readonly Locator property per new choice.
  for (const choice of newChoices) {
    cls.addProperty({
      name: choice.fieldName,
      type: "Locator",
      isReadonly: true,
    });
  }

  // Append a constructor assignment per new choice.
  const ctor = cls.getConstructors()[0];
  if (ctor) {
    for (const choice of newChoices) {
      const expr = renderLocatorExpr(choice);
      ctor.addStatements(`this.${choice.fieldName} = ${expr};`);
    }
  } else {
    reviewItems.push({
      severity: "warn",
      message:
        `Class "${opts.page}" has no constructor. New properties were declared ` +
        `but their initialisers were skipped. Add the constructor manually.`,
    });
  }

  await sourceFile.save();
  logger.info(
    { filePath: existing.filePath, added: newChoices.length },
    "updatePom: AST surgery complete",
  );

  // 6) Review report.
  const reviewReportPath = await writeReviewReport({
    repoRoot: opts.repo,
    items: reviewItems,
    feature: "(updatePom — no feature file)",
    url: opts.url,
  });
  logger.info({ reviewReportPath }, "updatePom complete");

  return {
    added: { fields: newChoices.length, methods: 0 },
    preserved: {
      fields: existing.fields.length,
      methods: existing.methods.length,
    },
    filePath: existing.filePath,
    reviewItems,
  };
}
