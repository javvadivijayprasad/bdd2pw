# Phase 0 — Extract `@vijaypjavvadi/pw-emit` (Plan v0.1)

> **Status:** Draft. Revises the original "lift sel2pw emitters as-is" approach after reading sel2pw source.
> **Last updated:** 2026-05-02

## What changed since SCOPE.md

When I drafted the original plan I assumed sel2pw's emitters could be lifted with light surgery. After reading them end-to-end (`pageObjectEmitter.ts` 280 LOC, `testClassEmitter.ts` 177 LOC) the reality is messier:

- **Both emitters call `transformMethodBody()`** — a sel2pw-specific Java-source rewriter that does WebDriver→Page mapping, TestNG→expect mapping, Hamcrest unwinding, Java idiom translation. Calling this from `bdd2pw` makes no sense (no Java bodies to rewrite).
- **`pageObjectEmitter` ships four numbered patches** (I, P, U, AA) — each a regex-based fixup specific to a Java/Selenium edge case found in production: `By` parameter rewriting, Patch P parent-class call wrapping, Patch U string-literal protection from Patch P, Patch AA recursive placeholder restoration. None of these apply to `bdd2pw`, but they're tangled into the emit loop.
- **`rewriteSeleniumType()` and `javaTypeToTs()`** convert Java types to TS — `bdd2pw` needs neither.

The truly **pure, format-agnostic** code is much smaller than the original SCOPE assumed:

| sel2pw file | LOC | Truly shareable? |
|---|---|---|
| `utils/naming.ts` | 78 | **Mostly** — minus `javaTypeToTs` (~10 LOC) |
| `utils/indent.ts` | 36 | **All** |
| `emitters/projectEmitter.ts` | 68 | **All** |
| `transformers/locatorMapper.ts` | 54 | **Half** — render helpers yes, `ByStrategy` no |
| `emitters/pageObjectEmitter.ts` | 280 | **No** — deeply Java-coupled |
| `emitters/testClassEmitter.ts` | 177 | **No** — deeply Java-coupled |
| `transformers/{api,assertion,hamcrest,javaIdiom,advanced}Map.ts` | ~700 | **No** — all Java-source rewriters |

So the lift-and-shift dream was wrong. ~150 LOC of pure utilities, ~600 LOC of Java-specific emitters that don't belong in a shared package.

## Revised approach: build pw-emit fresh; sel2pw migration is optional + deferred

**Decision:** `pw-emit` is **not** an extract-from-sel2pw refactor. It's a **fresh, IR-driven emitter library** designed for both consumers. The pure utilities lift cleanly; the emitter logic gets rewritten with a clean IR contract.

### What lives in `pw-emit` v0.1 (this Phase 0)

| Module | Origin | Notes |
|---|---|---|
| `src/types.ts` | New, informed by both sel2pw + bdd2pw IRs | Generic IRs — input source agnostic |
| `src/naming.ts` | Lifted from sel2pw `utils/naming.ts` | All exports except `javaTypeToTs` |
| `src/indent.ts` | Lifted as-is from sel2pw `utils/indent.ts` | Untouched |
| `src/locatorRender.ts` | New | Takes a `LocatorChoice` (already-decided) and renders the TS expression. **No** `ByStrategy` here — that stays in sel2pw. |
| `src/pageObjectEmitter.ts` | New | IR → TS class. **No** body rewriting. Method bodies arrive pre-rendered as TS strings via `pomMethod.body`. |
| `src/testEmitter.ts` | New | IR → TS spec. **No** body rewriting. Step bodies arrive pre-rendered. |
| `src/projectEmitter.ts` | Lifted from sel2pw `emitters/projectEmitter.ts` | File I/O + template copy — generic |
| `templates/{package.json,playwright.config.ts,tsconfig.json,gitignore}.tmpl` | Lifted from sel2pw | Identical content; consumers pass overrides if needed |

Total: ~600 LOC of which ~200 are direct lifts and ~400 are fresh-but-small emitter code.

### What sel2pw keeps doing (no change in this phase)

