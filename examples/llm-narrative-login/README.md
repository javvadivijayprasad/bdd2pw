# Fixture: llm-narrative-login

Real-world Gherkin from a `test-case-generation-service` LLM run
(`j-20f3defc3044f7ec`, exported 2026-05-05).

## Why this fixture exists

The original `practice-test-login` fixture used hand-authored, conventional
Gherkin (`Given I am on the login page`, `When I enter "student" in the
username field`). LLM-generated Gherkin is more verbose and narrative —
patterns like:

- `When Navigate to <URL>` (no `I`/`User` subject)
- `When Locate the username input field and enter 'student'` (compound
  locate-and-fill instead of split steps)
- `When Click the 'Submit' button` (quoted name + role)
- `When Leave the password input field empty (do not type anything)`
- `When Observe the resulting page and URL` (annotation noise)
- `Then User is redirected to ... (URL contains 'X')` (parenthetical hint)
- `Then URL does not change to the success page` (negative URL assertion)
- `Then Page displays a ... message such as 'V'` (such-as text-contains)
- `Then An error message is displayed (e.g., 'V')` (parenthetical text-contains)
- `Then A 'Log out' button is visible on the page` (visibility, no subject)
- `Then No error messages are displayed` / `No 'Log out' button appears`
  (negative visibility)

This fixture exercises **all** of those dialects in four scenarios. The
e2e regression test at `tests/e2e/llmNarrativeLogin.test.ts` asserts that
`scaffold()` produces 0 warnings against this file with the
`snapshot.json` discovery shortcut — meaning every step matches a rule
and emits real test code, not `// TODO`.

## Locked target

Same live site as `practice-test-login` —
<https://practicetestautomation.com/practice-test-login/> — so the
snapshot is identical (8 elements). The interesting variation is purely
in the Gherkin dialect.

## Why locked as a regression

The LLM dialect is the *common* shape on real cloud-jobs-template runs.
If we ever silently break a pattern in this fixture, real production jobs
break. The e2e test fails fast before publish.

## How to update

If the LLM service evolves and produces new dialects, add the new step
text to `login.feature`, run the e2e test, fix any failures by adding
new rules to `src/transformers/stepMatcher.ts` (and tests in
`tests/unit/stepMatcher.test.ts`). Never lower the regression bar — the
e2e must stay at "0 warnings" against this file.
