/**
 * Bridge from the VS Code command layer to the bdd2pw library.
 *
 * `runScaffoldOnFile` / `runScaffoldOnFolder` are the only places that
 * import `@vijaypjavvadi/bdd2pw`. They:
 *   1. Read user-facing inputs (base URL, POM class name) — first from
 *      VS Code settings, then prompted interactively if missing.
 *   2. Compose `ScaffoldOptions` from settings + inputs + sane defaults.
 *   3. Call `scaffold()` inside `vscode.window.withProgress(...)` so the
 *      user sees a spinner with status messages.
 *   4. Stream stdout/stderr to a dedicated OutputChannel via the
 *      library's `opts.log` callback (when available).
 *   5. On completion, push a RunRecord to history, refresh the sidebar,
 *      and offer to open BDD_REVIEW.md.
 */

import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import { scaffold } from "@vijaypjavvadi/bdd2pw";
import type { ScaffoldOptions, ScaffoldResult } from "@vijaypjavvadi/bdd2pw";
import { RunHistory } from "./runHistory";

export interface RunnerContext {
  output: vscode.OutputChannel;
  history: RunHistory;
  onComplete?: () => void;
}

/**
 * Scaffold a single .feature file. Resolves required inputs (URL, POM
 * class, output repo) from settings or interactive prompts.
 */
export async function runScaffoldOnFile(
  featureUri: vscode.Uri,
  ctx: RunnerContext,
): Promise<void> {
  const opts = await resolveOptions(featureUri, ctx.output);
  if (!opts) return; // user cancelled

  ctx.output.show(true);
  ctx.output.appendLine("");
  ctx.output.appendLine(`──── ${new Date().toISOString()} ────`);
  ctx.output.appendLine(`Feature: ${opts.feature}`);
  ctx.output.appendLine(`URL:     ${opts.url}`);
  ctx.output.appendLine(`POM:     ${opts.page}`);
  ctx.output.appendLine(`Repo:    ${opts.repo}`);
  // v0.2.0 — surface key feature toggles up front so the user sees
  // what's active without scrolling.
  if (opts.domains && opts.domains.length > 0) {
    ctx.output.appendLine(`Domains: ${opts.domains.join(", ")}`);
  }
  const flagsActive = [
    opts.diagnostics ? "diagnostics" : null,
    opts.merge ? "merge" : null,
    opts.metaSidecar ? "metaSidecar" : null,
    opts.stepHooks ? "stepHooks" : null,
    opts.stepMarkers ? "stepMarkers" : null,
    opts.selfHealing ? "selfHealing" : null,
    opts.dependencyStrategy === "exact" ? "deps=exact" : null,
  ].filter(Boolean);
  if (flagsActive.length > 0) {
    ctx.output.appendLine(`Flags:   ${flagsActive.join(", ")}`);
  }

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: `bdd2pw — scaffolding ${path.basename(opts.feature)}`,
      cancellable: false,
    },
    async (progress) => {
      progress.report({ message: "starting…" });
      try {
        // Pass a log callback so library events stream to the output
        // channel in real time. The library accepts `log` since v2.2.0.
        const enriched: ScaffoldOptions & { log?: (e: unknown) => void } = {
          ...opts,
          log: (event: unknown) => {
            try {
              const line =
                typeof event === "string" ? event : JSON.stringify(event);
              ctx.output.appendLine(line);
            } catch {
              /* ignore stringify failures */
            }
          },
        };
        const result = (await scaffold(enriched)) as ScaffoldResult;
        ctx.output.appendLine("");
        ctx.output.appendLine(`✓ Wrote ${result.filesWritten.length} file(s).`);
        ctx.output.appendLine(`✓ Review: ${result.reviewReportPath}`);
        if (result.tscErrorCount > 0) {
          ctx.output.appendLine(
            `! tsc validation reported ${result.tscErrorCount} error(s) — see BDD_REVIEW.md.`,
          );
        }

        ctx.history.add({
          featurePath: opts.feature,
          repoPath: opts.repo,
          reviewPath: result.reviewReportPath,
          ranAt: Date.now(),
          filesWritten: result.filesWritten.length,
          tscErrorCount: result.tscErrorCount,
        });
        ctx.onComplete?.();

        const action = await vscode.window.showInformationMessage(
          `bdd2pw scaffolded ${result.filesWritten.length} file(s)` +
            (result.tscErrorCount > 0
              ? ` (${result.tscErrorCount} tsc warning${result.tscErrorCount === 1 ? "" : "s"})`
              : ""),
          "Open BDD_REVIEW.md",
          "Reveal output folder",
        );
        if (action === "Open BDD_REVIEW.md") {
          const doc = await vscode.workspace.openTextDocument(
            vscode.Uri.file(result.reviewReportPath),
          );
          await vscode.window.showTextDocument(doc, { preview: false });
        } else if (action === "Reveal output folder") {
          await vscode.commands.executeCommand(
            "revealFileInOS",
            vscode.Uri.file(opts.repo),
          );
        }
      } catch (err) {
        const msg = (err as Error).message ?? String(err);
        ctx.output.appendLine(`✗ scaffold failed: ${msg}`);
        if ((err as Error).stack) ctx.output.appendLine((err as Error).stack!);
        vscode.window.showErrorMessage(
          `bdd2pw scaffold failed: ${msg.split("\n")[0]}`,
          "Show output",
        ).then((action) => {
          if (action === "Show output") ctx.output.show(true);
        });
      }
    },
  );
}

