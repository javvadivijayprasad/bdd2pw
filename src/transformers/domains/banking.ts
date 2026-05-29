/**
 * v3.4.0 — Banking domain rule pack.
 *
 * Opt-in via `ScaffoldOptions.domains: ["banking"]`. When activated,
 * these rules slot into the matcher registry BEFORE the URL-slug
 * guardrails so banking-specific prose ("the account balance is
 * $1,234.56") intercepts before drifting into the generic catch-all.
 *
 * Each rule emits `customBody` rather than a pomCall/assertion so the
 * downstream emitter doesn't need to invent a POM field. The body
 * lines reference standard test helpers (`page.evaluate`,
 * `expect(text).toMatch`) that work against any banking app.
 *
 * Coverage:
 *   - Account balance (toContainText with currency-formatted value)
 *   - Transfers between accounts
 *   - Transaction fees
 *   - Statement transaction counts
 *   - Daily withdrawal / deposit limits
 *   - Regulation E (dispute filing windows)
 *   - Regulation D (savings withdrawal counts)
 *   - KYC / AML statuses
 *   - Transaction dates
 *   - Account opening / closing
 *
 * Patterns intentionally accept either `$1,234.56` or `"$1,234.56"`
 * (LLM-emitted .feature files sometimes quote the currency). Numeric
 * captures preserve commas — they're surfaced to the test as-is so
 * the assertion matches what the page actually renders.
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

/** Subject prefix matches the stepMatcher convention. */
const SUBJ = "(?:I|user|User|the user|the User)";
/** Quoted-or-bare currency capture, e.g. `$1,234.56`, `"$500"`. */
const MONEY = `\\$?["']?\\$?([\\d,]+(?:\\.\\d{1,2})?)["']?`;
/** ISO date capture or quoted free-form date. */
const DATE = `["']?(\\d{4}-\\d{2}-\\d{2}|\\d{1,2}\\/\\d{1,2}\\/\\d{2,4})["']?`;

