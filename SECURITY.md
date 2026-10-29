# Security Policy

## Supported versions

bdd2pw ships patch releases on the latest minor only. Security fixes
land on `main` and are published to npm as the next patch release
within the current minor.

| Version | Supported          |
| ------- | ------------------ |
| 4.6.x   | ✅ security fixes  |
| ≤ 4.5.x | ❌ upgrade to 4.6.x |

## Reporting a vulnerability

**Please do not open a public GitHub issue for security reports.**

Report privately via GitHub's [private security advisory
flow](https://github.com/javvadivijayprasad/bdd2pw/security/advisories/new),
or by emailing the maintainer at **jvijayprasad@gmail.com** with the
subject line prefixed `[bdd2pw security]`.

Please include:

- a description of the issue and the affected code path,
- a minimal reproduction (ideally a `.feature` + command invocation),
- the bdd2pw version (`npx bdd2pw --version`),
- the Node and OS versions,
- whether the issue is public or coordinated-disclosure.

### What to expect

- **Acknowledgement** within 72 hours of receipt.
- **Triage decision** (confirmed / needs-more-info / not-in-scope) within 7 days.
- **Fix target** communicated with the triage decision: for confirmed
  high-severity issues, a patch release within 14 days is the goal.
- **Credit** in the release notes and (if desired) the published
  GitHub security advisory. Anonymous reports accepted.

### Scope

In scope:
- Code execution via a crafted `.feature`, snapshot JSON, or HTTP request
  body to the bdd2pw service.
- Path traversal in file emission (writing outside the `--repo` directory).
- Secret exfiltration via LLM provider calls, telemetry sidecars, or
  governance logs.
- Prototype pollution, SSRF via the discovery browser, or injection into
  emitted spec files.

Out of scope:
- Vulnerabilities in bdd2pw's dependencies — report upstream (Dependabot
  catches these automatically here).
- Issues that require a malicious maintainer or physical access to the
  developer's machine.
- Denial of service via extremely large `.feature` files; bdd2pw does not
  promise unbounded-input safety.

## Known operational security notes

- The LLM fallback (`--llm`) sends step text, POM field names, and the
  URL to the chosen provider (Anthropic / OpenAI / Gemini). Pass
  `--governance-url` to route through a redaction sidecar — see
  `docs/LLM_GOVERNANCE.md`.
- The HTTP service (`npx bdd2pw serve`) is intended for localhost or a
  trusted network. It has no built-in authentication; put it behind a
  reverse proxy with auth if exposing beyond localhost.
- Generated specs include the scanned URL in `BDD_REVIEW.md` and in the
  DOM-hash header; redact before committing if the URL is sensitive.
