/**
 * v4.1.0 smoke test — validates the invented-helper rewriter without
 * pulling in vitest (which requires rollup native binaries not present
 * in every dev environment).
 *
 * Run: `node scripts/smoke-v410-rewriter.mjs` after `npm run build`.
 * Full test coverage lives in tests/unit/v410BindingRewriter.test.ts.
 */

import {
  tryRewriteInventedHelper,
  tryPromotePomCallCssSelectorToCustomBody,
  rewriteCustomBodyPageMethods,
  parseBindingJson,
} from "../dist/llm/anthropicClient.js";

const POM = {
  className: "LoginPage",
  filePath: "pages/login.page.ts",
  fields: [
    { api: "getByLabel", args: '"Username"', fieldName: "usernameInput", source: { tag: "input" }, confidence: "unique" },
    { api: "getByLabel", args: '"Password"', fieldName: "passwordInput", source: { tag: "input" }, confidence: "unique" },
    { api: "getByRole", args: '"button"', fieldName: "signInButton", source: { tag: "button" }, confidence: "unique" },
  ],
  methods: [{ name: "goto", params: [], body: "", origin: "generated" }],
  exists: false,
};
const STEP = {
  step: { keyword: "When", text: "I enter my username" },
  pom: POM,
  pageVar: "loginPage",
  scaffoldId: "smoke",
};

const KNOWN_FIELDS = new Set(["page", "usernameInput", "passwordInput", "signInButton"]);
const KNOWN_METHODS = new Set(["goto"]);

let passed = 0;
let failed = 0;
function check(name, condition, actual) {
  if (condition) {
    console.log(`  PASS  ${name}`);
    passed++;
  } else {
    console.log(`  FAIL  ${name}`);
    console.log(`        got: ${JSON.stringify(actual)}`);
    failed++;
  }
}

console.log("v4.1.0 — invented-helper rewriter smoke test");
console.log("");

// Unit: rewrites fill(pomVar.field, value)
{
  const p = { page: "loginPage", method: "fill", args: ["loginPage.usernameInput", '"standard_user"'] };
  const r = tryRewriteInventedHelper(p, "loginPage", KNOWN_FIELDS, KNOWN_METHODS);
  check("rewrites fill(pomVar.field, value)", r === true && p.method === "usernameInput.fill" && p.args[0] === '"standard_user"', p);
}

// Unit: rewrites click(pomVar.field)
{
  const p = { page: "loginPage", method: "click", args: ["loginPage.signInButton"] };
  const r = tryRewriteInventedHelper(p, "loginPage", KNOWN_FIELDS, KNOWN_METHODS);
  check("rewrites click(pomVar.field)", r === true && p.method === "signInButton.click" && p.args.length === 0, p);
}

// Unit: does NOT rewrite method outside allowlist
{
  const p = { page: "loginPage", method: "foo", args: ["loginPage.usernameInput", '"x"'] };
  const r = tryRewriteInventedHelper(p, "loginPage", KNOWN_FIELDS, KNOWN_METHODS);
  check("does NOT rewrite method outside allowlist", r === false && p.method === "foo", p);
}

// Unit: does NOT rewrite known POM method (goto)
{
  const p = { page: "loginPage", method: "goto", args: ["loginPage.usernameInput"] };
  const r = tryRewriteInventedHelper(p, "loginPage", KNOWN_FIELDS, KNOWN_METHODS);
  check("does NOT rewrite known POM method", r === false && p.method === "goto", p);
}

// Unit: does NOT rewrite when field isn't declared
{
  const p = { page: "loginPage", method: "fill", args: ["loginPage.emailInput", '"x"'] };
  const r = tryRewriteInventedHelper(p, "loginPage", KNOWN_FIELDS, KNOWN_METHODS);
  check("does NOT rewrite unknown field", r === false && p.method === "fill", p);
}

// Unit: does NOT rewrite when first arg is `pomVar.page`
{
  const p = { page: "loginPage", method: "fill", args: ["loginPage.page", '"x"'] };
  const r = tryRewriteInventedHelper(p, "loginPage", KNOWN_FIELDS, KNOWN_METHODS);
  check("does NOT rewrite pomVar.page", r === false, p);
}

