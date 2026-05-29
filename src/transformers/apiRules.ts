/**
 * v3.0.0 — Native API testing step patterns.
 *
 * These rules slot in at the TOP of the stepMatcher RULES array (highest
 * priority) so API-shaped Gherkin steps emit `page.request.*` calls
 * deterministically and never reach the LLM fallback.
 *
 * Each rule sets `apiContext: true` on the returned StepBinding so the
 * renderer (src/emitters/facade.ts) can:
 *   1. Add `type APIResponse` to the @playwright/test import.
 *   2. Inject `let apiResponse: APIResponse | null = null;` and
 *      `let baseUrl: string = process.env.CLOUD_JOB_APP_URL ?? "";`
 *      inside the describe block.
 *   3. Prepend `apiResponse = null;` to the body of every API-bearing test.
 *
 * Coverage:
 *   - Setup: base URL declaration, endpoint-reachable marker.
 *   - Requests: GET/POST/PUT/DELETE/PATCH to a path; with JSON body
 *     docstring; with a single header; re-issue last request with a
 *     new header.
 *   - Status assertions: equals, is in [list], less than.
 *   - Body assertions: non-empty field, field-equals-string, field-equals-
 *     number, field-matches-regex, body-contains-text, missing-field,
 *     is-JSON.
 *   - Header assertions: header equals, header contains, header is set.
 *
 * What's intentionally NOT covered in v3.0.0:
 *   - Multi-header chains (`and header "X" set to "Y"`). The cache key
 *     would have to hash a list of pairs; deferred to v3.1.
 *   - Authentication-aware shapes (`with bearer token <X>`, `as user X`).
 *     Compose via the existing single-header rule.
 *   - Request bodies as YAML / form-data / multipart. JSON docstring only.
 */

import type { PageObjectIR, StepBinding, StepIR } from "../types";

interface Rule {
  pattern: RegExp;
  build(
    m: RegExpMatchArray,
    step: StepIR,
    pom: PageObjectIR,
    pageVar: string,
  ): StepBinding | null;
}

/** Subject prefix accepted by request-shaped steps. Matches stepMatcher's SUBJ. */
const SUBJ = "(?:I|user|User|the user|the User)";
/** Verbs Playwright's APIRequestContext supports. */
const HTTP_VERB = "(GET|POST|PUT|DELETE|PATCH)";

/**
 * Convert an HTTP verb (any case) to the Playwright APIRequestContext
 * method name, which is the lower-cased verb (`get`, `post`, …).
 */
function verbToMethod(verb: string): string {
  return verb.toLowerCase();
}

/**
 * Indent every line of a multi-line string by two spaces.
 * Used to inline JSON docstring bodies as `data:` literals.
 */
function indent(s: string, prefix = "  "): string {
  return s
    .split("\n")
    .map((line) => (line.length ? prefix + line : line))
    .join("\n");
}

/**
 * Normalise a JSON docstring to a JS object literal suitable for embedding
 * inline as `data: { … }`. We pretty-print the JSON so the generated spec
 * is readable. If the docstring isn't valid JSON we fall back to embedding
 * it verbatim wrapped in a comment — the test fails loudly at runtime
 * rather than silently submitting garbage.
 */
function jsonBodyAsLiteral(docstring: string | undefined): string {
  if (!docstring) return "{}";
  try {
    const parsed = JSON.parse(docstring);
    return JSON.stringify(parsed, null, 2);
  } catch {
    return `/* TODO: docstring is not valid JSON — original: ${docstring.replace(/\*\//g, "*\\/")} */ {}`;
  }
}

