#!/usr/bin/env node
const path = require("path");
const assert = require("assert");
const fs = require("fs");

let passed = 0, failed = 0;
async function ok(name, fn) {
  try { await fn(); console.log("  PASS  " + name); passed++; }
  catch (err) { console.log("  FAIL  " + name + "\n        " + err.message); failed++; }
}
function group(t) { console.log("\n" + t); }

const distRoot = path.join(__dirname, "..", "dist");
if (!fs.existsSync(distRoot)) { console.error("dist/ not found"); process.exit(1); }

const naming = require(path.join(distRoot, "utils/naming"));
const schemas = require(path.join(distRoot, "http/schemas"));
const jobs = require(path.join(distRoot, "http/jobs"));
const api = require(path.join(distRoot, "index"));
const facade = require(path.join(distRoot, "emitters/facade"));

(async () => {
  group("naming helpers");
  await ok("pascalCase kebab-case", () => assert.strictEqual(naming.pascalCase("login-page"), "LoginPage"));
  await ok("pascalCase snake_case", () => assert.strictEqual(naming.pascalCase("login_page"), "LoginPage"));
  await ok("pascalCase HTTPServer -> HttpServer", () => assert.strictEqual(naming.pascalCase("HTTPServer"), "HttpServer"));
  await ok("camelCase multi-word", () => assert.strictEqual(naming.camelCase("submit button"), "submitButton"));
  await ok("kebabCase PascalCase", () => assert.strictEqual(naming.kebabCase("LoginPage"), "login-page"));
  await ok("pageObjectFileStem strips Page", () => assert.strictEqual(naming.pageObjectFileStem("LoginPage"), "login.page"));
  await ok("specFileStem", () => assert.strictEqual(naming.specFileStem("User Login"), "user-login.spec"));

  group("http schemas");
  await ok("ScaffoldRequestSchema.safeParse returns object", () => {
    const r = schemas.ScaffoldRequestSchema.safeParse({ feature: "x", url: "https://x.com", page: "P", repo: "/r" });
    assert.ok("success" in r);
  });

  group("job store");
  jobs._resetForTests();
  let created;
  await ok("createJob returns queued state", () => {
    created = jobs.createJob();
    assert.strictEqual(created.status, "queued");
    assert.match(created.id, /^[0-9A-HJKMNP-TV-Z]{26}$/i);
  });
  await ok("updateJob mutates", () => {
    const u = jobs.updateJob(created.id, { status: "running", progress: 0.5 });
    assert.strictEqual(u.status, "running");
  });
  await ok("sweepJobs negative maxAge", () => {
    const n = jobs.sweepJobs(-1000);
    assert.ok(n >= 1);
  });

  group("public API stubs throw NotImplementedError");
  await ok("scaffold throws", async () => {
    let threw = false;
    try { await api.scaffold({ feature: "", url: "", page: "", repo: "" }); }
    catch (e) { threw = true; assert.strictEqual(e.name, "NotImplementedError"); }
    assert.ok(threw);
  });

  group("emitters/facade -- delegates to @vijaypjavvadi/pw-emit");
  const loginPom = {
    className: "LoginPage",
    filePath: "pages/login.page.ts",
    fields: [
      { api: "getByLabel", args: "'Username'", fieldName: "usernameInput", source: { tag: "input" }, confidence: "unique" },
      { api: "getByRole", args: "'button', { name: 'Sign in' }", fieldName: "signInButton", source: { tag: "button" }, confidence: "unique" },
    ],
    methods: [
      { name: "login", params: [{ name: "u", type: "string" }, { name: "p", type: "string" }],
        body: "await this.usernameInput.fill(u);\nawait this.signInButton.click();",
        origin: "generated" },
    ],
    exists: false,
  };
  await ok("emitPageObject(create) renders a TS class via pw-emit", () => {
    const r = facade.emitPageObject({ pom: loginPom, mode: "create" });
    assert.ok(r.contents.includes("export class LoginPage {"));
    assert.ok(r.contents.includes("readonly usernameInput: Locator;"));
    assert.ok(r.contents.includes("this.signInButton = page.getByRole('button', { name: 'Sign in' });"));
    assert.ok(r.contents.includes("async login(u: string, p: string): Promise<void> {"));
    assert.ok(r.contents.includes("    await this.usernameInput.fill(u);"));
  });
  await ok("emitPageObject(augment) without existing throws EmitterConsistencyError", () => {
    let threw = false;
    try { facade.emitPageObject({ pom: loginPom, mode: "augment" }); }
    catch (e) { threw = true; assert.strictEqual(e.name, "EmitterConsistencyError"); }
    assert.ok(threw);
  });
  await ok("emitPageObject with selfHealingShim wraps initialisers", () => {
    const r = facade.emitPageObject({ pom: loginPom, mode: "create", selfHealingShim: true });
    assert.ok(r.contents.includes("import { healOrThrow } from"));
    assert.ok(r.contents.includes("healOrThrow(page, {"));
  });
  await ok("emitTestFile renders a spec via pw-emit (POM call binding)", () => {
    const r = facade.emitTestFile({
      describeName: "User Login",
      beforeEach: [
        { step: { keyword: "Given", text: "I am on the login page" },
          pomCall: { page: "loginPage", method: "goto", args: [] } },
      ],
      scenarios: [
        { name: "Successful login", bindings: [
          { step: { keyword: "When", text: "I enter username" },
            pomCall: { page: "loginPage", method: "login", args: ['"alice"', '"secret"'] } },
          { step: { keyword: "Then", text: "I see dashboard" },
            assertion: { locator: "loginPage.dashboardHeading", matcher: "toBeVisible" } },
        ]},
      ],
      pomImports: [{ className: "LoginPage", fromPath: "../pages/login.page" }],
    });
    assert.ok(r.contents.includes('test.describe("User Login", () => {'));
    assert.ok(r.contents.includes('import { LoginPage } from "../pages/login.page";'));
    assert.ok(r.contents.includes("test.beforeEach(async ({ page }) => {"));
    assert.ok(r.contents.includes("await loginPage.goto();"));
    assert.ok(r.contents.includes('await loginPage.login("alice", "secret");'));
    assert.ok(r.contents.includes("await expect(loginPage.dashboardHeading).toBeVisible();"));
    assert.ok(r.contents.includes('// Given I am on the login page'));
  });
  await ok("emitTestFile handles unmapped step as // TODO", () => {
    const r = facade.emitTestFile({
      describeName: "X",
      scenarios: [{ name: "T", bindings: [
        { step: { keyword: "When", text: "I do something exotic" }, warning: "no rule matched" },
      ]}],
      pomImports: [],
    });
    assert.ok(r.contents.includes("// TODO: no rule matched"));
  });

  console.log("\n" + passed + " passed, " + failed + " failed");
  process.exit(failed === 0 ? 0 : 1);
})();
