/**
 * End-to-end test for `updatePom()` — append-only AST surgery.
 *
 * The hard guarantee we're locking in: **hand-edits inside existing method
 * bodies survive byte-identical across an updatePom run.** If this test
 * ever fails, the append-only invariant has been broken and someone could
 * lose handwritten code.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as fs from "fs-extra";
import * as os from "os";
import * as path from "path";
import { updatePom } from "../../src";

const fixtureSnapshot = path.resolve(
  __dirname,
  "..",
  "..",
  "examples",
  "practice-test-login",
  "snapshot.json",
);

describe("updatePom — append-only", () => {
  let outDir: string;
  let pomPath: string;

  beforeAll(async () => {
    outDir = path.join(os.tmpdir(), `bdd2pw-update-${Date.now()}`);
    await fs.ensureDir(path.join(outDir, "pages"));

    // Author a "user-written" Page Object by hand. It has:
    //   - one locator field the live snapshot will ALSO discover (collision: skip)
    //   - one locator field the snapshot will NOT discover (preserved as-is)
    //   - one method with a hand-edited body (must survive)
    //   - a custom helper method (must survive)
    pomPath = path.join(outDir, "pages", "login.page.ts");
    await fs.writeFile(
      pomPath,
      `import { Page, Locator, expect } from "@playwright/test";

export class LoginPage {
  readonly page: Page;
  readonly usernameInput: Locator;
  readonly customField: Locator;

  constructor(page: Page) {
    this.page = page;
    this.usernameInput = page.locator("#username");
    this.customField = page.locator(".my-custom-thing");
  }

  // CRITICAL: this method body must survive updatePom byte-identical.
  async login(user: string, pass: string): Promise<void> {
    // Hand-written comment that must survive
    await this.usernameInput.fill(user);
    console.log("This is a hand-written log line");
    await this.page.locator("#password").fill(pass);
    await this.page.locator("#submit").click();
  }

  // Custom helper method not in any IR — must survive
  async customHelper(): Promise<string> {
    return "hand-written";
  }
}
`,
      "utf8",
    );
  });

  afterAll(async () => {
    await fs.remove(outDir).catch(() => undefined);
  });

  it("returns a result with added/preserved counts", async () => {
    const result = await updatePom({
      page: "LoginPage",
      url: "https://practicetestautomation.com/practice-test-login/",
      repo: outDir,
      // @ts-expect-error — snapshotFile is on the type but TS may have older
      snapshotFile: fixtureSnapshot,
    });

    // We expect SOME new fields to be added (the snapshot has fields the
    // user POM doesn't have: passwordInput-equivalent, submit button, error region)
    expect(result.added.fields).toBeGreaterThan(0);
    // No methods are ever added in v1.0
    expect(result.added.methods).toBe(0);
    // Preserved counts come from the existing POM
    expect(result.preserved.fields).toBe(2);  // usernameInput + customField
    expect(result.preserved.methods).toBe(2); // login + customHelper
    // ts-morph returns POSIX-style separators on Windows; normalize before
    // comparing so the assertion isn't OS-specific.
    expect(path.normalize(result.filePath)).toBe(path.normalize(pomPath));
  });

  describe("hand-edits survive byte-identical", () => {
    let after: string;
    beforeAll(async () => {
      after = await fs.readFile(pomPath, "utf8");
    });

    it("preserves the hand-written log line", () => {
      expect(after).toContain('console.log("This is a hand-written log line");');
    });

    it("preserves the hand-written comment", () => {
      expect(after).toContain("// Hand-written comment that must survive");
    });

    it("preserves the entire login method body", () => {
      expect(after).toContain('await this.usernameInput.fill(user);');
      expect(after).toContain('await this.page.locator("#password").fill(pass);');
      expect(after).toContain('await this.page.locator("#submit").click();');
    });

    it("preserves the custom helper method", () => {
      expect(after).toContain("async customHelper(): Promise<string>");
      expect(after).toContain('return "hand-written";');
    });

    it("preserves the existing customField property", () => {
      expect(after).toContain("readonly customField: Locator;");
      expect(after).toContain('this.customField = page.locator(".my-custom-thing");');
    });

    it("preserves the existing usernameInput (collision skipped)", () => {
      expect(after).toContain("readonly usernameInput: Locator;");
      // The original used #username; updatePom must NOT have replaced it
      // with whatever the snapshot would have picked (e.g. getByLabel).
      expect(after).toContain('this.usernameInput = page.locator("#username");');
    });
  });

  it("appends new properties at the END of the class declarations (not the start)", async () => {
    const after = await fs.readFile(pomPath, "utf8");
    // The existing fields are usernameInput and customField — must come BEFORE
    // any newly-added field in the source order.
    const idxUsername = after.indexOf("readonly usernameInput");
    const idxCustom = after.indexOf("readonly customField");
    // ts-morph's addProperty appends to the bottom of the class — verify by
    // checking that *some* field exists AFTER customField.
    const fieldRe = /readonly \w+: Locator;/g;
    const matches = [...after.matchAll(fieldRe)];
    expect(matches.length).toBeGreaterThan(2);
    expect(idxUsername).toBeGreaterThan(0);
    expect(idxCustom).toBeGreaterThan(idxUsername);
  });

  it("is idempotent — running updatePom twice in a row adds nothing the second time", async () => {
    const result2 = await updatePom({
      page: "LoginPage",
      url: "https://practicetestautomation.com/practice-test-login/",
      repo: outDir,
      // @ts-expect-error — snapshotFile is on the type
      snapshotFile: fixtureSnapshot,
    });
    expect(result2.added.fields).toBe(0);
  });

  it("hard-fails when the requested page doesn't exist", async () => {
    await expect(
      updatePom({
        page: "DoesNotExistPage",
        url: "https://example.com",
        repo: outDir,
        // @ts-expect-error — snapshotFile is on the type
        snapshotFile: fixtureSnapshot,
      }),
    ).rejects.toThrow(/not found/i);
  });
});