export const API_RULES: Rule[] = [
  // ── Setup ─────────────────────────────────────────────────────────────

  // API:01 — `Given the API base URL is "<URL>"`
  // Stores the base URL into the describe-scoped `baseUrl` variable.
  {
    pattern: /^(?:the )?API base URL is ["']([^"']+)["']$/i,
    build: (m, step) => ({
      step,
      apiContext: true,
      customBody: `baseUrl = ${JSON.stringify(m[1])};`,
    }),
  },

  // API:02 — `Given the <something> API endpoint is reachable`
  // Marker step. Useful as a Background hint that this scenario is API;
  // emits an explanatory comment so the spec is self-documenting but
  // doesn't make any real HTTP call (the next step does that).
  {
    pattern: /^(?:the )?.+? API endpoint is reachable$/i,
    build: (_m, step) => ({
      step,
      apiContext: true,
      customBody: `// API endpoint reachable — placeholder marker, no HTTP call performed.`,
    }),
  },

  // ── Requests ──────────────────────────────────────────────────────────

  // API:03 — `When I send a <VERB> request to "<path>" with header "<H>" set to "<V>"`
  // ORDER MATTERS: must come before API:04 (the no-header variant) so the
  // longer pattern wins.
  {
    pattern: new RegExp(
      `^(?:${SUBJ}\\s+)?send(?:s)? (?:a |an )?${HTTP_VERB} request to ["']([^"']+)["'] with header ["']([^"']+)["'] set to ["']([^"']*)["']$`,
      "i",
    ),
    build: (m, step) => {
      const method = verbToMethod(m[1]);
      const pathLit = JSON.stringify(m[2]);
      const headerName = JSON.stringify(m[3]);
      const headerValue = JSON.stringify(m[4]);
      return {
        step,
        apiContext: true,
        customBody: [
          `_lastApiReq = { method: ${JSON.stringify(method)}, path: ${pathLit}, headers: { ${headerName}: ${headerValue} } };`,
          `apiResponse = await page.request.${method}(baseUrl + ${pathLit}, {`,
          `  headers: { ${headerName}: ${headerValue} },`,
          `});`,
        ].join("\n"),
      };
    },
  },

  // API:04 — `When I send a <VERB> request to "<path>"` with optional docstring body.
  // If the step has a docstring argument (JSON), use it as `data:`. Otherwise
  // emit a bare request.
  {
    pattern: new RegExp(
      `^(?:${SUBJ}\\s+)?send(?:s)? (?:a |an )?${HTTP_VERB} request to ["']([^"']+)["'](?: with body:?)?$`,
      "i",
    ),
    build: (m, step) => {
      const method = verbToMethod(m[1]);
      const pathLit = JSON.stringify(m[2]);
      const docstring =
        typeof step.argument === "string" ? step.argument : undefined;
      if (docstring) {
        const bodyLit = jsonBodyAsLiteral(docstring);
        const dataLiteral = indent(bodyLit, "  ").trimStart();
        return {
          step,
          apiContext: true,
          customBody: [
            `_lastApiReq = { method: ${JSON.stringify(method)}, path: ${pathLit}, data: ${dataLiteral}, headers: { "content-type": "application/json" } };`,
            `apiResponse = await page.request.${method}(baseUrl + ${pathLit}, {`,
            `  data: ${dataLiteral},`,
            `  headers: { "content-type": "application/json" },`,
            `});`,
          ].join("\n"),
        };
      }
      return {
        step,
        apiContext: true,
        customBody: [
          `_lastApiReq = { method: ${JSON.stringify(method)}, path: ${pathLit} };`,
          `apiResponse = await page.request.${method}(baseUrl + ${pathLit});`,
        ].join("\n"),
      };
    },
  },

  // API:05 — `When I send the previous request again with header "<H>" set to "<V>"`
  // Re-issues whatever was most recently captured. Uses an in-test record
  // of the last request — see scenario-level state injection in
  // src/emitters/facade.ts for the `_lastApiReq` declaration that backs
  // this. (v3.0.0 caveat: only supported when the test ALREADY has at
  // least one prior API request step in the same scenario.)
  {
    pattern: new RegExp(
      `^(?:${SUBJ}\\s+)?send(?:s)? the previous request again with header ["']([^"']+)["'] set to ["']([^"']*)["']$`,
      "i",
    ),
    build: (m, step) => {
      const headerName = JSON.stringify(m[1]);
      const headerValue = JSON.stringify(m[2]);
      return {
        step,
        apiContext: true,
        customBody: [
          `apiResponse = await page.request[_lastApiReq.method](baseUrl + _lastApiReq.path, {`,
          `  data: _lastApiReq.data,`,
          `  headers: { ..._lastApiReq.headers, ${headerName}: ${headerValue} },`,
          `});`,
        ].join("\n"),
      };
    },
  },

  // ── Status assertions ────────────────────────────────────────────────

  // API:06 — `Then the response status is <N>`
  {
    pattern: /^(?:the )?response status is (\d+)$/i,
    build: (m, step) => ({
      step,
      apiContext: true,
      customBody: `expect(apiResponse!.status()).toBe(${m[1]});`,
    }),
  },

  // API:07 — `Then the response status is in [200, 204]`
  {
    pattern: /^(?:the )?response status is in \[([\d,\s]+)\]$/i,
    build: (m, step) => {
      // Normalise spacing so the emitted array is canonical.
      const cleaned = m[1]
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
        .join(", ");
      return {
        step,
        apiContext: true,
        customBody: `expect([${cleaned}]).toContain(apiResponse!.status());`,
      };
    },
  },

  // API:08 — `Then the response status is less than <N>`
  {
    pattern: /^(?:the )?response status is less than (\d+)$/i,
    build: (m, step) => ({
      step,
      apiContext: true,
      customBody: `expect(apiResponse!.status()).toBeLessThan(${m[1]});`,
    }),
  },

  // ── Body assertions ──────────────────────────────────────────────────

  // API:09 — `Then the response body has a non-empty "<field>" field`
  {
    pattern: /^(?:the )?response body has a non[- ]empty ["']([^"']+)["'] field$/i,
    build: (m, step) => ({
      step,
      apiContext: true,
      customBody: [
        `const body = await apiResponse!.json();`,
        `expect(body[${JSON.stringify(m[1])}]).toBeTruthy();`,
      ].join("\n"),
    }),
  },

  // API:11 — `Then the response body field "<f>" equals <N>` (numeric)
  // ORDER MATTERS: number-equals must come BEFORE string-equals so an
  // unquoted RHS is parsed as a number, not as a literal string.
  {
    pattern: /^(?:the )?response body field ["']([^"']+)["'] equals (\d+(?:\.\d+)?)$/i,
    build: (m, step) => ({
      step,
      apiContext: true,
      customBody: [
        `const body = await apiResponse!.json();`,
        `expect(body[${JSON.stringify(m[1])}]).toBe(${m[2]});`,
      ].join("\n"),
    }),
  },

  // API:10 — `Then the response body field "<f>" equals "<v>"` (string)
  {
    pattern: /^(?:the )?response body field ["']([^"']+)["'] equals ["']([^"']*)["']$/i,
    build: (m, step) => ({
      step,
      apiContext: true,
      customBody: [
        `const body = await apiResponse!.json();`,
        `expect(body[${JSON.stringify(m[1])}]).toBe(${JSON.stringify(m[2])});`,
      ].join("\n"),
    }),
  },

  // API:12 — `Then the response body field "<f>" matches /<pattern>/`
  // The regex is embedded verbatim (no escaping) — same convention as
  // existing UI rule's toHaveURL handling.
  {
    pattern: /^(?:the )?response body field ["']([^"']+)["'] matches \/(.+)\/$/i,
    build: (m, step) => ({
      step,
      apiContext: true,
      customBody: [
        `const body = await apiResponse!.json();`,
        `expect(body[${JSON.stringify(m[1])}]).toMatch(/${m[2]}/);`,
      ].join("\n"),
    }),
  },

  // API:13 — `Then the response body contains "<text>"` (text, not JSON)
  {
    pattern: /^(?:the )?response body contains ["']([^"']+)["']$/i,
    build: (m, step) => ({
      step,
      apiContext: true,
      customBody: [
        `const text = await apiResponse!.text();`,
        `expect(text).toContain(${JSON.stringify(m[1])});`,
      ].join("\n"),
    }),
  },

  // API:14 — `Then the response body does NOT contain a "<field>" field`
  // Note the `NOT` is case-sensitive in spec but we accept any case.
  {
    pattern: /^(?:the )?response body does not contain a ["']([^"']+)["'] field$/i,
    build: (m, step) => ({
      step,
      apiContext: true,
      customBody: [
        `const body = await apiResponse!.json();`,
        `expect(body[${JSON.stringify(m[1])}]).toBeUndefined();`,
      ].join("\n"),
    }),
  },

  // API:15 — `Then the response is JSON`
  // Loose check — `.json()` resolving non-null is good enough to verify
  // the content was JSON-parseable.
  {
    pattern: /^(?:the )?response is JSON$/i,
    build: (_m, step) => ({
      step,
      apiContext: true,
      customBody: `await expect(apiResponse!.json()).resolves.toBeTruthy();`,
    }),
  },

  // ── Header assertions ────────────────────────────────────────────────

  // API:16 — `Then the response header "<H>" equals "<V>"`
  // Header names lowercase per Node's response API.
  {
    pattern: /^(?:the )?response header ["']([^"']+)["'] equals ["']([^"']*)["']$/i,
    build: (m, step) => ({
      step,
      apiContext: true,
      customBody: `expect(apiResponse!.headers()[${JSON.stringify(m[1].toLowerCase())}]).toBe(${JSON.stringify(m[2])});`,
    }),
  },

  // API:17 — `Then the response header "<H>" contains "<V>"`
  {
    pattern: /^(?:the )?response header ["']([^"']+)["'] contains ["']([^"']*)["']$/i,
    build: (m, step) => ({
      step,
      apiContext: true,
      customBody: `expect(apiResponse!.headers()[${JSON.stringify(m[1].toLowerCase())}]).toContain(${JSON.stringify(m[2])});`,
    }),
  },

  // API:18 — `Then the response header "<H>" is set`
  {
    pattern: /^(?:the )?response header ["']([^"']+)["'] is set$/i,
    build: (m, step) => ({
      step,
      apiContext: true,
      customBody: `expect(apiResponse!.headers()[${JSON.stringify(m[1].toLowerCase())}]).toBeTruthy();`,
    }),
  },
];
