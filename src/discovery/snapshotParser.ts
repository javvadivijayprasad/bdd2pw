/**
 * Convert a `PageSnapshot` into a flat list of `ElementIR` candidates that
 * the locator picker can rank.
 *
 * Accepts two snapshot shapes:
 *   1) `accessibilityTree` is already an array of element-shaped objects
 *      (the file-snapshot fallback uses this — easy to author by hand)
 *   2) `accessibilityTree` is a Playwright a11y tree node (with `children[]`)
 *      — flattened recursively.
 */

import type { ElementIR } from "../types";
import type { PageSnapshot } from "./mcpClient";

export function parseSnapshot(snapshot: PageSnapshot): ElementIR[] {
  const tree = snapshot.accessibilityTree;
  if (Array.isArray(tree)) {
    return tree.map(toElementIR);
  }
  if (tree && typeof tree === "object") {
    const out: ElementIR[] = [];
    walk(tree as any, out);
    return out;
  }
  return [];
}

function walk(node: any, out: ElementIR[]): void {
  if (!node) return;
  // Skip the synthetic root node if it has no role
  if (node.role || node.name || node.tag) {
    out.push(toElementIR(node));
  }
  for (const child of node.children ?? []) {
    walk(child, out);
  }
}

function toElementIR(raw: any): ElementIR {
  return {
    role: raw.role || undefined,
    name: raw.name || undefined,
    label: raw.label || undefined,
    placeholder: raw.placeholder || undefined,
    testId: raw.testId || raw["data-testid"] || undefined,
    text: raw.text || raw.innerText || undefined,
    cssSelector: raw.cssSelector || raw.css || undefined,
    xpath: raw.xpath || undefined,
    tag: raw.tag || raw.tagName?.toLowerCase() || "",
    bounds: raw.bounds,
  };
}
