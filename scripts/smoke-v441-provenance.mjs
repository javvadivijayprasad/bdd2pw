/**
 * v4.4.1 smoke test for the in-spec `// @bdd2pw` provenance comment
 * emitter. Bypasses vitest so it works in environments without rollup
 * native binaries. Run after `npm run build`.
 */

import { emitTestFile } from "../dist/emitters/facade.js";

let passed = 0;
let failed = 0;
function check(name, cond, actual) {
  if (cond) {
    console.log(`  PASS  ${name}`);
    passed++;
  } else {
    console.log(`  FAIL  ${name}`);
    console.log(`        got: ${JSON.stringify(actual).slice(0, 400)}`);
    failed++;
  }
}

const pomCall = { page: "loginPage", method: "usernameInput.fill", args: ['"x"'] };
const base = (b) =>
  emitTestFile({
    describeName: "scenario",
    scenarios: [{ name: "s", bindings: b }],
    pomImports: [{ className: "LoginPage", fromPath: "../pages/login.page" }],
  }).contents;

console.log("v4.4.1 — in-spec @bdd2pw provenance comment smoke test\n");

// Rule binding with ruleId + pack
{
  const out = base([
    {
      step: { keyword: "When", text: "step" },
      pomCall,
      provenance: { source: "rule", ruleId: "domain-03", pack: "banking" },
    },
  ]);
  check(
    "(1) rule+ruleId+pack → `lane=rule rule=domain-03 pack=banking`",
    out.includes("// @bdd2pw lane=rule rule=domain-03 pack=banking"),
    out.split("\n").find((l) => l.includes("@bdd2pw")),
  );
}

// Rule binding without pack
{
  const out = base([
    {
      step: { keyword: "When", text: "step" },
      pomCall,
      provenance: { source: "rule", ruleId: "rule-14" },
    },
  ]);
  check(
    "(2) rule without pack → `lane=rule rule=rule-14` (no pack=)",
    out.includes("// @bdd2pw lane=rule rule=rule-14") && !out.includes("pack="),
    out.split("\n").find((l) => l.includes("@bdd2pw")),
  );
}

// LLM binding
{
  const out = base([
    {
      step: { keyword: "When", text: "step" },
      pomCall,
      provenance: {
        source: "llm",
        llm: {
          provider: "openai",
          model: "gpt-4o-mini",
          cached: false,
          governance: "sanitised",
          at: "2026-10-11T09:00:00.000Z",
        },
      },
    },
  ]);
  check(
    "(3) llm → `lane=llm provider=openai model=gpt-4o-mini cached=false governance=sanitised`",
    out.includes(
      "// @bdd2pw lane=llm provider=openai model=gpt-4o-mini cached=false governance=sanitised",
    ),
    out.split("\n").find((l) => l.includes("@bdd2pw")),
  );
}

// Cached LLM binding with skipped governance
{
  const out = base([
    {
      step: { keyword: "When", text: "step" },
      pomCall,
      provenance: {
        source: "llm",
        llm: {
          provider: "gemini",
          model: "gemini-2.5-flash",
          cached: true,
          governance: "skipped",
          at: "2026-10-11T09:00:00.000Z",
        },
      },
    },
  ]);
  check(
    "(4) cached+skipped llm → `cached=true governance=skipped`",
    out.includes("cached=true") && out.includes("governance=skipped"),
    out.split("\n").find((l) => l.includes("@bdd2pw")),
  );
}

// TODO step
{
  const out = base([
    {
      step: { keyword: "Then", text: "should see confirmation" },
      warning: "no rule matched",
    },
  ]);
  const line = out.split("\n").find((l) => l.includes("@bdd2pw"));
  check(
    "(5) TODO step → `lane=todo` and nothing else",
    line?.trim() === "// @bdd2pw lane=todo",
    line,
  );
}

// Legacy binding without provenance
{
  const out = base([
    {
      step: { keyword: "When", text: "step" },
      pomCall,
    },
  ]);
  const line = out.split("\n").find((l) => l.includes("@bdd2pw"));
  check(
    "(6) binding with no provenance → bare `lane=rule` fallback",
    line?.trim() === "// @bdd2pw lane=rule",
    line,
  );
}

// Opt-out
{
  const out = emitTestFile({
    describeName: "s",
    scenarios: [
      {
        name: "s",
        bindings: [
          {
            step: { keyword: "When", text: "x" },
            pomCall,
            provenance: { source: "rule", ruleId: "rule-01" },
          },
        ],
      },
    ],
    pomImports: [{ className: "LoginPage", fromPath: "../pages/login.page" }],
    provenanceComments: false,
  }).contents;
  check(
    "(7) provenanceComments: false suppresses all @bdd2pw lines",
    !out.includes("@bdd2pw") && out.includes("usernameInput.fill"),
    out.slice(0, 200),
  );
}

// One comment per step on a multi-step scenario
{
  const out = base([
    {
      step: { keyword: "Given", text: "first" },
      pomCall,
      provenance: { source: "rule", ruleId: "rule-01" },
    },
    {
      step: { keyword: "When", text: "second" },
      pomCall,
      provenance: {
        source: "llm",
        llm: {
          provider: "anthropic",
          model: "claude-sonnet-4-6",
          cached: false,
          governance: "sanitised",
          at: "2026-10-11T09:00:00.000Z",
        },
      },
    },
    {
      step: { keyword: "Then", text: "third" },
      warning: "no rule matched",
    },
  ]);
  const occurrences = (out.match(/@bdd2pw lane=/g) || []).length;
  check(
    "(8) three-step scenario → exactly 3 @bdd2pw lines (rule/llm/todo in order)",
    occurrences === 3 &&
      out.includes("lane=rule rule=rule-01") &&
      out.includes("lane=llm provider=anthropic") &&
      out.includes("lane=todo"),
    { occurrences },
  );
}

console.log("");
console.log(`Results: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