Everything sel2pw currently has stays. sel2pw's `emitters/pageObjectEmitter.ts`, `emitters/testClassEmitter.ts`, `transformers/*Map.ts`, `transformers/bodyTransformer.ts` — untouched. sel2pw v1.0.0 ships unchanged.

### sel2pw migration onto `pw-emit` — DEFERRED (post-bdd2pw-v1.0)

The original SCOPE made `sel2pw@1.1.0` running on `pw-emit` an acceptance criterion for `bdd2pw@1.0.0`. **Recommend dropping that coupling** because:

1. sel2pw is in production with 15-codebase validation. Migrating its emitters carries real regression risk that doesn't help bdd2pw ship faster.
2. The body-rewriting logic in sel2pw is the *opposite* of what bdd2pw needs. Sharing it creates a maintenance burden, not a DRY win.
3. sel2pw can adopt pw-emit's `naming` + `indent` + `projectEmitter` utilities incrementally without touching the high-risk `pageObjectEmitter`. That's a v1.2-level cleanup, not a v1.0 blocker.

**Revised acceptance criterion (replaces SCOPE.md §15 #1):**
- ~~Phase 0 unblocked: `pw-emit@1.0.0` published; `sel2pw@1.1.0` released on it.~~
- **Phase 0 unblocked: `pw-emit@1.0.0` published. sel2pw migration is a follow-up at sel2pw's pace.**

This needs your sign-off before I scaffold pw-emit.

## `pw-emit` public contract (v1.0)

```ts
// types — input-agnostic
export interface LocatorChoice {
  api: 'getByRole' | 'getByLabel' | 'getByPlaceholder'
     | 'getByTestId' | 'getByText' | 'locator';
  args: string;        // raw TS expression body for the call args
  fieldName: string;   // camelCase TS field name
}

export interface PageObjectIR {
  className: string;
  fields: LocatorChoice[];
  methods: PomMethodIR[];
  imports?: string[];  // extra import lines beyond the default @playwright/test
}

export interface PomMethodIR {
  name: string;
  params: { name: string; type: string }[];
  /** Pre-rendered TS body (already async, already awaits). */
  body: string;
  jsdoc?: string;
  returnType?: string;  // default: 'Promise<void>'
}

export interface TestSpecIR {
  describeName: string;
  pomImports: { className: string; fromPath: string }[];
  beforeAll?: { body: string }[];
  beforeEach?: { body: string }[];
  afterEach?: { body: string }[];
  afterAll?: { body: string }[];
  tests: TestCaseIR[];
}

export interface TestCaseIR {
  name: string;
  /** Pre-rendered TS body. */
  body: string;
  jsdoc?: string;
  fixtures?: string[];   // default: ['page']
  tags?: string[];       // emitted as comments above the test()
  fixme?: string;        // if set, emit test.fixme() with this reason
}

export interface ReviewItem {
  severity: 'info' | 'warn' | 'error';
  file?: string;
  line?: number;
  message: string;
  suggestion?: string;
}

export interface EmitResult {
  contents: string;       // formatted TS
  warnings: ReviewItem[];
}

// emitters
export function emitPageObject(ir: PageObjectIR): EmitResult;
export function emitTestSpec(ir: TestSpecIR): EmitResult;
export function emitProject(opts: {
  outDir: string;
  templatesDir?: string;
  baseUrl?: string;
  projectName?: string;
}): Promise<{ filesWritten: string[]; warnings: ReviewItem[] }>;

// locator rendering
export function renderLocatorExpr(choice: LocatorChoice, pageVar?: string): string;
export function renderFieldDeclaration(choice: LocatorChoice): string;
export function renderFieldAssignment(choice: LocatorChoice, pageVar?: string): string;

// naming
export function toCamelCase(s: string): string;
export function toKebabCase(s: string): string;
export function toPascalCase(s: string): string;
export function pageObjectFileName(className: string): string;
export function testFileName(className: string): string;

// indent
export function dedentAndIndent(body: string, prefix: string): string;
```

**Key contract:** **Method bodies and test bodies arrive pre-rendered as TS strings.** pw-emit doesn't rewrite bodies. Each consumer is responsible for producing valid TS body source from its own input format (sel2pw does Java→TS body rewriting, bdd2pw assembles TS from `StepBinding`s).

This is the **single design choice** that makes pw-emit usable by both consumers. Without it, the package becomes a sel2pw private API.

## Acceptance criteria for `pw-emit@1.0.0`

1. Package builds: `tsc` exits 0.
2. ≥ 80% Vitest coverage on `naming`, `indent`, `locatorRender`, `pageObjectEmitter`, `testEmitter`.
3. Snapshot tests for `emitPageObject` and `emitTestSpec` against 5 representative IRs cover: empty page, 1-field page, multi-method page, page with self-healing shim, page with custom imports.
4. `emitProject` writes the 4 templates into a target dir; idempotent on re-run.
5. CI green Node 18/20/22 × Linux/macOS/Windows.
6. Published to npm as `@vijaypjavvadi/pw-emit@1.0.0` with provenance.
7. README documents the public contract + a 30-line "build a Page Object end-to-end" example.

## Repository layout

`E:\EB1A_Research\pw-emit\` — sibling to `bdd2pw\` and `Converter\` (sel2pw).

```
pw-emit/
├── README.md, CHANGELOG.md, LICENSE
├── package.json, tsconfig.json, vitest.config.ts, typedoc.json
├── .eslintrc.json, .prettierrc.json, .gitignore
├── src/
│   ├── index.ts            ← public exports
│   ├── types.ts            ← IRs
│   ├── naming.ts
│   ├── indent.ts
│   ├── locatorRender.ts
│   ├── pageObjectEmitter.ts
│   ├── testEmitter.ts
│   └── projectEmitter.ts
├── templates/
│   ├── package.json.tmpl
│   ├── playwright.config.ts.tmpl
│   ├── tsconfig.json.tmpl
│   └── gitignore.tmpl
├── tests/
│   ├── unit/{naming,indent,locatorRender}.test.ts
│   └── snapshot/{pageObject,testSpec}.test.ts
└── .github/workflows/{ci,release}.yml
```

## Hand-off to bdd2pw

After `pw-emit@1.0.0` is published (or installed locally via `npm link` for dev):

1. `bdd2pw/package.json` adds `"@vijaypjavvadi/pw-emit": "^1.0.0"` as a runtime dep.
2. `bdd2pw/src/emitters/facade.ts` becomes a thin wrapper:
   ```ts
   import { emitPageObject, emitTestSpec } from '@vijaypjavvadi/pw-emit';
   export { emitPageObject, emitTestSpec };
   ```
3. `bdd2pw`'s Phase 1 work (Gherkin parser, repo scanner, MCP discovery) feeds the same `PageObjectIR` / `TestSpecIR` types into `pw-emit`.

## Open questions for sign-off

| # | Question | Lean |
|---|---|---|
| P0-Q1 | Drop the "sel2pw@1.1.0 must run on pw-emit" coupling from SCOPE.md §15? | YES — defer to sel2pw v1.2 cleanup |
| P0-Q2 | pw-emit v1.0 ships emitter only, OR also includes a `selfHealingShim` option (sel2pw has one)? | Include the option; it's 5 lines and bdd2pw can use it too |
| P0-Q3 | Do templates ship inside the npm tarball, or as a separate `@vijaypjavvadi/pw-templates` package? | Inside the tarball. Smaller footprint, no extra coordination |
| P0-Q4 | License — MIT, matching sel2pw + bdd2pw? | YES |

## Decisions locked 2026-05-02 (defaults; revisit anytime)

- **P0-Q1: YES** — sel2pw migration deferred. Phase 0 unblocks bdd2pw without touching sel2pw.
- **P0-Q2: YES** — `selfHealingShim` option included in `emitPageObject`. ~5 LOC, valuable to both consumers.
- **P0-Q3: YES** — templates ship inside the npm tarball (`files: ["dist", "templates", ...]`).
- **P0-Q4: YES** — MIT.

## Executing now

Folder created at `E:\EB1A_Research\pw-emit\`. Code, tests, configs follow in this round.
