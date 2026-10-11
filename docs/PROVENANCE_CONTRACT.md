# Provenance contract (bdd2pw)

bdd2pw records, for every step in every emitted scenario, **which lane bound that step**: the deterministic rule table, the LLM fallback, or none (TODO). The attribution exists in two forms, both covered by SemVer from v4.4.1 onwards:

1. **In-spec `// @bdd2pw` comments** — one line above each binding statement, inside every `test.step` body.
2. **The `*.spec.meta.json` sidecar** — a per-spec JSON file with the full provenance record.

Both forms carry the same information. The in-spec comment is for human review and shell grepping. The sidecar is for programmatic consumers (orchestrators, dashboards, release-gate tools).

This document is the SemVer-covered contract. Anything stated here holds across patch and minor releases; breaking the contract requires a major-version bump.

---

## In-spec comments

### Example

```typescript
await test.step("When I enter my username", async () => {
  // @bdd2pw lane=rule rule=rule-14 pack=banking
  await loginPage.usernameInput.fill("standard_user");
});

await test.step("When I enter my address", async () => {
  // @bdd2pw lane=llm provider=anthropic model=claude-sonnet-4-6 cached=false governance=sanitised
  await addressPage.street.fill("...");
});

await test.step("Then the customer should see a confirmation", async () => {
  // @bdd2pw lane=todo
  // TODO: no rule matched: "Then the customer should see a confirmation"
});
```

### Grammar

```
provenance-comment = "// @bdd2pw" SP field *(SP field)
field              = lane-field | rule-field | pack-field
                   | provider-field | model-field | cached-field | governance-field
lane-field         = "lane=" ( "rule" | "llm" | "todo" )
rule-field         = "rule=" ident            ; required when lane=rule, when known
pack-field         = "pack=" pack-name        ; present iff rule came from a domain pack
provider-field     = "provider=" ( "anthropic" | "openai" | "gemini" )  ; required when lane=llm
model-field        = "model=" ident
cached-field       = "cached=" ( "true" | "false" )
governance-field   = "governance=" ( "sanitised" | "skipped" )

SP        = " "              ; exactly one ASCII space between fields
ident     = 1*( ALPHA / DIGIT / "-" / "_" / "." )
pack-name = "banking" | "healthcare" | "insurance" | "retail"
          | "gov" | "education" | "telecom"              ; v4.4.x set
          ; new domain packs added in later minor releases append here
```

### Rules the parser can rely on

1. **One line per step.** `// @bdd2pw` always starts at column 0 of the comment line (after whatever indentation the surrounding `test.step` arrow produced). The line never wraps.
2. **`// @bdd2pw` is always the first `//` comment inside the `test.step` body.** It appears before any `// TODO:` comment, before any `customBody` content, before any binding statement.
3. **Field order is fixed.**
   - Rule lane: `lane=rule` → `rule=<id>` (if known) → `pack=<name>` (if domain pack).
   - LLM lane: `lane=llm` → `provider=<name>` → `model=<name>` → `cached=<bool>` → `governance=<mode>`.
   - TODO lane: `lane=todo` and nothing else.
4. **Field keys never change spelling.** `lane`, `rule`, `pack`, `provider`, `model`, `cached`, `governance` are the only key names and remain in lowercase.
5. **New fields may be APPENDED to the end of their lane's block in a minor release.** Example: a future `latency=123ms` field could join the LLM lane after `governance=`. Parsers that match on key name will keep working.
6. **New fields are never PREPENDED or INSERTED.** The order rule above is permanent.
7. **Removing a field is a major-version change.** Removing `cached` from the LLM lane would be a v5.0.0 move, not a v4.x move.
8. **Removing or renaming the enum members in `lane-field`, `provider-field`, or `governance-field` is also a major-version change.** Adding new members is minor (e.g. a hypothetical `lane=hybrid` for mixed-mode bindings would be minor).
9. **`cached` is lowercase `true` / `false`.** Not `True`, not `1`.
10. **`governance` is `sanitised` (British spelling).** This matches the sidecar schema from v4.4.0 and the governance sidecar's own vocabulary. Not `sanitized`, not `scrubbed`.

### Edge cases

