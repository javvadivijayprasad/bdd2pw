/**
 * v4.4.0 — `--spec-name <stem>` end-to-end.
 *
 * Covers the attestqa integration contract (reply dated 2026-10-11):
 *
 *  - When `specName` is set, the emitted spec file lives at
 *    `tests/<specName>.spec.ts`.
 *  - When `specName` is omitted, the historical POM-derived behavior
 *    is byte-stable with earlier versions
 *    (`LoginPage` → `tests/login.spec.ts`).
 *  - The POM filename, class name, and `../pages/<pomStem>` import
 *    path are never touched by `specName` — only the spec filename.
 *  - Trailing `.spec.ts` / `.spec` suffixes in `specName` are
 *    tolerated so attestqa can pass either form.
 *  - The sidecar `*.spec.meta.json` follows the spec stem.
 */

import { afterEach, describe, expect, it } from "vitest";
import * as fs from "fs-extra";
import * as os from "os";
import * as path from "path";
import { scaffold } from "../../src";

const fixtureDir = path.resolve(
  __dirname,
  "..",
  "..",
  "examples",
  "practice-test-login",
);
const featurePath = path.join(fixtureDir, "login.feature");
const snapshotPath = path.join(fixtureDir, "snapshot.json");

const tmpDirs: string[] = [];
async function makeOut(): Promise<string> {
  const d = await fs.mkdtemp(path.join(os.tmpdir(), "bdd2pw-specname-"));
  tmpDirs.push(d);
  return d;
}
afterEach(async () => {
  while (tmpDirs.length > 0) {
    const d = tmpDirs.pop()!;
    await fs.remove(d).catch(() => {});
  }
});

describe("v4.4.0 — --spec-name attestqa integration", () => {
  it("writes tests/<specName>.spec.ts when specName is set", async () => {
    const outDir = await makeOut();
    const stem = "epic-scrum-5-customer-account-access";
    await scaffold({
      feature: featurePath,
      url: "https://practicetestautomation.com/practice-test-login/",
      page: "LoginPage",
      repo: outDir,
      noValidate: true,
      specName: stem,
      // @ts-expect-error — snapshot-file bypass (same as the other e2e tests)
      snapshotFile: snapshotPath,
    });
    expect(await fs.pathExists(path.join(outDir, "tests", `${stem}.spec.ts`))).toBe(true);
    // Historical default name must NOT appear when the flag is set.
    expect(await fs.pathExists(path.join(outDir, "tests", "login.spec.ts"))).toBe(false);
  });

  it("writes the sidecar at <specName>.spec.meta.json alongside the spec", async () => {
    const outDir = await makeOut();
    const stem = "epic-42-login";
    await scaffold({
      feature: featurePath,
      url: "https://practicetestautomation.com/practice-test-login/",
      page: "LoginPage",
      repo: outDir,
      noValidate: true,
      specName: stem,
      metaSidecar: true,
      // @ts-expect-error — snapshot-file bypass
      snapshotFile: snapshotPath,
    });
    expect(
      await fs.pathExists(path.join(outDir, "tests", `${stem}.spec.meta.json`)),
    ).toBe(true);
    expect(
      await fs.pathExists(path.join(outDir, "tests", "login.spec.meta.json")),
    ).toBe(false);
  });

  it("does NOT change the POM filename, class name, or import path", async () => {
    const outDir = await makeOut();
    await scaffold({
      feature: featurePath,
      url: "https://practicetestautomation.com/practice-test-login/",
      page: "LoginPage",
      repo: outDir,
      noValidate: true,
      specName: "epic-99-anything",
      // @ts-expect-error — snapshot-file bypass
      snapshotFile: snapshotPath,
    });
    // POM filename unchanged — still login.page.ts (not epic-99-anything.page.ts).
    expect(await fs.pathExists(path.join(outDir, "pages", "login.page.ts"))).toBe(true);
    expect(
      await fs.pathExists(path.join(outDir, "pages", "epic-99-anything.page.ts")),
    ).toBe(false);
    // The POM file carries the class declaration.
    const pomContents = await fs.readFile(
      path.join(outDir, "pages", "login.page.ts"),
      "utf8",
    );
    expect(pomContents).toContain("class LoginPage");
    // The spec file imports the POM from `../pages/login.page` and
    // instantiates it with the original class name — neither follows the
    // overridden spec stem.
    const specContents = await fs.readFile(
      path.join(outDir, "tests", "epic-99-anything.spec.ts"),
      "utf8",
    );
    expect(specContents).toContain('from "../pages/login.page"');
    expect(specContents).toContain("import { LoginPage }");
    expect(specContents).toContain("new LoginPage(page)");
    // Negative: no accidental cross-pollination of the overridden stem
    // into the import path or class usage.
    expect(specContents).not.toContain("epic-99-anything.page");
    expect(specContents).not.toContain("new EpicPage");
  });

  it("tolerates specName with trailing .spec.ts or .spec suffixes", async () => {
    const outDir = await makeOut();
    await scaffold({
      feature: featurePath,
      url: "https://practicetestautomation.com/practice-test-login/",
      page: "LoginPage",
      repo: outDir,
      noValidate: true,
      specName: "epic-foo.spec.ts",
      // @ts-expect-error — snapshot-file bypass
      snapshotFile: snapshotPath,
    });
    expect(
      await fs.pathExists(path.join(outDir, "tests", "epic-foo.spec.ts")),
    ).toBe(true);
    // No double-suffix.
    expect(
      await fs.pathExists(path.join(outDir, "tests", "epic-foo.spec.ts.spec.ts")),
    ).toBe(false);

    const outDir2 = await makeOut();
    await scaffold({
      feature: featurePath,
      url: "https://practicetestautomation.com/practice-test-login/",
      page: "LoginPage",
      repo: outDir2,
      noValidate: true,
      specName: "epic-bar.spec",
      // @ts-expect-error — snapshot-file bypass
      snapshotFile: snapshotPath,
    });
    expect(
      await fs.pathExists(path.join(outDir2, "tests", "epic-bar.spec.ts")),
    ).toBe(true);
  });

  it("default (no specName) is byte-identical to pre-v4.4 behavior", async () => {
    const outDir = await makeOut();
    await scaffold({
      feature: featurePath,
      url: "https://practicetestautomation.com/practice-test-login/",
      page: "LoginPage",
      repo: outDir,
      noValidate: true,
      // @ts-expect-error — snapshot-file bypass
      snapshotFile: snapshotPath,
    });
    // Historical name — login.page.ts → login.spec.ts.
    expect(await fs.pathExists(path.join(outDir, "tests", "login.spec.ts"))).toBe(true);
  });

  it("empty / whitespace-only specName falls back to the default stem", async () => {
    const outDir = await makeOut();
    await scaffold({
      feature: featurePath,
      url: "https://practicetestautomation.com/practice-test-login/",
      page: "LoginPage",
      repo: outDir,
      noValidate: true,
      specName: "   ",
      // @ts-expect-error — snapshot-file bypass
      snapshotFile: snapshotPath,
    });
    expect(await fs.pathExists(path.join(outDir, "tests", "login.spec.ts"))).toBe(true);
  });
});
