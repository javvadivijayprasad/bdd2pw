# bdd2pw — Conversion Review

> **Source feature:** `E:\EB1A_Research\Application\bdd2pw\bench\.work\08-automation-practice-run0\feature.feature`
> **Target URL:** http://automationpractice.pl/index.php?controller=authentication
> **Generated:** 2026-06-29T23:36:37.184Z

## Summary

0 errors · 6 warnings · 5 info

## Warnings

- [Create an account] no rule matched: "When I enter "bench@example.com" as my account email" (LLM fallback also failed: Could not parse binding for step 0 ("I enter "bench@example.com" as my account email"); slot was: {"step":{"keyword":"When","text":"I enter \"bench@example.com\" as my account email"},"pomCall":{"page":"authenticationPage","method":"fill","args":["page.getByLabel('Email').first()","\"bench@example)
  - Suggestion: Add a custom step rule, enable --llm fallback, or hand-edit the spec.
- [Create an account] no rule matched: "And I click the Create an account button" (LLM fallback also failed: Could not parse binding for step 1 ("I click the Create an account button"); slot was: {"step":{"keyword":"And","text":"I click the Create an account button"},"pomCall":{"page":"authenticationPage","method":"click","args":["page.getByRole('button', { name: 'Create an account' }).first())
  - Suggestion: Add a custom step rule, enable --llm fallback, or hand-edit the spec.
- [Sign in with existing account] no rule matched: "When I enter "bench@example.com" as my email" (LLM fallback also failed: Could not parse binding for step 0 ("I enter "bench@example.com" as my email"); slot was: {"step":{"keyword":"When","text":"I enter \"bench@example.com\" as my email"},"pomCall":{"page":"page","method":"getByLabel('Email address').fill","args":["\"bench@example.com\""]}})
  - Suggestion: Add a custom step rule, enable --llm fallback, or hand-edit the spec.
- [Sign in with existing account] no rule matched: "And I enter "BenchPass1!" as my password" (LLM fallback also failed: Could not parse binding for step 1 ("I enter "BenchPass1!" as my password"); slot was: {"step":{"keyword":"And","text":"I enter \"BenchPass1!\" as my password"},"pomCall":{"page":"page","method":"getByLabel('Password').fill","args":["\"BenchPass1!\""]}})
  - Suggestion: Add a custom step rule, enable --llm fallback, or hand-edit the spec.
- [Sign in with existing account] no rule matched: "And I click the Sign in button" (LLM fallback also failed: Could not parse binding for step 2 ("I click the Sign in button"); slot was: {"step":{"keyword":"And","text":"I click the Sign in button"},"pomCall":{"page":"page","method":"getByRole('button', { name: 'Sign in' }).click","args":[]}})
  - Suggestion: Add a custom step rule, enable --llm fallback, or hand-edit the spec.
- [Search and add to cart] No search input or submit POM field found; synthesised a searchbox role fill + search button click. Verify selectors match the actual page.
  - Suggestion: Add a custom step rule, enable --llm fallback, or hand-edit the spec.

## Info

- Domain rule packs active: retail.
- Parsed feature "PrestaShop AutomationPractice journey" — 3 scenario(s)
- Discovered 0 element(s); picked 0 unique locator(s)
- POM decision for AuthenticationPage: CREATE
- LLM fallback: 3 successful / 3 attempted, max 50. Cache hits counted as 0.
