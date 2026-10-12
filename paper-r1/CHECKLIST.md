# R1 revision — comment-to-deliverable map

Manuscript: SOFTX-D-26-00598
Deadline: Jul 29, 2026

For each reviewer comment, this checklist shows which file in this
folder contains the response and which sections of the manuscript
must be updated.

## Reviewer #1

| # | Comment summary | Addressed in | Manuscript change |
|---|---|---|---|
| R1-1 | Single-scenario evaluation | `REBUTTAL_LETTER.md` §R1-1, `MANUSCRIPT_REVISIONS.md` §3.2, `BENCHMARK_TABLES.md` Table 2 | Replace §3 controlled comparison with 8-app benchmark |
| R1-2 | Novelty vs codegen, BDD frameworks | `REBUTTAL_LETTER.md` §R1-2, `MANUSCRIPT_REVISIONS.md` §Related-Work | Add Related Work subsection with comparison table |
| R1-3 | Reproducibility unclear (live DOM, MCP, LLM uncontrolled) | `REBUTTAL_LETTER.md` §R1-3, `MANUSCRIPT_REVISIONS.md` §3.5 | New §3.5 Determinism + reproducibility |
| R1-4 | LLM fallback under-specified, no failure cases | `REBUTTAL_LETTER.md` §R1-4, `MANUSCRIPT_REVISIONS.md` §3.3 + §3.4 | New §3.3 fail-closed validation + §3.4 hallucination rejection |
| R1-5 | Adoption claims weak | `REBUTTAL_LETTER.md` §R1-5 | Remove adoption claims from §1, §4 OR add real npm metrics |
| R1-6 | Missing engineering details | `REBUTTAL_LETTER.md` §R1-6, `MANUSCRIPT_REVISIONS.md` §2-eng-expand | Expand §2 with locator chain, MCP error matrix, multi-page, auth |
| R1-7 | Human comparison weak (1 engineer, 1 app) | `REBUTTAL_LETTER.md` §R1-7 | Drop "person-weeks" claim. Replace §3 with objective benchmark |
| R1-8 | MCP security discussion missing | `REBUTTAL_LETTER.md` §R1-8, `MANUSCRIPT_REVISIONS.md` §2-security | Add §2.x MCP security subsection citing MCPXKIT |

## Reviewer #2

| # | Comment summary | Addressed in | Manuscript change |
|---|---|---|---|
| R2-1 | Novelty claim false (MCP itself does TS gen, codegen exists) | `REBUTTAL_LETTER.md` §R2-1, `MANUSCRIPT_REVISIONS.md` §1-novelty | Narrow §1 novelty claim; drop "first / earliest" wording |
| R2-2 | Three inconsistent effort magnitudes (days/weeks/hours) | `REBUTTAL_LETTER.md` §R2-2, `MANUSCRIPT_REVISIONS.md` §1-effort | Rewrite abstract + §1 with single magnitude grounded in bench |
| R2-3 | Significance leans on author's own unpublished work | `REBUTTAL_LETTER.md` §R2-3, `MANUSCRIPT_REVISIONS.md` §1, §4 | Remove [11, 12] from significance argument |
| R2-4 | Determinism asserted not shown | `REBUTTAL_LETTER.md` §R2-4, `MANUSCRIPT_REVISIONS.md` §3.5 + §3.3 | §3.5 with `--repeat 3` evidence + §3.3 fail-closed |
| R2-5 | Validation harness mentioned no results | `REBUTTAL_LETTER.md` §R2-5, `BENCHMARK_TABLES.md` | Table 2 IS the harness results |
| R2-6 | Citations [9, 10] don't measure proposed workflow | `REBUTTAL_LETTER.md` §R2-6 | Remove [9, 10] from §3 effort claim |
| Minor | "Declaration of intrest" typo | `REBUTTAL_LETTER.md` §minor | Fix to "interest" |

## Deliverable files in this folder

| File | Purpose |
|---|---|
| `CHECKLIST.md` | This file. |
| `REBUTTAL_LETTER.md` | Point-by-point response submitted to Editorial Manager. |
| `MANUSCRIPT_REVISIONS.md` | All new/rewritten section text, organized by section number. Paste into Word at the appropriate places. |
| `BENCHMARK_TABLES.md` | Table 2 (3-mode comparison) and supporting per-app data, ready to paste. |
| `DETERMINISM_EVIDENCE.md` | Raw `--repeat 3` output + interpretation, used as supporting data in §3.5. |

## Order of work for assembly

1. Read `REBUTTAL_LETTER.md` end-to-end. This is what Editorial Manager wants.
2. Open Word doc of the manuscript.
3. For each entry in the comment table above, navigate to the listed manuscript section and paste in the corresponding block from `MANUSCRIPT_REVISIONS.md`.
4. Add Table 2 from `BENCHMARK_TABLES.md` to §3.
5. Fix the "intrest" typo on the declarations page.
6. Read the full revised manuscript end-to-end. Self-edit pass.
7. Submit via Editorial Manager — upload revised .docx + `REBUTTAL_LETTER.md` as cover letter.

## What is NOT in this folder

Two things this folder does not produce — you'll need to do them separately:

- **Updated Zenodo deposit for v4.0.1** — log into Zenodo, click "New version" on the existing bdd2pw record, upload the v4.0.1 release tarball, get the new DOI, update the manuscript's archived-version DOI badge.
- **MCPXKIT IEEE TDSC 2026 citation** — find the actual paper (search IEEE Xplore or contact authors), get a proper BibTeX entry, add to references list. I drafted a placeholder citation in `MANUSCRIPT_REVISIONS.md` §security; replace with the real one before submit.