// Integration: OpenAI shape now closes cleanly
{
  const emission = JSON.stringify({ pomCall: { page: "loginPage", method: "fill", args: ["loginPage.usernameInput", '"standard_user"'] } });
  const b = parseBindingJson(emission, STEP);
  check("integration: OpenAI invented-helper closes cleanly", b !== undefined && b.pomCall?.method === "usernameInput.fill" && b.pomCall?.args[0] === '"standard_user"', b);
}

// Integration: un-rewritable still rejected (fail-closed)
{
  const emission = JSON.stringify({ pomCall: { page: "loginPage", method: "fill", args: ['page.getByLabel("Email")', '"x"'] } });
  const b = parseBindingJson(emission, STEP);
  check("integration: un-rewritable still rejected (fail-closed)", b === undefined, b);
}

// Integration: valid chained form is unaffected
{
  const emission = JSON.stringify({ pomCall: { page: "loginPage", method: "usernameInput.fill", args: ['"standard_user"'] } });
  const b = parseBindingJson(emission, STEP);
  check("integration: valid chained form unaffected", b !== undefined && b.pomCall?.method === "usernameInput.fill", b);
}

// PATTERN B — bare field arg + unquoted value (AutomationPractice bench failure)
{
  const p = { page: "loginPage", method: "fill", args: ["usernameInput", "bench@example.com"] };
  const r = tryRewriteInventedHelper(p, "loginPage", KNOWN_FIELDS, KNOWN_METHODS);
  check("Pattern B: rewrites {method:'fill', args:['field', 'user@host']} + auto-quotes email", r === true && p.method === "usernameInput.fill" && p.args[0] === '"bench@example.com"', p);
}

// PATTERN B: quoted value stays as-is (idempotent)
{
  const p = { page: "loginPage", method: "fill", args: ["usernameInput", '"already_quoted"'] };
  const r = tryRewriteInventedHelper(p, "loginPage", KNOWN_FIELDS, KNOWN_METHODS);
  check("Pattern B: pre-quoted value not double-quoted", r === true && p.method === "usernameInput.fill" && p.args[0] === '"already_quoted"', p);
}

// PATTERN B: click with just a bare field arg (no value)
{
  const p = { page: "loginPage", method: "click", args: ["signInButton"] };
  const r = tryRewriteInventedHelper(p, "loginPage", KNOWN_FIELDS, KNOWN_METHODS);
  check("Pattern B: click({args:['field']}) rewrites to field.click()", r === true && p.method === "signInButton.click" && p.args.length === 0, p);
}

// PATTERN B: text with spaces gets auto-quoted
{
  const p = { page: "loginPage", method: "fill", args: ["usernameInput", "some plain text"] };
  const r = tryRewriteInventedHelper(p, "loginPage", KNOWN_FIELDS, KNOWN_METHODS);
  check("Pattern B: text-with-spaces auto-quoted", r === true && p.args[0] === '"some plain text"', p);
}

// PATTERN B: reserved literal 'true' NOT wrapped
{
  const p = { page: "loginPage", method: "check", args: ["usernameInput", "true"] };
  const r = tryRewriteInventedHelper(p, "loginPage", KNOWN_FIELDS, KNOWN_METHODS);
  check("Pattern B: 'true' left unquoted (reserved literal)", r === true && p.args[0] === "true", p);
}

// PATTERN B: identifier-CHAIN value NOT wrapped (property access = likely variable)
{
  const p = { page: "loginPage", method: "fill", args: ["usernameInput", "data.email"] };
  const r = tryRewriteInventedHelper(p, "loginPage", KNOWN_FIELDS, KNOWN_METHODS);
  check("Pattern B: 'data.email' identifier-chain not quoted", r === true && p.args[0] === "data.email", p);
}

