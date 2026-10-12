# Determinism evidence — raw data from `--repeat 3`

This file documents the raw `bench/results/results-determinism.md`
output used to populate Table 4 in the manuscript. If reviewers ask
for the raw determinism check, point them at the `bench/results/`
folder in the v4.0.1 source distribution; this file mirrors that
content with interpretation.

Generated: 2026-06-29T23:55:53.104Z
Command: `npx ts-node bench/runner.ts --repeat 3`
Mode: deterministic-only (no `--llm`)
LLM cache: not exercised
MCP: live page scan against the URLs in `bench/apps/NN-*/config.json`

## Per-application functional outcomes

| App | Run 1 TODOs | Run 2 TODOs | Run 3 TODOs | Functional verdict |
|---|---|---|---|---|
| 01-saucedemo | 4 | 4 | 4 | STABLE |
| 02-the-internet | 5 | 5 | 5 | STABLE |
| 03-juice-shop | 11 | 11 | 11 | STABLE |
| 04-opencart | 9 | 9 | 9 | STABLE |
| 05-magento | 8 | 8 | 8 | STABLE |
| 06-conduit | 13 | 13 | 13 | STABLE |
| 07-reqres-api | 10 | 10 | 10 | STABLE |
| 08-automation-practice | 9 | 8 | 9 | **DIVERGENT** |

7 of 8 apps stable. AutomationPractice's TODO count differs because the upstream demo site's DOM differs between scans — this is observable by inspecting `bench/.work/08-automation-practice-run{0,1,2}/pages/authentication.page.ts`; the field set the picker discovered differs between runs even though the input `.feature` file is byte-identical.

## Per-application byte outcomes (sha256 of emitted files)

Reported as "STABLE" if all three runs produced the same SHA-256, otherwise the three distinct hashes are listed.

### 01-saucedemo
- spec.ts: STABLE
- pom.ts: STABLE

### 02-the-internet
- spec.ts: STABLE
- pom.ts: STABLE

### 03-juice-shop
- spec.ts: STABLE
- pom.ts: **DIVERGENT** — three distinct hashes:
  - `609b421109b3e25d4a684a91ad6c6d30b04454c9f1918320bf270015b0126cfe`
  - `305177bd98dcb9f21b8466e7fe7d60951f27df6ee9431d7f54646008416040a8`
  - `b4512838c9c2043f5eb01500c953c6410bf42ac79bfd3363d6c4842f6d3e2618`

  Inspection: the emitted POM contains the same field set in all three runs (verified by `diff -u` of the constructor body); the field declarations are reordered between runs. This reflects nondeterministic ordering in the MCP server's accessibility-tree response. Functional behaviour is preserved (same TODO count, same compilation outcome, same locator binds in the spec).

### 04-opencart
- spec.ts: STABLE
- pom.ts: STABLE

### 05-magento
- spec.ts: STABLE
- pom.ts: STABLE

### 06-conduit
- spec.ts: STABLE
- pom.ts: STABLE

### 07-reqres-api
- spec.ts: STABLE
- pom.ts: STABLE

### 08-automation-practice
- spec.ts: **DIVERGENT** — two distinct hashes:
  - `29cbed0a613b749560958960cbc5a46ce31a001898d0411245291272dea8264a`
  - `083cc0ac3347198d8520905ecc88ab18556edb3621304a2b24cd02423c8e1294`
- pom.ts: **DIVERGENT** — three distinct hashes:
  - `575aaa6a316ffaf0e113a2561e9ff9b264cf9164553e7393206434b5c04cc263`
  - `6e295526766e48f0f49f72e8c7fa86ce836a3990cb12cfd06169ab35020bb98a`
  - `189e7dedbf4e77904ad803ad7977a0a351243644a850033d9d3e4b0da512b039`

  Inspection: the upstream `automationpractice.pl` site varies its DOM between requests (different field-id randomisation, occasional A/B test variants). This is a property of the live DOM, not of bdd2pw. Confirmed by capturing the MCP snapshots from runs 1 and 2 and `diff`ing them.

## Summary

| Determinism level | Count | Notes |
|---|---|---|
| Functional determinism (same TODO count, same tsc outcome) | 7 of 8 | AutomationPractice diverges due to live-site DOM drift |
| Byte determinism (sha256 match across runs) | 6 of 8 | Juice Shop diverges due to MCP element-order nondeterminism; AutomationPractice diverges due to upstream DOM drift |

## Remediation

Both divergent cases are addressable via `--snapshot-file <path>`:

1. Run `bdd2pw scaffold ... --snapshot-file snap.json` once per benchmark app to capture the live DOM into a frozen JSON snapshot.
2. Subsequent benchmark runs use the snapshot instead of re-scanning the live URL.
3. With snapshots pinned for all 8 apps, we expect 8 of 8 byte-deterministic across `--repeat 3`.

The camera-ready version of this paper will ship pinned snapshots for all 8 apps and report the determinism check under snapshot mode.

## Why we report the divergent cases honestly

A naive "100% byte-identical" claim would have been false. The reviewer's request for empirical determinism evidence (R2-4) led directly to the discovery of these two real divergence cases. Reporting them transparently is more defensible than a claim the data does not support, and it motivates the snapshot-pinning recommendation in §3.5 of the manuscript with concrete evidence rather than as a hypothetical safeguard.
