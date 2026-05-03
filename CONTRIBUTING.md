# Contributing to bdd2pw

Thanks for the interest. `bdd2pw` is a sibling tool to [`sel2pw`](https://github.com/javvadivijayprasad/sel2pw) in the same automation platform; the contribution workflow mirrors that repo.

## Setup

```bash
git clone https://github.com/javvadivijayprasad/bdd2pw.git
cd bdd2pw
npm install
npm run build
npm test
```

Node ≥ 18. Tested on Linux, macOS, Windows.

## Local development

```bash
# CLI in dev (no build step)
npm run dev -- scaffold ./examples/login-feature/login.feature \
  --url https://example.com/login --page LoginPage --repo /tmp/out

# HTTP service in dev
npm run dev:serve

# Watch tests
npm run test:watch
```

## Branch & PR

- Branch off `main`. Conventional names: `feat/<short>`, `fix/<short>`, `chore/<short>`, `docs/<short>`.
- Run `npm run lint && npm test` before pushing.
- Add a changeset for any user-visible change: `npx changeset` then commit the generated file.
- PR title follows [Conventional Commits](https://www.conventionalcommits.org/) — used by the release workflow.

## Code style

- Prettier-formatted. Run `npm run format` before commit.
- ESLint must pass. Warnings are tolerated; errors block CI.
- Public APIs documented with TSDoc (rendered by TypeDoc into `docs/api/`).

## Adding a new step-matcher rule

1. Open `src/transformers/stepMatcher.ts`.
2. Register a rule in the rule table — Gherkin step regex → POM method emitter.
3. Add a snapshot test in `tests/snapshot/stepMatcher.test.ts`.
4. Update `docs/STEP_RULES.md`.

## Adding a new locator strategy

1. Open `src/transformers/locatorPicker.ts` (or the corresponding helper in `@vijaypjavvadi/pw-emit` if shared).
2. Place it in the priority chain. Document why.
3. Add unit tests covering ambiguity, missing fields, and dedup behaviour.

## Reporting issues

- Bug reports: include the `.feature`, the URL (or a redacted snapshot), and the resulting `BDD_REVIEW.md`.
- Feature requests: link to a real-world `.feature` file that motivates the gap.

## License

MIT. By contributing you agree that your contributions are licensed under the MIT License.