// PATTERN B: single bare identifier IS now wrapped (v4.1 SauceDemo fix)
// The LLM emitted `fill(locked_out_user)` when Gherkin was `I enter "locked_out_user"`.
// v4.1 auto-wraps the bare word rather than leaving an undefined reference.
{
  const p = { page: "loginPage", method: "fill", args: ["usernameInput", "locked_out_user"] };
  const r = tryRewriteInventedHelper(p, "loginPage", KNOWN_FIELDS, KNOWN_METHODS);
  check("Pattern B (SauceDemo fix): bare 'locked_out_user' now wrapped as string", r === true && p.args[0] === '"locked_out_user"', p);
}

// PATTERN B: number stays as number (not string-wrapped)
{
  const p = { page: "loginPage", method: "fill", args: ["usernameInput", "42"] };
  const r = tryRewriteInventedHelper(p, "loginPage", KNOWN_FIELDS, KNOWN_METHODS);
  check("Pattern B: number '42' stays as number literal", r === true && p.args[0] === "42", p);
}

// INTEGRATION: full AutomationPractice bench failure now recovers
{
  const emission = JSON.stringify({ pomCall: { page: "loginPage", method: "fill", args: ["usernameInput", "bench@example.com"] } });
  const b = parseBindingJson(emission, STEP);
  check("integration: AutomationPractice Pattern B recovers", b !== undefined && b.pomCall?.method === "usernameInput.fill" && b.pomCall?.args[0] === '"bench@example.com"', b);
}

// PATTERN C: CSS selector arg promoted to customBody with page.locator()
{
  const p = { page: "loginPage", method: "fill", args: ["input[name='email']", "demo@opencart.com"] };
  const r = tryPromotePomCallCssSelectorToCustomBody(p, "loginPage", KNOWN_METHODS);
  check("Pattern C: CSS selector promoted to page.locator() customBody", typeof r === "string" && r.includes('loginPage.page.locator(') && r.includes('input[name') && r.includes('.fill(') && r.includes('demo@opencart.com'), r);
}

// PATTERN C: does NOT fire on bare identifier (Pattern A/B territory)
{
  const p = { page: "loginPage", method: "fill", args: ["usernameInput", "x"] };
  const r = tryPromotePomCallCssSelectorToCustomBody(p, "loginPage", KNOWN_METHODS);
  check("Pattern C: bare identifier NOT promoted (leaves to Pattern B)", r === undefined, r);
}

// PATTERN C: compound CSS selector with descendant space
{
  const p = { page: "loginPage", method: "click", args: ["div.container button.primary"] };
  const r = tryPromotePomCallCssSelectorToCustomBody(p, "loginPage", KNOWN_METHODS);
  check("Pattern C: compound selector with space handled", typeof r === "string" && r.includes('page.locator(') && r.includes('.click()'), r);
}

// PATTERN D: page.fill(pomVar.field, "value") in customBody rewritten
{
  const body = `await page.fill(formAuthPage.usernameInput, "tomsmith");\nawait page.click(formAuthPage.loginButton);`;
  const r = rewriteCustomBodyPageMethods(body, "formAuthPage", new Set(["page", "usernameInput", "passwordInput", "loginButton"]));
  check("Pattern D: page.fill(pomVar.field, val) rewritten to field.fill(val)", r.includes("formAuthPage.usernameInput.fill(") && r.includes("formAuthPage.loginButton.click()") && !r.includes("page.fill("), r);
}

// PATTERN D: single-arg page.click(pomVar.field) also works
{
  const body = `await page.click(formAuthPage.loginButton);`;
  const r = rewriteCustomBodyPageMethods(body, "formAuthPage", new Set(["page", "loginButton"]));
  check("Pattern D: single-arg page.click(pomVar.field) rewritten", r === "await formAuthPage.loginButton.click();", r);
}

// PATTERN D: unknown field left alone
{
  const body = `await page.fill(formAuthPage.emailInput, "x");`;
  const r = rewriteCustomBodyPageMethods(body, "formAuthPage", new Set(["page", "usernameInput"]));
  check("Pattern D: unknown field NOT rewritten (fail-closed)", r === body, r);
}

