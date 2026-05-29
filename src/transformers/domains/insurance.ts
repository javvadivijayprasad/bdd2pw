/**
 * v3.4.0 — Insurance domain rule pack.
 *
 * Opt-in via `ScaffoldOptions.domains: ["insurance"]`. Covers common
 * P&C / life / health insurance dialects: policies, premiums, claims,
 * coverage limits, effective dates, claim filing windows, loss
 * reserves, line of business, NAIC codes, adjuster assignment.
 */

import type { PageObjectIR, StepBinding, StepIR } from "../../types";

interface Rule {
  pattern: RegExp;
  build(
    m: RegExpMatchArray,
    step: StepIR,
    pom: PageObjectIR,
    pageVar: string,
  ): StepBinding | null;
}

const SUBJ = "(?:I|user|User|the user|the User|the adjuster|the agent)";
const MONEY = `\\$?["']?\\$?([\\d,]+(?:\\.\\d{1,2})?)["']?`;

export const INSURANCE_RULES: Rule[] = [
  // INS:01 — `the policy number is "POL-12345"`
  {
    pattern: /^(?:the )?policy number is ["']?([A-Z]{2,5}-?\d{4,12})["']?$/i,
    build: (m, step) => ({
      step,
      customBody: `await expect(page.locator("[data-testid='policy-number']").first()).toContainText(${JSON.stringify(m[1])});`,
    }),
  },

  // INS:02 — `the premium amount is "$150"`
  {
    pattern: new RegExp(`^(?:the )?premium(?: amount)? is ${MONEY}$`, "i"),
    build: (m, step) => ({
      step,
      customBody: `await expect(page.locator("[data-testid='premium-amount']").first()).toContainText(${JSON.stringify(m[1])});`,
    }),
  },

  // INS:03 — `the claim status is "approved"`
  {
    pattern: /^(?:the )?claim status is ["']([^"']+)["']$/i,
    build: (m, step) => ({
      step,
      customBody: `await expect(page.locator("[data-testid='claim-status']").first()).toContainText(${JSON.stringify(m[1])});`,
    }),
  },

  // INS:04 — `the deductible is "$500"` / `the deductible is at least $X`
  {
    pattern: new RegExp(
      `^(?:the )?deductible is (?:(at least|at most|less than|greater than|exactly) )?${MONEY}$`,
      "i",
    ),
    build: (m, step) => {
      const op = (m[1] ?? "").toLowerCase();
      const num = m[2].replace(/,/g, "");
      if (!op) {
        return {
          step,
          customBody: `await expect(page.locator("[data-testid='deductible']").first()).toContainText(${JSON.stringify(m[2])});`,
        };
      }
      const matcher = ({
        "at least": "toBeGreaterThanOrEqual",
        "at most": "toBeLessThanOrEqual",
        "less than": "toBeLessThan",
        "greater than": "toBeGreaterThan",
        exactly: "toBe",
      } as Record<string, string>)[op]!;
      return {
        step,
        customBody: [
          `const _ded = await page.locator("[data-testid='deductible']").first().innerText();`,
          `const _dedNum = Number(_ded.replace(/[^\\d.-]/g, ""));`,
          `expect(_dedNum).${matcher}(${num});`,
        ].join("\n"),
      };
    },
  },

  // INS:05 — `the policy effective date is "2026-01-01"`
  {
    pattern:
      /^(?:the )?policy(?: effective)? date is ["']?(\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/\d{2,4})["']?$/i,
    build: (m, step) => ({
      step,
      customBody: `await expect(page.locator("[data-testid='policy-effective-date']").first()).toContainText(${JSON.stringify(m[1])});`,
    }),
  },

  // INS:06 — `the claim is filed within (N) days of the loss`
  {
    pattern:
      /^(?:the )?claim is filed within (\d+) days(?: of the loss)?$/i,
    build: (m, step) => ({
      step,
      customBody: [
        `// Claim-filing window check (${m[1]} days). Asserts the UI reports`,
        `// the dispute / claim is inside the policy's filing window.`,
        `await expect(page.locator("[data-testid='filing-window-status']").first()).toContainText(/within (?:window|${m[1]}.*days)/i);`,
      ].join("\n"),
    }),
  },

  // INS:07 — `the loss reserve is "$10,000"`
  {
    pattern: new RegExp(`^(?:the )?loss reserve is ${MONEY}$`, "i"),
    build: (m, step) => ({
      step,
      customBody: `await expect(page.locator("[data-testid='loss-reserve']").first()).toContainText(${JSON.stringify(m[1])});`,
    }),
  },

  // INS:08 — `the line of business is "auto"`
  {
    pattern: /^(?:the )?line of business is ["']([^"']+)["']$/i,
    build: (m, step) => ({
      step,
      customBody: `await expect(page.locator("[data-testid='line-of-business'], [data-lob]").first()).toContainText(${JSON.stringify(m[1])});`,
    }),
  },

  // INS:09 — `the NAIC code is "12345"`
  {
    pattern: /^(?:the )?NAIC(?: code)? is ["']?(\d{5})["']?$/i,
    build: (m, step) => ({
      step,
      customBody: `await expect(page.locator("[data-testid='naic-code']").first()).toContainText(${JSON.stringify(m[1])});`,
    }),
  },

  // INS:10 — `the claim is assigned to "Smith"`
  {
    pattern:
      /^(?:the )?(?:claim|case|file) is assigned to ["']([^"']+)["']$/i,
    build: (m, step) => ({
      step,
      customBody: `await expect(page.locator("[data-testid='assigned-adjuster']").first()).toContainText(${JSON.stringify(m[1])});`,
    }),
  },

  // INS:11 — `I file a claim for "$X"`
  {
    pattern: new RegExp(
      `^(?:${SUBJ}\\s+)?file(?:s)? (?:a )?claim for ${MONEY}$`,
      "i",
    ),
    build: (m, step) => ({
      step,
      customBody: [
        `await page.getByRole("button", { name: /file (?:a )?claim/i }).click();`,
        `await page.getByLabel(/claim amount/i).fill(${JSON.stringify(m[1])});`,
        `await page.getByRole("button", { name: /submit/i }).click();`,
      ].join("\n"),
    }),
  },

  // INS:12 — `the coverage limit is "$100,000"`
  {
    pattern: new RegExp(`^(?:the )?coverage limit is ${MONEY}$`, "i"),
    build: (m, step) => ({
      step,
      customBody: `await expect(page.locator("[data-testid='coverage-limit']").first()).toContainText(${JSON.stringify(m[1])});`,
    }),
  },

  // INS:13 — `the policy is "active"` / `"lapsed"` / `"cancelled"`
  {
    pattern: /^(?:the )?policy is ["']([^"']+)["']$/i,
    build: (m, step) => ({
      step,
      customBody: `await expect(page.locator("[data-testid='policy-status']").first()).toContainText(${JSON.stringify(m[1])});`,
    }),
  },

  // INS:14 — `the policyholder is "John Doe"`
  {
    pattern: /^(?:the )?policyholder(?:'?s name)? is ["']([^"']+)["']$/i,
    build: (m, step) => ({
      step,
      customBody: `await expect(page.locator("[data-testid='policyholder-name']").first()).toContainText(${JSON.stringify(m[1])});`,
    }),
  },

  // INS:15 — `I cancel the policy`
  {
    pattern: new RegExp(`^(?:${SUBJ}\\s+)?cancel(?:s)? (?:the )?policy$`, "i"),
    build: (_m, step) => ({
      step,
      customBody: [
        `await page.getByRole("button", { name: /cancel policy/i }).click();`,
        `await page.getByRole("button", { name: /confirm/i }).click();`,
      ].join("\n"),
    }),
  },

  // INS:16 — `I renew the policy`
  {
    pattern: new RegExp(`^(?:${SUBJ}\\s+)?renew(?:s)? (?:the )?policy$`, "i"),
    build: (_m, step) => ({
      step,
      customBody: [
        `await page.getByRole("button", { name: /renew/i }).click();`,
        `await page.getByRole("button", { name: /confirm/i }).click();`,
      ].join("\n"),
    }),
  },

  // INS:17 — `the subrogation case is "opened"` / `"closed"`
  {
    pattern: /^(?:the )?subrogation(?: case)? is ["']([^"']+)["']$/i,
    build: (m, step) => ({
      step,
      customBody: `await expect(page.locator("[data-testid='subrogation-status']").first()).toContainText(${JSON.stringify(m[1])});`,
    }),
  },

  // INS:18 — `the premium has been paid`
  {
    pattern: /^(?:the )?premium has (not )?been paid$/i,
    build: (m, step) => {
      const matcher = m[1] ? "not.toBeVisible" : "toBeVisible";
      return {
        step,
        customBody: `await expect(page.locator("[data-testid='premium-paid-indicator'], [aria-label='Premium paid']").first()).${matcher}();`,
      };
    },
  },

  // INS:19 — `the claim payout is "$X"`
  {
    pattern: new RegExp(`^(?:the )?(?:claim )?payout(?: amount)? is ${MONEY}$`, "i"),
    build: (m, step) => ({
      step,
      customBody: `await expect(page.locator("[data-testid='claim-payout']").first()).toContainText(${JSON.stringify(m[1])});`,
    }),
  },

  // INS:20 — `the policy renewal date is "2027-01-01"`
  {
    pattern:
      /^(?:the )?policy renewal date is ["']?(\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/\d{2,4})["']?$/i,
    build: (m, step) => ({
      step,
      customBody: `await expect(page.locator("[data-testid='renewal-date']").first()).toContainText(${JSON.stringify(m[1])});`,
    }),
  },
];
