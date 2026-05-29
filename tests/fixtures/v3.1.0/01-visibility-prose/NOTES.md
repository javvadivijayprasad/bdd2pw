# Issue 1 — visibility prose, P0

**Acceptance:** the step "the user's name or profile indicator is visible in the UI"
MUST NOT emit `toHaveURL(/.../)`. It MUST emit either:

1. `expect(<pomVar>.<field>).toBeVisible()` when a POM field with a name
   matching "userProfileIndicator" / "profileName" / "userAvatar" / etc.
   is available, OR
2. A `// TODO bdd2pw:` warning saying the visibility step could not be
   resolved — explicitly NOT a synthesized URL regex.

Verified by `tests/unit/v310Fixtures.test.ts` (`01-visibility-prose` case):
no rendered output contains `toHaveURL`, no rendered output contains `:root`.