/**
 * Scaffold every .feature file inside a folder (non-recursive by default).
 * Each file goes through the same single-file path so failures on one
 * don't abort the rest — they get logged and the loop continues.
 */
export async function runScaffoldOnFolder(
  folderUri: vscode.Uri,
  ctx: RunnerContext,
): Promise<void> {
  const features = collectFeatures(folderUri.fsPath);
  if (features.length === 0) {
    vscode.window.showInformationMessage(
      `bdd2pw: no .feature files found in ${folderUri.fsPath}.`,
    );
    return;
  }
  const confirm = await vscode.window.showInformationMessage(
    `Scaffold all ${features.length} .feature file(s) in ${path.basename(folderUri.fsPath)}?`,
    { modal: true },
    "Scaffold all",
  );
  if (confirm !== "Scaffold all") return;

  for (const feature of features) {
    await runScaffoldOnFile(vscode.Uri.file(feature), ctx);
  }
}

/** Non-recursive enumeration of .feature files in a directory. */
function collectFeatures(dir: string): string[] {
  try {
    return fs
      .readdirSync(dir)
      .filter((f) => f.toLowerCase().endsWith(".feature"))
      .map((f) => path.join(dir, f));
  } catch {
    return [];
  }
}

/**
 * Build ScaffoldOptions from VS Code settings + interactive prompts.
 *
 * Required by the library: feature, url, page, repo. We never silently
 * default `url` or `page` — they're scenario-specific and surprising
 * defaults would make for confusing test output. If the user has them
 * in settings, we use those; otherwise we prompt.
 */
async function resolveOptions(
  featureUri: vscode.Uri,
  output: vscode.OutputChannel,
): Promise<ScaffoldOptions | undefined> {
  const cfg = vscode.workspace.getConfiguration("bdd2pw");

  // Base URL — required.
  let url = cfg.get<string>("baseUrl") ?? "";
  if (!url) {
    const entered = await vscode.window.showInputBox({
      prompt: "Base URL for page discovery (used in scaffolded goto() and live element scan)",
      placeHolder: "https://your-app.example.com/",
      ignoreFocusOut: true,
    });
    if (!entered) {
      output.appendLine("bdd2pw: cancelled (no base URL).");
      return undefined;
    }
    url = entered;
  }

  // POM class name — required.
  let page = cfg.get<string>("pomClassName") ?? "";
  if (!page) {
    const entered = await vscode.window.showInputBox({
      prompt: "Page Object class name to generate",
      placeHolder: "LoginPage",
      value: "LoginPage",
      ignoreFocusOut: true,
    });
    if (!entered) {
      output.appendLine("bdd2pw: cancelled (no POM class name).");
      return undefined;
    }
    page = entered;
  }

  // Output repo — defaults to a sibling directory next to the .feature.
  const configuredRepo = cfg.get<string>("outputRepo") ?? "";
  const featureDir = path.dirname(featureUri.fsPath);
  const repo =
    configuredRepo && configuredRepo.length > 0
      ? configuredRepo
      : path.join(featureDir, "playwright-out");

  // LLM settings — entirely optional. Off when no API key is set.
  // v0.2.0 — pass through the v3.5.0 disableBatch toggle. The setting
  // is `useBatching: boolean` (UI-friendly); we invert it on the
  // ScaffoldOptions side since the library's flag is opt-out.
  const apiKey = cfg.get<string>("anthropicApiKey") ?? "";
  const useBatching = cfg.get<boolean>("useBatching") ?? true;
  const llmConfig: ScaffoldOptions["llmConfig"] | undefined = apiKey
    ? {
        provider: "anthropic",
        apiKey,
        governanceUrl: cfg.get<string>("governanceUrl") ?? "http://localhost:4900",
        skipGovernance: cfg.get<boolean>("skipGovernance") ?? false,
        maxCalls: cfg.get<number>("maxLlmCalls") ?? 50,
        disableBatch: !useBatching,
      }
    : undefined;

  // v0.2.0 — domain rule packs (v3.4 + v3.8). VS Code config supplies
  // a deduped string[] (manifest `uniqueItems: true`); pass it through.
  const domainsRaw = cfg.get<string[]>("domains") ?? [];
  const domains = domainsRaw.length > 0
    ? (domainsRaw as ScaffoldOptions["domains"])
    : undefined;

  return {
    feature: featureUri.fsPath,
    url,
    page,
    repo,
    selfHealing: cfg.get<boolean>("selfHealing") ?? false,
    noDiscovery: cfg.get<boolean>("noDiscovery") ?? false,
    llmConfig,
    // v0.2.0 — wire every new ScaffoldOption added across v3.0-3.8.
    domains,
    diagnostics: cfg.get<boolean>("diagnostics") ?? false,
    merge: cfg.get<boolean>("merge") ?? false,
    dependencyStrategy:
      (cfg.get<string>("dependencyStrategy") as "caret" | "exact" | undefined) ??
      "caret",
    metaSidecar: cfg.get<boolean>("metaSidecar") ?? false,
    stepHooks: cfg.get<boolean>("stepHooks") ?? false,
    stepMarkers: cfg.get<boolean>("stepMarkers") ?? false,
  };
}