- **Binding with no provenance** (pre-v4.4 cached binding, hand-edited spec that lost the comment, binding produced by an older client that didn't set the field) → the comment line emits `// @bdd2pw lane=rule` with no further fields. Parsers should treat the absence of `rule=` as "unknown rule, treat as rule lane for aggregation purposes."
- **LLM binding missing `model`** → the field still appears with value `(unknown)` (literal 10 characters including parens). This matches the sidecar's historical convention.
- **TODO step with a stale provenance block on the binding** (should not happen in practice, but defend) → `lane=todo` wins; the stale llm/rule block is discarded.

### Opt-out

```bash
bdd2pw scaffold ... --no-provenance-comments
```

Or programmatically:

```ts
await scaffold({ ..., provenanceComments: false });
```

Default is **on**. The flag exists for byte-stable comparisons against pre-v4.4.1 output (bench harnesses, diff tests). All future bdd2pw features assume the comments are present.

---

## `*.spec.meta.json` sidecar

### Example

```json
{
  "version": "4.4.1",
  "source": "features/login.feature",
  "scenarios": [
    {
      "name": "Login with valid credentials",
      "tags": ["@positive"],
      "steps": [
        {
          "id": "0001",
          "keyword": "Given",
          "text": "I am on the login page",
          "intent": "navigation",
          "locator": "loginPage.goto",
          "assertion": "goto",
          "rule": { "ruleId": "rule-01" }
        },
        {
          "id": "0002",
          "keyword": "When",
          "text": "I enter the SSN 123-45-6789",
          "intent": "interaction",
          "locator": "loginPage.ssnField.fill",
          "assertion": "ssnField.fill",
          "rule": { "ruleId": "domain-03", "pack": "banking" }
        },
        {
          "id": "0003",
          "keyword": "When",
          "text": "I confirm with my recovery phrase",
          "intent": "interaction",
          "locator": "loginPage.recoveryField.fill",
          "assertion": "recoveryField.fill",
          "rule": null,
          "llm": {
            "provider": "anthropic",
            "model": "claude-sonnet-4-6",
            "cached": false,
            "governance": "sanitised",
            "at": "2026-10-11T09:00:00.000Z"
          }
        },
        {
          "id": "0004",
          "keyword": "Then",
          "text": "I should see a success animation",
          "intent": "todo"
        }
      ]
    }
  ]
}
```

### Schema

```ts
interface MetaSidecar {
  version: string;              // bdd2pw package version
  source: string;               // .feature path relative to repo
  scenarios: MetaSidecarScenario[];
}

interface MetaSidecarScenario {
  name: string;
  tags?: string[];              // "@positive", "@llm-generated", "@story:SCRUM-8", etc.
  steps: MetaSidecarStep[];
}

interface MetaSidecarStep {
  id: string;                   // "0001", "0002", ... (per scenario, source order)
  keyword: string;              // "Given" | "When" | "Then" | "And" | "But"
  text: string;                 // original Gherkin step text (never normalised)
  intent: "navigation" | "interaction" | "assertion" | "api" | "compound" | "todo";
  locator?: string;             // when the binding has one
  assertion?: string;           // matcher name or method name

  // v4.4+ provenance (both fields SemVer-covered):

  // When present:
  //   rule === null  → step is LLM-bound; see `llm` block.
  //   rule === { ruleId, pack? } → step is rule-bound.
  // When absent: pre-v4.4 sidecar; parsers should default to "unknown rule lane".
  rule?: null | { ruleId: string; pack?: string };

  // Present iff this step was bound by the LLM fallback.
  llm?: {
    provider: "anthropic" | "openai" | "gemini";
    model: string;
    cached: boolean;
    governance: "sanitised" | "skipped";
    at: string;                 // ISO 8601, step record time
  };
}
```

### SemVer rules

The same rules that govern the in-spec comment grammar apply to the JSON schema:

- Field keys never change spelling.
- New optional fields may be added in a minor release.
- Making an optional field required is a major-version change.
- Removing a field is a major-version change.
- Changing an enum type (e.g. `provider`, `governance`) to a different value set is major.

The `version` string on each sidecar lets consumers detect which contract version produced the file. v4.4.0 and v4.4.1 produce bit-identical sidecar schemas (the v4.4.1 addition is the in-spec comment emitter, not the sidecar).

---

## How attestqa (and others) should parse this

### To count scenarios per lane

```bash
# scenarios with any LLM step
grep -l "^// @bdd2pw lane=llm" tests/*.spec.ts | wc -l

# scenarios with any TODO step
grep -l "^// @bdd2pw lane=todo" tests/*.spec.ts | wc -l
```

Or walk the sidecar JSON — same answer either way.

### To look up a step's provenance from the spec

The in-spec comment is always the first comment line inside a `test.step` body. In a line-walking parser:

```python
if line.strip().startswith("await test.step("):
    # ...read until "async () => {"
    peek = next_nonblank_line()
    assert peek.startswith("// @bdd2pw")
    fields = dict(f.split("=", 1) for f in peek.removeprefix("// @bdd2pw ").split())
    lane = fields["lane"]        # "rule" | "llm" | "todo"
```

### To diff provenance across releases

The sidecar is the right surface. In-spec comments can be formatted or wrapped by downstream tooling (prettier, eslint-fix); the sidecar is a stable JSON that's safe to diff.

### To gate CI on "no new LLM steps this PR"

```bash
# Count LLM steps in this scaffold
grep -c "^// @bdd2pw lane=llm" tests/*.spec.ts
```

Compared against a baseline from the previous commit, this is a merge-gate signal — but the recommendation (same as `bdd2pw coverage` and `bdd2pw quarantine-stats`) is to **report, not gate**. The number should drive conversations, not blocks.

---

## Change log for this contract

- **v4.4.0** — introduced sidecar provenance (`rule` + `llm` blocks). In-spec comments not yet emitted.
- **v4.4.1** — in-spec `// @bdd2pw` comments emitted by default. Grammar as specified above. Opt-out via `--no-provenance-comments`.

Later changes to this contract will be noted here and in the main `CHANGELOG.md` with the minor-or-major version bump that introduces them.
