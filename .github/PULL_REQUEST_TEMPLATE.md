<!--
Thanks for sending a PR to bdd2pw. Please fill in the sections below so
reviewing stays quick. Delete sections that don't apply.
-->

## What this PR does

<!-- One or two sentences. Not a changelog line — explain the user-visible change. -->

## Why

<!-- The motivating problem. Link the issue it closes if there is one. -->

Closes #

## Change type

- [ ] Bug fix (`fix:`)
- [ ] New feature (`feat:`)
- [ ] Documentation (`docs:`)
- [ ] CI / tooling (`chore(ci):`, `chore(deps):`)
- [ ] Refactor without behaviour change (`refactor:`)
- [ ] Breaking change (`feat!:` or `fix!:` — explain in **Breaking changes** below)

## Testing

<!--
What did you run locally? Paste the command and the one-line result.
Example:
    npm test              # 455 passed, 0 failed
    npm run smoke         # 8/8 passed
    node scripts/smoke-v451-attestqa-bugs.mjs   # 8/8 passed
-->

```
```

## Emitted-output example (if the change affects what bdd2pw emits)

<!--
Paste the before/after for a representative `.feature` → `.spec.ts` snippet.
Scope the example — one scenario is usually enough. If the change is a new
rule, show the step text and the emitted body.
-->

**Before:**
```ts
```

**After:**
```ts
```

## Breaking changes

<!-- Only if applicable. State the breakage and the migration path. -->

## Checklist

- [ ] I ran `npm run build && npm test` locally and both passed.
- [ ] I ran `npm run lint` and there are no new errors.
- [ ] I added or updated tests for the change.
- [ ] I added a `CHANGELOG.md` entry under `[Unreleased]`.
- [ ] My commit messages follow [Conventional Commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`, `docs:`, `chore:`, …).
- [ ] If this changes a public API or emission shape, I updated the relevant doc in `docs/`.
- [ ] I read [`CONTRIBUTING.md`](../CONTRIBUTING.md).
