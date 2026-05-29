/**
 * VS Code extension entry point.
 *
 * Wires up four discovery surfaces:
 *   1. Right-click context menu on .feature files (and folders).
 *   2. Command palette commands (Ctrl+Shift+P → "bdd2pw: …").
 *   3. Activity-bar icon + sidebar tree view ("bdd2pw" panel).
 *   4. Status bar button (visible while a .feature file is the active editor).
 *
 * The actual scaffolding is delegated to `scaffoldRunner.ts`, which calls
 * `@vijaypjavvadi/bdd2pw`'s `scaffold()` API in-process — no subprocess,
 * no global install, full stack traces surfaced directly to the user.
 */

import * as vscode from "vscode";
import { runScaffoldOnFile, runScaffoldOnFolder } from "./scaffoldRunner";
import { Bdd2pwSidebarProvider } from "./sidebarProvider";
import { createStatusBarItem } from "./statusBar";
import { RunHistory } from "./runHistory";

/** Singleton output channel — every scaffold writes its log here. */
let outputChannel: vscode.OutputChannel | undefined;

export function getOutputChannel(): vscode.OutputChannel {
  if (!outputChannel) {
    outputChannel = vscode.window.createOutputChannel("bdd2pw");
  }
  return outputChannel;
}

export function activate(context: vscode.ExtensionContext): void {
  // Recent-run history is persisted in extension globalState so users
  // see their runs across VS Code restarts.
  const history = new RunHistory(context.globalState);

  // 1. Sidebar tree view — registered FIRST so the activity-bar icon
  //    shows up even before any command is invoked.
  const sidebar = new Bdd2pwSidebarProvider(history);
  context.subscriptions.push(
    vscode.window.registerTreeDataProvider("bdd2pwSidebar", sidebar),
  );

  // 2. Status bar item — visible only when the active editor is a
  //    .feature file. Subscribes to active-editor changes.
  const statusBar = createStatusBarItem();
  context.subscriptions.push(statusBar);

  // 3. Command registrations.
  context.subscriptions.push(
    vscode.commands.registerCommand("bdd2pw.scaffoldFile", async (resource?: vscode.Uri) => {
      const target = resolveFeatureUri(resource);
      if (!target) {
        vscode.window.showWarningMessage(
          "bdd2pw: open a .feature file in the editor, or right-click one in the Explorer, to scaffold it.",
        );
        return;
      }
      await runScaffoldOnFile(target, {
        output: getOutputChannel(),
        history,
        onComplete: () => sidebar.refresh(),
      });
    }),

    vscode.commands.registerCommand("bdd2pw.scaffoldFolder", async (resource?: vscode.Uri) => {
      const target = resource ?? (await pickFolder());
      if (!target) return;
      await runScaffoldOnFolder(target, {
        output: getOutputChannel(),
        history,
        onComplete: () => sidebar.refresh(),
      });
    }),

    vscode.commands.registerCommand("bdd2pw.openOutput", () => {
      getOutputChannel().show(true);
    }),

    vscode.commands.registerCommand("bdd2pw.openSettings", () => {
      vscode.commands.executeCommand("workbench.action.openSettings", "bdd2pw");
    }),

    vscode.commands.registerCommand("bdd2pw.refreshSidebar", () => {
      sidebar.refresh();
    }),

    vscode.commands.registerCommand("bdd2pw.openLastReview", async () => {
      const last = history.getMostRecent();
      if (!last) {
        vscode.window.showInformationMessage(
          "bdd2pw: no runs yet. Right-click a .feature file and choose Scaffold to start.",
        );
        return;
      }
      const reviewUri = vscode.Uri.file(last.reviewPath);
      try {
        const doc = await vscode.workspace.openTextDocument(reviewUri);
        await vscode.window.showTextDocument(doc, { preview: false });
      } catch (err) {
        vscode.window.showErrorMessage(
          `bdd2pw: could not open ${last.reviewPath}: ${(err as Error).message}`,
        );
      }
    }),

    // v0.2.0 — propose-rules pipeline (bdd2pw v3.6.0).
    vscode.commands.registerCommand("bdd2pw.proposeRules", async () => {
      const last = history.getMostRecent();
      let repoPath: string | undefined = last?.repoPath;
      if (!repoPath) {
        const picked = await vscode.window.showOpenDialog({
          canSelectFolders: true,
          canSelectFiles: false,
          canSelectMany: false,
          openLabel:
            "Pick a scaffold output folder (must contain artefacts/candidate-rules.jsonl)",
        });
        repoPath = picked?.[0]?.fsPath;
      }
      if (!repoPath) return;
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { proposeRules } = require("@vijaypjavvadi/bdd2pw") as {
          proposeRules: (opts: { inputPath: string }) => Promise<{
            outputPath: string;
            proposalsWritten: number;
            totalCandidates: number;
          }>;
        };
        const result = await proposeRules({ inputPath: repoPath });
        getOutputChannel().appendLine(
          `bdd2pw: ${result.proposalsWritten} proposal(s) written to ${result.outputPath} ` +
            `(from ${result.totalCandidates} candidate entries).`,
        );
        const doc = await vscode.workspace.openTextDocument(
          vscode.Uri.file(result.outputPath),
        );
        await vscode.window.showTextDocument(doc, { preview: false });
      } catch (err) {
        vscode.window.showErrorMessage(
          `bdd2pw: propose-rules failed: ${(err as Error).message}`,
        );
      }
    }),

    // v0.2.0 — quick multi-select toggle for domain rule packs.
    vscode.commands.registerCommand("bdd2pw.toggleDomain", async () => {
      const all = [
        "banking",
        "healthcare",
        "insurance",
        "retail",
        "gov",
        "education",
        "telecom",
      ] as const;
      const cfg = vscode.workspace.getConfiguration("bdd2pw");
      const current = cfg.get<string[]>("domains") ?? [];
      const picked = await vscode.window.showQuickPick(
        all.map((name) => ({
          label: name,
          description: current.includes(name) ? "✓ enabled" : "disabled",
          picked: current.includes(name),
        })),
        {
          canPickMany: true,
          title: "bdd2pw — Active domain rule packs",
          placeHolder: "Tick / untick to toggle. Empty = no packs.",
        },
      );
      if (!picked) return;
      const next = picked.map((p) => p.label);
      await cfg.update(
        "domains",
        next,
        vscode.ConfigurationTarget.Workspace,
      );
      vscode.window.showInformationMessage(
        next.length > 0
          ? `bdd2pw: active domains → ${next.join(", ")}`
          : "bdd2pw: no domain packs active.",
      );
      sidebar.refresh();
    }),
  );

  // 4. Reveal the output channel on activation in dev builds so the
  //    user sees what the extension is doing during first use.
  getOutputChannel().appendLine("bdd2pw extension activated.");
}

export function deactivate(): void {
  outputChannel?.dispose();
}

/**
 * Resolve the .feature URI for a scaffold command.
 *
 *   - If invoked from the Explorer context menu, `resource` carries
 *     the right-clicked file's Uri.
 *   - If invoked from the command palette or status bar with no arg,
 *     fall back to the active editor's document — but only if it's
 *     actually a .feature file.
 */
function resolveFeatureUri(resource?: vscode.Uri): vscode.Uri | undefined {
  if (resource) return resource;
  const active = vscode.window.activeTextEditor;
  if (!active) return undefined;
  if (active.document.uri.fsPath.toLowerCase().endsWith(".feature")) {
    return active.document.uri;
  }
  return undefined;
}

/** Open a folder picker rooted at the first workspace folder. */
async function pickFolder(): Promise<vscode.Uri | undefined> {
  const ws = vscode.workspace.workspaceFolders;
  const picked = await vscode.window.showOpenDialog({
    canSelectFiles: false,
    canSelectFolders: true,
    canSelectMany: false,
    defaultUri: ws?.[0]?.uri,
    openLabel: "Scaffold all .feature files in this folder",
  });
  return picked?.[0];
}