export const BANKING_RULES: Rule[] = [
  // BANK:01 — `the account balance is "$1,234.56"`
  {
    pattern: new RegExp(`^(?:the )?account balance is ${MONEY}$`, "i"),
    build: (m, step) => ({
      step,
      customBody: [
        `const _bankingBalance = await page.locator("[data-testid='account-balance'], .account-balance, [aria-label*='balance' i]").first().innerText();`,
        `expect(_bankingBalance.replace(/[^\\d.,]/g, "")).toContain(${JSON.stringify(m[1])});`,
      ].join("\n"),
    }),
  },

  // BANK:02 — `the account balance is at least "$X"` / `at most "$X"` / `greater than "$X"`
  {
    pattern: new RegExp(
      `^(?:the )?account balance is (at least|at most|greater than|less than|exactly) ${MONEY}$`,
      "i",
    ),
    build: (m, step) => {
      const op = m[1].toLowerCase();
      const matcher = ({
        "at least": "toBeGreaterThanOrEqual",
        "at most": "toBeLessThanOrEqual",
        "greater than": "toBeGreaterThan",
        "less than": "toBeLessThan",
        exactly: "toBe",
      } as Record<string, string>)[op]!;
      const num = m[2].replace(/,/g, "");
      return {
        step,
        customBody: [
          `const _bal = await page.locator("[data-testid='account-balance'], .account-balance").first().innerText();`,
          `const _balNum = Number(_bal.replace(/[^\\d.-]/g, ""));`,
          `expect(_balNum).${matcher}(${num});`,
        ].join("\n"),
      };
    },
  },

  // BANK:03 — `I transfer "$500" from "checking" to "savings"`
  {
    pattern: new RegExp(
      `^(?:${SUBJ}\\s+)?transfer(?:s)? ${MONEY} from ["']([^"']+)["'] to ["']([^"']+)["']$`,
      "i",
    ),
    build: (m, step) => ({
      step,
      customBody: [
        `await page.getByLabel(/from account/i).selectOption({ label: ${JSON.stringify(m[2])} });`,
        `await page.getByLabel(/to account/i).selectOption({ label: ${JSON.stringify(m[3])} });`,
        `await page.getByLabel(/amount/i).fill(${JSON.stringify(m[1])});`,
        `await page.getByRole("button", { name: /transfer|submit/i }).click();`,
      ].join("\n"),
    }),
  },

  // BANK:04 — `the transaction fee is less than "$5"`
  {
    pattern: new RegExp(
      `^(?:the )?transaction fee is (at most|less than|exactly|at least|greater than) ${MONEY}$`,
      "i",
    ),
    build: (m, step) => {
      const op = m[1].toLowerCase();
      const matcher = ({
        "at most": "toBeLessThanOrEqual",
        "less than": "toBeLessThan",
        exactly: "toBe",
        "at least": "toBeGreaterThanOrEqual",
        "greater than": "toBeGreaterThan",
      } as Record<string, string>)[op]!;
      const num = m[2].replace(/,/g, "");
      return {
        step,
        customBody: [
          `const _fee = await page.locator("[data-testid='transaction-fee'], .fee").first().innerText();`,
          `const _feeNum = Number(_fee.replace(/[^\\d.-]/g, ""));`,
          `expect(_feeNum).${matcher}(${num});`,
        ].join("\n"),
      };
    },
  },

  // BANK:05 — `the statement shows (N) transactions`
  {
    pattern: /^(?:the )?statement shows (\d+) transactions?$/i,
    build: (m, step) => ({
      step,
      customBody: [
        `const _txnCount = await page.locator("[data-testid='transaction-row'], tr.transaction").count();`,
        `expect(_txnCount).toBe(${m[1]});`,
      ].join("\n"),
    }),
  },

  // BANK:06 — `the daily withdrawal limit is "$500"`
  {
    pattern: new RegExp(
      `^(?:the )?daily (withdrawal|deposit|transfer) limit is ${MONEY}$`,
      "i",
    ),
    build: (m, step) => ({
      step,
      customBody: [
        `const _limit = await page.locator(\`[data-testid='daily-${m[1].toLowerCase()}-limit']\`).innerText();`,
        `expect(_limit).toContain(${JSON.stringify(m[2])});`,
      ].join("\n"),
    }),
  },

  // BANK:07 — `I open a "checking" account`
  {
    pattern: new RegExp(
      `^(?:${SUBJ}\\s+)?open(?:s)? a(?:n)? ["']?([\\w ]+?)["']? account$`,
      "i",
    ),
    build: (m, step) => ({
      step,
      customBody: [
        `await page.getByRole("button", { name: /open.*account/i }).click();`,
        `await page.getByLabel(/account type/i).selectOption({ label: ${JSON.stringify(m[1])} });`,
        `await page.getByRole("button", { name: /create|open|submit/i }).click();`,
      ].join("\n"),
    }),
  },

  // BANK:08 — `I close the "savings" account`
  {
    pattern: new RegExp(
      `^(?:${SUBJ}\\s+)?close(?:s)? the ["']?([\\w ]+?)["']? account$`,
      "i",
    ),
    build: (m, step) => ({
      step,
      customBody: [
        `await page.getByRole("link", { name: ${JSON.stringify(m[1])} }).click();`,
        `await page.getByRole("button", { name: /close account/i }).click();`,
        `await page.getByRole("button", { name: /confirm/i }).click();`,
      ].join("\n"),
    }),
  },

  // BANK:09 — `the transaction date is "2026-05-22"`
  {
    pattern: new RegExp(`^(?:the )?transaction date is ${DATE}$`, "i"),
    build: (m, step) => ({
      step,
      customBody: [
        `const _txnDate = await page.locator("[data-testid='transaction-date']").first().innerText();`,
        `expect(_txnDate).toContain(${JSON.stringify(m[1])});`,
      ].join("\n"),
    }),
  },

  // BANK:10 — `the payment status is "pending"`
  {
    pattern:
      /^(?:the )?(?:payment|transaction|transfer) status is ["']([^"']+)["']$/i,
    build: (m, step) => ({
      step,
      customBody: `await expect(page.locator("[data-testid='payment-status'], .payment-status").first()).toContainText(${JSON.stringify(m[1])});`,
    }),
  },

  // BANK:11 — Reg E: `the dispute is filed within 60 days of the statement`
  {
    pattern:
      /^(?:the )?dispute is filed within (\d+) days(?: of the statement)?$/i,
    build: (m, step) => ({
      step,
      customBody: [
        `// Reg E dispute window check (${m[1]} days). The DOM should expose`,
        `// a data-attribute or text indicating the filing window status.`,
        `await expect(page.locator("[data-testid='dispute-status']").first()).toContainText(/within (?:window|${m[1]}.*days)/i);`,
      ].join("\n"),
    }),
  },

  // BANK:12 — Reg D: `the savings withdrawal count is (N)`
  {
    pattern: /^(?:the )?savings withdrawal count is (\d+)$/i,
    build: (m, step) => ({
      step,
      customBody: [
        `const _withdrawCount = await page.locator("[data-testid='reg-d-count']").innerText();`,
        `expect(Number(_withdrawCount.replace(/\\D/g, ""))).toBe(${m[1]});`,
      ].join("\n"),
    }),
  },

  // BANK:13 — `the customer has completed KYC verification`
  // and `the customer has not completed KYC verification`
  {
    pattern:
      /^(?:the )?customer has (not )?completed KYC(?: verification)?$/i,
    build: (m, step) => {
      const matcher = m[1] ? "not.toBeVisible" : "toBeVisible";
      return {
        step,
        customBody: `await expect(page.locator("[data-testid='kyc-complete'], [aria-label='KYC verified']").first()).${matcher}();`,
      };
    },
  },

  // BANK:14 — `the transaction is flagged for AML review`
  {
    pattern:
      /^(?:the )?transaction is (not )?flagged for AML(?: review)?$/i,
    build: (m, step) => {
      const matcher = m[1] ? "not.toBeVisible" : "toBeVisible";
      return {
        step,
        customBody: `await expect(page.locator("[data-testid='aml-flag']").first()).${matcher}();`,
      };
    },
  },

  // BANK:15 — `the account number ends in "1234"`
  {
    pattern: /^(?:the )?account number ends (?:in|with) ["'](\d{4})["']$/i,
    build: (m, step) => ({
      step,
      customBody: `await expect(page.locator("[data-testid='account-number'], .acct-number").first()).toContainText(/${m[1]}$/);`,
    }),
  },

  // BANK:16 — `the routing number is "021000021"`
  {
    pattern: /^(?:the )?routing number is ["']?(\d{9})["']?$/i,
    build: (m, step) => ({
      step,
      customBody: `await expect(page.locator("[data-testid='routing-number'], .routing").first()).toContainText(${JSON.stringify(m[1])});`,
    }),
  },

  // BANK:17 — `I deposit "$X" into "savings"`
  {
    pattern: new RegExp(
      `^(?:${SUBJ}\\s+)?deposit(?:s)? ${MONEY} (?:in)?to ["']([^"']+)["']$`,
      "i",
    ),
    build: (m, step) => ({
      step,
      customBody: [
        `await page.getByLabel(/destination account/i).selectOption({ label: ${JSON.stringify(m[2])} });`,
        `await page.getByLabel(/deposit amount/i).fill(${JSON.stringify(m[1])});`,
        `await page.getByRole("button", { name: /deposit|submit/i }).click();`,
      ].join("\n"),
    }),
  },

  // BANK:18 — `I withdraw "$X" from "checking"`
  {
    pattern: new RegExp(
      `^(?:${SUBJ}\\s+)?withdraw(?:s)? ${MONEY} from ["']([^"']+)["']$`,
      "i",
    ),
    build: (m, step) => ({
      step,
      customBody: [
        `await page.getByLabel(/source account/i).selectOption({ label: ${JSON.stringify(m[2])} });`,
        `await page.getByLabel(/withdraw(?:al)? amount/i).fill(${JSON.stringify(m[1])});`,
        `await page.getByRole("button", { name: /withdraw|submit/i }).click();`,
      ].join("\n"),
    }),
  },

  // BANK:19 — `the available credit is "$X"`
  {
    pattern: new RegExp(`^(?:the )?available credit is ${MONEY}$`, "i"),
    build: (m, step) => ({
      step,
      customBody: `await expect(page.locator("[data-testid='available-credit']").first()).toContainText(${JSON.stringify(m[1])});`,
    }),
  },

  // BANK:20 — `the wire transfer is "completed"` / "pending" / "rejected"
  {
    pattern: /^(?:the )?wire(?: transfer)? is ["']([^"']+)["']$/i,
    build: (m, step) => ({
      step,
      customBody: `await expect(page.locator("[data-testid='wire-status']").first()).toContainText(${JSON.stringify(m[1])});`,
    }),
  },
];