// PATTERN D: page.goto("/url") left untouched (not in allowlist)
{
  const body = `await page.goto("https://example.com");`;
  const r = rewriteCustomBodyPageMethods(body, "formAuthPage", new Set(["page"]));
  check("Pattern D: page.goto() untouched (not a Locator method)", r === body, r);
}

// PATTERN C TIGHTENING: plain text with spaces NO LONGER treated as CSS
{
  const p = { page: "loginPage", method: "click", args: ["Sign in"] };
  const r = tryPromotePomCallCssSelectorToCustomBody(p, "loginPage", KNOWN_METHODS);
  check("Pattern C: plain 'Sign in' text NOT promoted (needs CSS syntax)", r === undefined, r);
}

// PATTERN C TIGHTENING: legit CSS selectors still work
{
  const p = { page: "loginPage", method: "click", args: ["#submit"] };
  const r = tryPromotePomCallCssSelectorToCustomBody(p, "loginPage", KNOWN_METHODS);
  check("Pattern C: '#submit' selector still promotes", typeof r === "string" && r.includes("locator("), r);
}

// PATTERN F: expect(page).toHaveText — rejected, lands as TODO
{
  const emission = JSON.stringify({ assertion: { locator: "", matcher: "toHaveText", expected: "1" } });
  const b = parseBindingJson(emission, STEP);
  check("Pattern F: expect(page).toHaveText rejected (Locator-only matcher)", b === undefined, b);
}

// PATTERN F: expect(page).toContainText — rejected
{
  const emission = JSON.stringify({ assertion: { locator: "", matcher: "toContainText", expected: "hello" } });
  const b = parseBindingJson(emission, STEP);
  check("Pattern F: expect(page).toContainText rejected", b === undefined, b);
}

// PATTERN F: expect(page).toHaveURL still accepted (legit Page matcher)
{
  const emission = JSON.stringify({ assertion: { locator: "", matcher: "toHaveURL", expected: "/home" } });
  const b = parseBindingJson(emission, STEP);
  check("Pattern F: expect(page).toHaveURL accepted (legit Page matcher)", b !== undefined && b.assertion?.matcher === "toHaveURL", b);
}

// PATTERN F: expect(loginPage.field).toHaveText still accepted (Locator matcher OK)
{
  const emission = JSON.stringify({ assertion: { locator: "loginPage.usernameInput", matcher: "toHaveText", expected: "hi" } });
  const b = parseBindingJson(emission, STEP);
  check("Pattern F: Locator-scoped toHaveText still accepted", b !== undefined && b.assertion?.matcher === "toHaveText", b);
}

// PATTERN F: expect(page).not.toContainText — rejected (matcher wrapped in .not)
{
  const emission = JSON.stringify({ assertion: { locator: "", matcher: "not.toContainText", expected: "hello" } });
  const b = parseBindingJson(emission, STEP);
  check("Pattern F: expect(page).not.toContainText also rejected", b === undefined, b);
}

// PATTERN G: bare identifier as assertion locator, matches known field → prepend pomVar
{
  const emission = JSON.stringify({ assertion: { locator: "usernameInput", matcher: "toHaveText", expected: "hi" } });
  const b = parseBindingJson(emission, STEP);
  check("Pattern G: bare 'usernameInput' rewritten to 'loginPage.usernameInput'", b !== undefined && b.assertion?.locator === "loginPage.usernameInput", b);
}

// PATTERN G: bare identifier NOT a known field → assertion dropped (TODO)
{
  const emission = JSON.stringify({ assertion: { locator: "commentsList", matcher: "toContainText", expected: "Great post" } });
  const b = parseBindingJson(emission, STEP);
  check("Pattern G: bare 'commentsList' (unknown field) → assertion dropped, lands as TODO", b === undefined, b);
}

// PATTERN G: existing pomVar.field locator untouched
{
  const emission = JSON.stringify({ assertion: { locator: "loginPage.usernameInput", matcher: "toHaveText", expected: "hi" } });
  const b = parseBindingJson(emission, STEP);
  check("Pattern G: pomVar.field locator unaffected", b !== undefined && b.assertion?.locator === "loginPage.usernameInput", b);
}

console.log("");
console.log(`Results: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
