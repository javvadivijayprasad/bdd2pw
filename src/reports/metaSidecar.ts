/**
 * v3.2.0 — TestForge handoff Issue 10. Emit a `<spec-stem>.spec.meta.json`
 * file alongside each generated `.spec.ts` describing every step's
 * semantic intent. Lets downstream tooling (visual regression, defect
 * analysis, self-healing pipelines) consume bdd2pw's understanding
 * without re-parsing the TypeScript output.
 *
 * Sidecar shape (stable across patch versions):
 *
 *   {
 *     "version": "<bdd2pw version>",
 *     "source": "<.feature path relative to repo>",
 *     "scenarios": [
 *       {
 *         "name": "Login with valid credentials",
 *         "tags": ["@positive"],
 *         "steps": [
 *           { "id": "0001", "keyword": "Given", "text": "...",
 *             "intent": "navigation", "locator": "page",
 *             "assertion": "goto" },
 *           ...
 *         ]
 *       }
 *     ]
 *   }
 *
 * `intent` is one of: navigation | interaction | assertion | api |
 * compound | todo. Inferred from the binding shape (pomCall vs
 * assertion vs customBody vs warning). When the binding carries
 * `apiContext`, intent is `api` regardless of which sub-field is set.
 */

import type { StepBinding } from "../types";

export interface MetaSidecarStep {
  id: string;
  keyword: string;
  text: string;
  intent: "navigation" | "interaction" | "assertion" | "api" | "compound" | "todo";
  /** Resolved locator string when the binding has one. */
  locator?: string;
  /** Matcher name or method name when the binding has one. */
  assertion?: string;
}

export interface MetaSidecarScenario {
  name: string;
  tags?: string[];
  steps: MetaSidecarStep[];
}

export interface MetaSidecar {
  version: string;
  source: string;
  scenarios: MetaSidecarScenario[];
}

/**
 * Classify a step binding's intent. Order of checks matters:
 *   1. apiContext flag → "api" (overrides every other shape since API
 *      bindings often carry customBody + assertion together).
 *   2. warning-only → "todo".
 *   3. pomCall with method "goto" → "navigation".
 *   4. pomCall otherwise → "interaction".
 *   5. assertion → "assertion".
 *   6. customBody → "compound".
 *   7. fallback → "todo".
 */
function classifyIntent(b: StepBinding): MetaSidecarStep["intent"] {
  if (b.apiContext) return "api";
  if (!b.pomCall && !b.assertion && !b.customBody && b.warning) return "todo";
  if (b.pomCall) {
    return b.pomCall.method === "goto" ? "navigation" : "interaction";
  }
  if (b.assertion) return "assertion";
  if (b.customBody) return "compound";
  return "todo";
}

/**
 * Convert a list of bindings (one scenario's worth) into the meta
 * sidecar's `steps` array. IDs are zero-padded 4 digits, sequential
 * in source order — same convention as the optional step boundary
 * markers (v3.1.0 Issue 5), so post-processors can correlate the
 * sidecar to the in-source markers when both features are enabled.
 */
export function bindingsToMetaSteps(
  bindings: StepBinding[],
): MetaSidecarStep[] {
  return bindings.map((b, idx) => {
    const step: MetaSidecarStep = {
      id: String(idx + 1).padStart(4, "0"),
      keyword: b.step.keyword,
      text: b.step.text,
      intent: classifyIntent(b),
    };
    if (b.pomCall) {
      step.locator = `${b.pomCall.page}.${b.pomCall.method}`;
      step.assertion = b.pomCall.method;
    } else if (b.assertion) {
      step.locator = b.assertion.locator;
      step.assertion = b.assertion.matcher;
    }
    return step;
  });
}
