/**
 * Sidebar tree for the bdd2pw activity-bar panel.
 *
 * Three top-level sections:
 *   1. Actions — quick triggers (scaffold open file, scaffold folder).
 *   2. Recent runs — last 10 scaffolds, click an item to open its
 *      BDD_REVIEW.md.
 *   3. Configuration — shortcut to extension settings.
 *
 * The tree is intentionally shallow. A flatter view is easier to scan
 * than a deeply nested one, and discoverability matters more here than
 * fidelity.
 */

import * as vscode from "vscode";
import * as path from "path";
import { RunHistory } from "./runHistory";

type Node = SectionNode | ActionNode | RunNode;

interface SectionNode {
  kind: "section";
  id: "actions" | "recent" | "config";
  label: string;
}

interface ActionNode {
  kind: "action";
  label: string;
  command: string;
  icon: vscode.ThemeIcon;
}

interface RunNode {
  kind: "run";
  label: string;
  description: string;
  tooltip: string;
  reviewPath: string;
  ranAt: number;
  failed: boolean;
}

export class Bdd2pwSidebarProvider implements vscode.TreeDataProvider<Node> {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<
    Node | undefined | null | void
  >();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  constructor(private readonly history: RunHistory) {}

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(node: Node): vscode.TreeItem {
    if (node.kind === "section") {
      const item = new vscode.TreeItem(
        node.label,
        vscode.TreeItemCollapsibleState.Expanded,
      );
      item.contextValue = `section.${node.id}`;
      return item;
    }
    if (node.kind === "action") {
      const item = new vscode.TreeItem(node.label, vscode.TreeItemCollapsibleState.None);
      item.iconPath = node.icon;
      item.command = { command: node.command, title: node.label };
      item.contextValue = "action";
      return item;
    }
    const item = new vscode.TreeItem(node.label, vscode.TreeItemCollapsibleState.None);
    item.description = node.description;
    item.tooltip = node.tooltip;
    item.iconPath = new vscode.ThemeIcon(
      node.failed ? "warning" : "pass",
      new vscode.ThemeColor(
        node.failed ? "list.warningForeground" : "testing.iconPassed",
      ),
    );
    item.command = {
      command: "vscode.open",
      title: "Open BDD_REVIEW.md",
      arguments: [vscode.Uri.file(node.reviewPath)],
    };
    item.contextValue = "run";
    return item;
  }

  getChildren(node?: Node): Node[] {
    if (!node) {
      return [
        { kind: "section", id: "actions", label: "Actions" },
        { kind: "section", id: "recent", label: "Recent runs" },
        { kind: "section", id: "config", label: "Configuration" },
      ];
    }
    if (node.kind !== "section") return [];
    switch (node.id) {
      case "actions":
        return [
          {
            kind: "action",
            label: "Scaffold current .feature file",
            command: "bdd2pw.scaffoldFile",
            icon: new vscode.ThemeIcon("beaker"),
          },
          {
            kind: "action",
            label: "Scaffold all features in folder…",
            command: "bdd2pw.scaffoldFolder",
            icon: new vscode.ThemeIcon("folder"),
          },
          {
            kind: "action",
            label: "Show output channel",
            command: "bdd2pw.openOutput",
            icon: new vscode.ThemeIcon("output"),
          },
        ];
      case "recent": {
        const runs = this.history.list().slice(0, 10);
        if (runs.length === 0) {
          return [
            {
              kind: "action",
              label: "No runs yet — scaffold a feature to begin",
              command: "bdd2pw.scaffoldFile",
              icon: new vscode.ThemeIcon("circle-outline"),
            },
          ];
        }
        return runs.map<RunNode>((r) => ({
          kind: "run",
          label: path.basename(r.featurePath),
          description: timeAgo(r.ranAt),
          tooltip:
            `${r.featurePath}\n` +
            `${r.filesWritten} file(s) written\n` +
            `${r.tscErrorCount} tsc warning(s)\n` +
            new Date(r.ranAt).toLocaleString(),
          reviewPath: r.reviewPath,
          ranAt: r.ranAt,
          failed: r.tscErrorCount > 0,
        }));
      }
      case "config":
        return [
          {
            kind: "action",
            label: "Open bdd2pw settings",
            command: "bdd2pw.openSettings",
            icon: new vscode.ThemeIcon("gear"),
          },
          {
            kind: "action",
            label: "Open last BDD_REVIEW.md",
            command: "bdd2pw.openLastReview",
            icon: new vscode.ThemeIcon("markdown"),
          },
        ];
    }
  }
}

/** Human-readable relative time for a millisecond timestamp. */
function timeAgo(ms: number): string {
  const delta = Date.now() - ms;
  const sec = Math.floor(delta / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  return `${day}d ago`;
}
