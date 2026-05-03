# Example: login-feature

Reference fixture used by:
- `tests/snapshot/` (Phase 2 onwards) — golden-file emitter tests
- `tests/e2e/` (Phase 4) — end-to-end against a live MCP browser
- The smoke test in CI (Phase 5)
- The acceptance criteria in [`docs/SCOPE.md`](../../docs/SCOPE.md) §15.

## Structure

```
login-feature/
├── login.feature          ← Gherkin source — 3 scenarios + 1 outline
└── README.md              ← this file
```

## Expected v1.0 invocation

```bash
bdd2pw scaffold ./examples/login-feature/login.feature \
  --url https://your-test-app.example.com/login \
  --page LoginPage \
  --repo /tmp/login-feature-out
```

Once Phase 1 lands this should produce, in `/tmp/login-feature-out`:

```
pages/login.page.ts
tests/user-login.spec.ts
playwright.config.ts        ← scaffolded if missing
package.json                ← scaffolded if missing
tsconfig.json               ← scaffolded if missing
BDD_REVIEW.md               ← warnings + manual TODOs
```
