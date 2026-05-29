/**
 * v3.8.0 — Government / civic services domain rule pack.
 *
 * Opt-in via `ScaffoldOptions.domains: ["gov"]`. Covers common
 * citizen-facing dialects: forms, eligibility, case management,
 * benefit amounts, identity verification, FOIA, residency,
 * agency assignment, intake, accessibility.
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

const SUBJ =
  "(?:I|user|User|the user|the User|the applicant|the citizen|the caseworker)";
const MONEY = `\\$?["']?\\$?([\\d,]+(?:\\.\\d{1,2})?)["']?`;

export const GOV_RULES: Rule[] = [
  // GOV:01 — `I submit form "DS-11"` / `I submit the "Application X" form`
  {
    pattern: new RegExp(
      `^(?:${SUBJ}\\s+)?submit(?:s)? (?:the )?(?:form ["']([^"']+)["']|["']([^"']+)["'] form)$`,
      "i",
    ),
    build: (m, step) => {
      const formName = m[1] ?? m[2];
      return {
        step,
        customBody: [
          `// Submit the named form; use the form's accessible name as the click target.`,
          `await page.getByRole("button", { name: new RegExp(\`submit.*${formName.replace(/[\\W]/g, ".?")}\`, "i") }).first().click();`,
        ].join("\n"),
      };
    },
  },

  // GOV:02 — `the form ID is "..."`
  {
    pattern: /^(?:the )?form(?: ID| number)? is ["']?([A-Z0-9-]+)["']?$/i,
    build: (m, step) => ({
      step,
      customBody: `await expect(page.locator("[data-testid='form-id'], [aria-label='Form ID']").first()).toContainText(${JSON.stringify(m[1])});`,
    }),
  },

  // GOV:03 — `the applicant is "eligible"` / `"ineligible"` / `"pending review"`
  {
    pattern:
      /^(?:the )?(?:applicant|claimant|household) is ["']([^"']+)["']$/i,
    build: (m, step) => ({
      step,
      customBody: `await expect(page.locator("[data-testid='eligibility-status']").first()).toContainText(${JSON.stringify(m[1])});`,
    }),
  },

  // GOV:04 — `the case number is "..."` / `the case ID is "..."`
  {
    pattern: /^(?:the )?case(?: number| ID)? is ["']?([A-Z0-9-]+)["']?$/i,
    build: (m, step) => ({
      step,
      customBody: `await expect(page.locator("[data-testid='case-number'], [data-testid='case-id']").first()).toContainText(${JSON.stringify(m[1])});`,
    }),
  },

  // GOV:05 — `the case status is "open"` / `"closed"` / `"under review"`
  {
    pattern: /^(?:the )?case status is ["']([^"']+)["']$/i,
    build: (m, step) => ({
      step,
      customBody: `await expect(page.locator("[data-testid='case-status']").first()).toContainText(${JSON.stringify(m[1])});`,
    }),
  },

  // GOV:06 — `the benefit amount is "$X"` / `the monthly benefit is "$X"`
  {
    pattern: new RegExp(
      `^(?:the )?(?:monthly |annual )?benefit(?: amount)? is ${MONEY}$`,
      "i",
    ),
    build: (m, step) => ({
      step,
      customBody: `await expect(page.locator("[data-testid='benefit-amount']").first()).toContainText(${JSON.stringify(m[1])});`,
    }),
  },

  // GOV:07 — `the document type is "passport"` / `"driver's license"` / `"birth certificate"`
  {
    pattern:
      /^(?:the )?(?:document|ID) type is ["']([^"']+)["']$/i,
    build: (m, step) => ({
      step,
      customBody: `await expect(page.locator("[data-testid='document-type'], [data-testid='id-type']").first()).toContainText(${JSON.stringify(m[1])});`,
    }),
  },

  // GOV:08 — `I upload "passport.pdf"` (file upload)
  {
    pattern: new RegExp(
      `^(?:${SUBJ}\\s+)?upload(?:s)? ["']([^"']+)["']$`,
      "i",
    ),
    build: (m, step) => ({
      step,
      customBody: [
        `await page.setInputFiles(`,
        `  "[data-testid='file-input'], input[type='file']",`,
        `  ${JSON.stringify(m[1])},`,
        `);`,
      ].join("\n"),
    }),
  },

  // GOV:09 — `the FOIA request status is "..."`
  {
    pattern: /^(?:the )?FOIA(?: request)? status is ["']([^"']+)["']$/i,
    build: (m, step) => ({
      step,
      customBody: `await expect(page.locator("[data-testid='foia-status']").first()).toContainText(${JSON.stringify(m[1])});`,
    }),
  },

  // GOV:10 — `the response is "redacted"` / `"released"` / `"denied"`
  {
    pattern:
      /^(?:the )?(?:FOIA )?response is ["']([^"']+)["']$/i,
    build: (m, step) => ({
      step,
      customBody: `await expect(page.locator("[data-testid='foia-response']").first()).toContainText(${JSON.stringify(m[1])});`,
    }),
  },

  // GOV:11 — `the residency status is "permanent resident"` / `"citizen"` / `"visa holder"`
  {
    pattern: /^(?:the )?residency status is ["']([^"']+)["']$/i,
    build: (m, step) => ({
      step,
      customBody: `await expect(page.locator("[data-testid='residency-status']").first()).toContainText(${JSON.stringify(m[1])});`,
    }),
  },

  // GOV:12 — `the agency is "..."` / `the assigned agency is "..."`
  {
    pattern:
      /^(?:the )?(?:assigned )?agency is ["']([^"']+)["']$/i,
    build: (m, step) => ({
      step,
      customBody: `await expect(page.locator("[data-testid='agency-name']").first()).toContainText(${JSON.stringify(m[1])});`,
    }),
  },

  // GOV:13 — `the program is "SNAP"` / `"Medicaid"` / `"unemployment"`
  {
    pattern:
      /^(?:the )?(?:benefit )?program is ["']([^"']+)["']$/i,
    build: (m, step) => ({
      step,
      customBody: `await expect(page.locator("[data-testid='program-name']").first()).toContainText(${JSON.stringify(m[1])});`,
    }),
  },

  // GOV:14 — `the intake date is "2026-01-15"`
  {
    pattern:
      /^(?:the )?(?:intake|filing|application) date is ["']?(\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/\d{2,4})["']?$/i,
    build: (m, step) => ({
      step,
      customBody: `await expect(page.locator("[data-testid='intake-date']").first()).toContainText(${JSON.stringify(m[1])});`,
    }),
  },

  // GOV:15 — `the application is "approved"` / `"denied"` / `"pending"` / `"appealed"`
  {
    pattern:
      /^(?:the )?application is ["']([^"']+)["']$/i,
    build: (m, step) => ({
      step,
      customBody: `await expect(page.locator("[data-testid='application-status']").first()).toContainText(${JSON.stringify(m[1])});`,
    }),
  },

  // GOV:16 — `the page meets WCAG "AA"` / `"AAA"`
  {
    pattern:
      /^(?:the )?(?:page|form|site) meets WCAG ["']?(A|AA|AAA)["']?(?:\s+compliance)?$/i,
    build: (m, step) => ({
      step,
      customBody: [
        `// Accessibility marker — checks the conformance level reported`,
        `// by the audit panel or aria-live attestation. Real WCAG audits`,
        `// happen offline; this just confirms the UI advertises the claim.`,
        `await expect(page.locator("[data-testid='wcag-conformance'], [aria-label='WCAG conformance']").first()).toContainText(${JSON.stringify(m[1])});`,
      ].join("\n"),
    }),
  },

  // GOV:17 — `the appeal is "filed"` / `"denied"` / `"granted"`
  {
    pattern: /^(?:the )?appeal is ["']([^"']+)["']$/i,
    build: (m, step) => ({
      step,
      customBody: `await expect(page.locator("[data-testid='appeal-status']").first()).toContainText(${JSON.stringify(m[1])});`,
    }),
  },

  // GOV:18 — `the deadline is "2026-09-30"`
  {
    pattern:
      /^(?:the )?deadline is ["']?(\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/\d{2,4})["']?$/i,
    build: (m, step) => ({
      step,
      customBody: `await expect(page.locator("[data-testid='deadline']").first()).toContainText(${JSON.stringify(m[1])});`,
    }),
  },

  // GOV:19 — `I schedule an appointment for "2026-06-10"`
  {
    pattern: new RegExp(
      `^(?:${SUBJ}\\s+)?schedule(?:s)? (?:an? )?appointment (?:for|on) ["']?(\\d{4}-\\d{2}-\\d{2})["']?$`,
      "i",
    ),
    build: (m, step) => ({
      step,
      customBody: [
        `await page.getByRole("button", { name: /schedule.*appointment/i }).click();`,
        `await page.getByLabel(/appointment date/i).fill(${JSON.stringify(m[1])});`,
        `await page.getByRole("button", { name: /confirm|submit/i }).click();`,
      ].join("\n"),
    }),
  },

  // GOV:20 — `the audit log records a "view-case" event`
  {
    pattern:
      /^(?:the )?audit log records (?:a |an )?["']([^"']+)["'] event(?: for the case)?$/i,
    build: (m, step) => ({
      step,
      customBody: `await expect(page.locator("[data-testid='audit-log']")).toContainText(${JSON.stringify(m[1])});`,
    }),
  },
];
