/**
 * Status-bar button — appears on the right side of the bottom bar
 * whenever the active editor is a Gherkin .feature file. Click runs
 * `bdd2pw.scaffoldFile` on the active document.
 *
 * Hidden in every other context so it doesn't clutter the bar when the
 * user is working on unrelated files.
 */

import * as vscode from "vscode";

export function createStatusBarItem(): vscode.Disposable {
  const item = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    100,
  );
  item.text = "$(beaker) bdd2pw";
  item.tooltip = "Scaffold Playwright tests from this .feature file";
  item.command = "bdd2pw.scaffoldFile";

  const updateVisibility = (editor: vscode.TextEditor | undefined) => {
    if (editor?.document.uri.fsPath.toLowerCase().endsWith(".feature")) {
      item.show();
    } else {
      item.hide();
    }
  };

  updateVisibility(vscode.window.activeTextEditor);

  const sub = vscode.window.onDidChangeActiveTextEditor(updateVisibility);

  return {
    dispose: () => {
      sub.dispose();
      item.dispose();
    },
  };
}
