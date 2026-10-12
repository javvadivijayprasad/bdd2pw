# bdd2pw v4.4 — brief for three slices

**Written:** 2026-09-25, against v4.3.2.
**Order:** 1 → 2 → 3. Each slice ships on its own; 2 reads what 1 records, 3 is independent.

**The thread running through all three:** a reader of a generated suite should be able to tell
*where each line came from* — a deterministic rule, a model, or a person — and act on that
difference. v4.3 made the LLM fallback safe (governance sidecar, cache, candidate-rules log). v4.4
makes it **legible**, then **measurable**, then extends the rule table to a new surface.

---

## Slice 1 — LLM quarantine lane (~1–2 days)

### The problem

With `--llm` on, a step bound by the model and a step bound by the rule table are indistinguishable
in the emitted spec. A team cannot say "run only what our rules produced" in CI, and cannot review
the rest on its own schedule. The tag is the missing half of the pair the LinkedIn commenter
described — DOM-hash answers *is this locator stable*, this answers *who wrote this step*.

### Scope

- **Tag at the scenario level.** A scenario whose emission used the LLM for one or more steps is
  emitted with `@llm-generated` alongside its existing tags (`src/emitters/facade.ts` already
  threads `tags` through to `// @tag` comments; `llmStepMatcher` knows which steps it bound).
- **Step-level truth, scenario-level tag.** Playwright filters by title/tag, so the lane has to be
  a scenario tag; the per-step detail goes in the sidecar (below), not in the tag.
- **Provenance in `*.spec.meta.json`** (`src/reports/metaSidecar.ts`): for each step bound by the
  model, record `{ step, rule: null, llm: { provider, model, promptHash, governance: "sanitised"
  | "skipped", cached: boolean }, at }`. Provider and model come from the client; `promptHash` is
  already computable from the cache key. A run without `--llm` writes no such entries.
- **CLI: `bdd2pw quarantine-stats <repo>`** — reads `*.spec.meta.json` (and
  `artefacts/candidate-rules.jsonl`) and prints, per feature and per pack:
  - scenarios total / `@llm-generated` / deterministic
  - steps bound by rules vs by the model, and the cache-hit share of the latter
  - **promotions**: LLM-bound steps whose shape is now covered by a deterministic rule (join
    `candidate-rules.jsonl` against the current rule table). This number going up is the story
    slice 2 will tell in full.
  - `--json` for CI, human table by default; writes `artefacts/quarantine-stats.json`.
- **Docs**: one section in README — the two-lane workflow, with the exact commands.

### The lane, as a user runs it

```bash
npx playwright test --grep-invert @llm-generated     # trusted lane: rules only
npx playwright test --grep @llm-generated            # review lane
npx bdd2pw quarantine-stats .                        # how big is each lane, and is it shrinking
```

### Acceptance

1. A feature scaffolded **without** `--llm` emits no `@llm-generated` tag and a sidecar with no
   `llm` entries.
2. A feature with one unbound step, scaffolded **with** `--llm`, emits exactly that scenario tagged
   and names the step in the sidecar with provider, model and `governance: "sanitised"`.
3. `--grep-invert @llm-generated` runs strictly the untagged scenarios (a real Playwright run in the
   fixture repo, not a unit assertion about strings).
4. `quarantine-stats` on a fixture repo reports the counts above and exits non-zero only on a read
   error — it is a report, not a gate.
5. A scenario that was tagged and is re-scaffolded after its step becomes rule-bound loses the tag.

### Non-goals

- No policy: bdd2pw does not refuse to run a lane, and CI wiring is the team's.
- No change to what the LLM path is allowed to do; `--llm-skip-governance` stays as it is.

---

## Slice 2 — Coverage analyzer (~2–3 days)

### The problem

Nobody can see what the deterministic rule table is actually worth on their suite: which rules fire,
which packs earn their place, which rules have never matched anything in six months. Slice 1 makes
provenance visible per scenario; this aggregates it across a repo and turns it into decisions
(retire a rule, add a pack, reword a feature).

