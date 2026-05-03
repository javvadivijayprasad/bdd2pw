/**
 * Thin facade over `@vijaypjavvadi/pw-emit`. All POM/spec rendering happens
 * in `pw-emit`; bdd2pw only owns:
 *   - the orchestration (which IRs to feed in, in what order)
 *   - the IR→pw-emit adaptation (bdd2pw's IR carries scaffolder-only fields
 *     like `filePath` and `exists` that pw-emit doesn't need)
 *
 * See docs/PHASE_0_PLAN.md and docs/ARCHITECTURE.md §5.
 */

import {
  emitPageObject as pwEmitPageObject,
  emitTestSpec as pwEmitTestSpec,
  type PageObjectIR as PwPageObjectIR,
  type LocatorChoice as PwLocatorChoice,
  type TestSpecIR,
  type EmitResult,
  type EmitPageObjectOptions,
} from "@vijaypjavvadi/pw-emit";

import type {
  PageObjectIR,
  LocatorChoice,
  StepBinding,
  ReviewItem,
} from "../types";
import { camelCase } from "../utils/naming";

export class EmitterConsistencyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EmitterConsistencyError";
  }
}

export interface EmitPageObjectInput {
  pom: PageObjectIR;
  /** When `'augment'`, an existing file is being updated — caller must
   *  ensure the IR already contains both existing and new fields/methods.
   *  See FR-19 in docs/SCOPE.md. */
  mode: "create" | "augment";
  existing?: string;
  /** Wrap locator initialisers in `healOrThrow(...)` for runtime healing. */
  selfHealingShim?: boolean;
}

export interface EmitTestFileInput {
  describeName: string;
  beforeEach?: StepBinding[];
  scenarios: { name: string; bindings: StepBinding[] }[];
  pomImports: { className: string; fromPath: string }[];
}

export type { EmitResult };

/**
 * Adapt a bdd2pw `LocatorChoice` to a pw-emit `LocatorChoice`.
 * Drops scaffolder-only fields (`source`, `confidence`).
 */
function toPwLocatorChoice(c: LocatorChoice): PwLocatorChoice {
  return { api: c.api, args: c.args, fieldName: c.fieldName };
}

/**
 * Adapt a bdd2pw `PageObjectIR` to a pw-emit `PageObjectIR`.
 * Drops scaffolder-only fields (`filePath`, `url`, `exists`); converts
 * methods (which already carry pre-rendered TS bodies in bdd2pw).
 */
function toPwPageObjectIR(pom: PageObjectIR): PwPageObjectIR {
  return {
    className: pom.className,
    fields: pom.fields.map(toPwLocatorChoice),
    methods: pom.methods.map((m) => ({
      name: m.name,
      params: m.params,
      body: m.body,
    })),
  };
}

export function emitPageObject(input: EmitPageObjectInput): EmitResult {
  if (input.mode === "augment" && !input.existing) {
    throw new EmitterConsistencyError(
      `emitPageObject(mode: 'augment') requires the existing file contents — caller must read the file first.`,
    );
  }
  const opts: EmitPageObjectOptions = { selfHealingShim: input.selfHealingShim };
  return pwEmitPageObject(toPwPageObjectIR(input.pom), opts);
}

/**
 * Render a Gherkin-derived test spec via pw-emit.
 *
 * The bdd2pw caller passes `StepBinding[]` per scenario (still tied to
 * Gherkin step text + POM method calls); the facade renders them into TS
 * body strings and hands the resulting `TestSpecIR` to pw-emit.
 *
 * **POM instantiation:** every test body and every hook body is prefixed
 * with `const <pageVar> = new <ClassName>(page);` for each imported POM.
 * Without this, `await loginPage.goto()` references an undeclared variable.
 * Each scope gets its own fresh instance — POM construction is just
 * Locator creation, which is cheap.
 */
export function emitTestFile(input: EmitTestFileInput): EmitResult {
  const prelude = input.pomImports.map(
    (p) => `const ${camelCase(p.className)} = new ${p.className}(page);`,
  );

  const ir: TestSpecIR = {
    describeName: input.describeName,
    pomImports: input.pomImports,
    beforeEach:
      input.beforeEach && input.beforeEach.length
        ? [{ body: bindingsToBody(input.beforeEach, prelude) }]
        : undefined,
    tests: input.scenarios.map((s) => ({
      name: s.name,
      body: bindingsToBody(s.bindings, prelude),
    })),
  };
  return pwEmitTestSpec(ir);
}

/**
 * Render a list of step bindings into a sequence of TS statements + comments.
 *
 * Each binding becomes either:
 *   - `await <pageVar>.<method>(<args>);` for POM calls
 *   - `await expect(<locator>).<matcher>(<expected>);` for assertions
 *   - `// TODO: <step text> — <warning>` when no clean mapping was found
 *
 * One blank line between bindings to keep the rendered spec readable.
 * `prelude` lines (POM instantiation) are emitted first, followed by a
 * blank line, then the bindings.
 */
function bindingsToBody(bindings: StepBinding[], prelude: string[] = []): string {
  const lines: string[] = [];
  if (prelude.length > 0) {
    lines.push(...prelude);
    lines.push("");
  }
  for (const b of bindings) {
    lines.push(`// ${b.step.keyword} ${b.step.text}`);
    if (b.customBody) {
      // Compound step — body has multiple statements pre-rendered.
      for (const line of b.customBody.split("\n")) lines.push(line);
    } else if (b.pomCall) {
      const args = b.pomCall.args.join(", ");
      lines.push(`await ${b.pomCall.page}.${b.pomCall.method}(${args});`);
    } else if (b.assertion) {
      const expected =
        b.assertion.expected !== undefined ? b.assertion.expected : "";
      lines.push(
        `await expect(${b.assertion.locator}).${b.assertion.matcher}(${expected});`,
      );
    } else {
      lines.push(`// TODO: ${b.warning ?? "no rule matched this step"}`);
    }
    lines.push("");
  }
  // Trim trailing blank
  while (lines.length && lines[lines.length - 1] === "") lines.pop();
  return lines.join("\n");
}
