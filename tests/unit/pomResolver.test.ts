import { describe, it, expect } from "vitest";
import { resolvePom } from "../../src/transformers/pomResolver";
import type { PageObjectIR } from "../../src/types";

const existingLogin: PageObjectIR = {
  className: "LoginPage",
  filePath: "pages/login.page.ts",
  fields: [
    { api: "getByLabel", args: "'Username'", fieldName: "usernameInput", source: { tag: "" }, confidence: "unique" },
    { api: "getByRole", args: "'button'", fieldName: "loginButton", source: { tag: "" }, confidence: "unique" },
  ],
  methods: [],
  exists: true,
};

describe("resolvePom", () => {
  it("CREATE when no POM exists", () => {
    const r = resolvePom({
      requestedName: "LoginPage",
      existing: new Map(),
      referencedFields: ["usernameInput"],
    });
    expect(r.decision).toBe("CREATE");
    expect(r.existing).toBeUndefined();
  });

  it("REUSE when all referenced fields are present", () => {
    const r = resolvePom({
      requestedName: "LoginPage",
      existing: new Map([["LoginPage", existingLogin]]),
      referencedFields: ["usernameInput", "loginButton"],
    });
    expect(r.decision).toBe("REUSE");
    expect(r.missingFields).toEqual([]);
  });

  it("AUGMENT when some fields are missing", () => {
    const r = resolvePom({
      requestedName: "LoginPage",
      existing: new Map([["LoginPage", existingLogin]]),
      referencedFields: ["usernameInput", "loginButton", "passwordInput"],
    });
    expect(r.decision).toBe("AUGMENT");
    expect(r.missingFields).toEqual(["passwordInput"]);
  });

  it("dedupes referencedFields when computing missing", () => {
    const r = resolvePom({
      requestedName: "LoginPage",
      existing: new Map([["LoginPage", existingLogin]]),
      referencedFields: ["passwordInput", "passwordInput", "loginButton"],
    });
    expect(r.missingFields).toEqual(["passwordInput"]);
  });
});