### Scope

- **CLI: `bdd2pw coverage <repo>`**, reading `*.spec.meta.json` sidecars + `heal-events.jsonl` +
  `candidate-rules.jsonl`.
- **Reports**
  - *rule hit rate*: rule id → features and steps it bound, ordered by use.
  - *per-pack hit rate*: how much each domain pack contributed; a pack with no hits on this repo is
    a candidate for `domains: [...]` removal.
  - *dead rules*: in the table, never fired here — with a note that "never fired" is repo-scoped,
    not a verdict on the rule.
  - *promotion trail*: candidate rules proposed from LLM bindings → which became real rules →
    which of those now fire. The loop closing is the number worth publishing.
  - *heal pressure*: rules whose locators are healed most often (from `heal-events.jsonl`) — a rule
    that binds and then always needs healing is worse than no rule.
- **Output**: human table, `--json`, and `artefacts/coverage.json`. Same shape as
  `quarantine-stats.json` where they overlap, so a dashboard can read both.
- **Retire flow**: `--suggest-retire` lists dead rules as a copyable config stanza; it never edits
  the table itself.

### Acceptance

1. On the fixture repo, every rule that demonstrably fired appears with a count ≥ 1, and a
   deliberately unused pack appears under dead rules.
2. Promotion trail: a candidate rule from `candidate-rules.jsonl` that was added to the table and
   then fired is reported in all three states, in order.
3. `coverage` and `quarantine-stats` agree on the counts they share (one property test comparing
   both JSON outputs on the same repo).
4. Runs with no sidecars at all exit cleanly, saying which artefacts are missing and what produces
   them.

### Non-goals

- No historical database: it reads what is on disk now. Trends belong to whatever consumes the JSON.
- No automatic rule retirement.

---

## Slice 3 — Mobile dialect (~2–3 days)

### The problem

The rule table speaks desktop web. A mobile-web suite needs touch, swipe, scroll-into-view, pinch
and viewport-conditional assertions, and today every one of those steps falls through to the LLM or
to a TODO — which is exactly the lane slice 1 exists to make visible.

### Scope

- **New domain pack `mobile`**, opt-in via `domains: ["mobile"]`, reusing the existing emitter
  pipeline — no new codegen path.
- **Step families**
  - touch: tap, double-tap, long-press (`page.tap`, `dispatchEvent` where Playwright lacks a verb)
  - swipe / drag: direction + distance, resolved against the element's box
  - scroll: `scrollIntoViewIfNeeded`, "scroll until visible", end-of-list
  - pinch/zoom: only where Playwright can express it honestly; anything it cannot, the pack must
    REFUSE to bind rather than emit an approximation (the v3.0.0 URL-regex lesson).
  - responsive assertions: "at mobile width …", driven by the project's viewport rather than a
    hard-coded size.
- **Device context**: scenarios tagged `@mobile` scaffold against a mobile device descriptor
  (`devices["Pixel 7"]` by default, configurable), and the emitted spec says which.
- **Docs**: a worked example feature + the generated spec, in `examples/`.

### Acceptance

1. A feature of ~10 mobile steps scaffolds with zero unbound steps and runs green against a small
   fixture page.
2. Every pinch/zoom step either emits a real Playwright action or a TODO naming why — never a
   plausible-looking approximation.
3. With `domains` omitted, none of the mobile rules fire (no regression for desktop suites).
4. `quarantine-stats` on the mobile example shows the pack binding the steps that previously went to
   the LLM — the number that justifies the slice.

### Non-goals

- No native-app support (Appium and friends are a different tool).
- No new browser automation: whatever Playwright cannot do, the pack does not pretend to.

---

## How these are built

- One agent per slice, in order, working in `E:\…\Application\bdd2pw`. Each edits the working tree
  and runs `npm test`; **none commits or publishes** — the diff is reviewed first.
- A slice is done when its acceptance list passes *and* the existing suite is unchanged.
- Slice 2 must not change slice 1's JSON shape; if it needs a field, slice 1's writer adds it.
