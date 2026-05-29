/**
 * v3.4.0 — Healthcare domain rule pack.
 *
 * Opt-in via `ScaffoldOptions.domains: ["healthcare"]`. Covers common
 * EHR / clinical / regulatory dialects: patient records, appointments,
 * ICD-10 diagnosis codes, medications, HIPAA consent forms, HL7
 * message types, FHIR resource references, vital signs, allergies,
 * provider NPIs.
 *
 * Patterns are intentionally specific (require recognisable formats
 * like `ICD-10:E11.9` or `120/80 mmHg`) so they don't false-positive
 * UI-shaped steps.
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

const SUBJ = "(?:I|user|User|the user|the User|the provider)";

export const HEALTHCARE_RULES: Rule[] = [
  // HEALTH:01 — `the patient's name is "John Doe"`
  {
    pattern: /^(?:the )?patient'?s? name is ["']([^"']+)["']$/i,
    build: (m, step) => ({
      step,
      customBody: `await expect(page.locator("[data-testid='patient-name'], [aria-label='Patient name']").first()).toContainText(${JSON.stringify(m[1])});`,
    }),
  },

  // HEALTH:02 — `the patient ID is "MRN12345"`
  {
    pattern: /^(?:the )?patient(?: ID| MRN|'?s? medical record number) is ["']([^"']+)["']$/i,
    build: (m, step) => ({
      step,
      customBody: `await expect(page.locator("[data-testid='patient-mrn'], [data-testid='patient-id']").first()).toContainText(${JSON.stringify(m[1])});`,
    }),
  },

  // HEALTH:03 — `the appointment is scheduled for "2026-06-01"`
  {
    pattern:
      /^(?:the )?appointment is scheduled (?:for|on) ["']?(\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/\d{2,4})["']?$/i,
    build: (m, step) => ({
      step,
      customBody: `await expect(page.locator("[data-testid='appointment-date'], .appt-date").first()).toContainText(${JSON.stringify(m[1])});`,
    }),
  },

  // HEALTH:04 — `I schedule an appointment for "2026-06-01"`
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

  // HEALTH:05 — `the diagnosis code is "ICD-10:E11.9"`
  {
    pattern: /^(?:the )?diagnosis(?: code)? is ["']?(ICD-10[: ]?[A-Z]\d{2}(?:\.\d{1,3})?)["']?$/i,
    build: (m, step) => ({
      step,
      customBody: `await expect(page.locator("[data-testid='diagnosis-code'], .icd-10").first()).toContainText(${JSON.stringify(m[1])});`,
    }),
  },

  // HEALTH:06 — `the medication "Metformin" is prescribed`
  {
    pattern:
      /^(?:the )?medication ["']([^"']+)["'] is (?:prescribed|ordered|administered)$/i,
    build: (m, step) => ({
      step,
      customBody: `await expect(page.locator("[data-testid='medication-list'], .medications").first()).toContainText(${JSON.stringify(m[1])});`,
    }),
  },

  // HEALTH:07 — `I prescribe "Metformin 500mg" for the patient`
  {
    pattern: new RegExp(
      `^(?:${SUBJ}\\s+)?prescribe(?:s)? ["']([^"']+)["'](?: for (?:the )?patient)?$`,
      "i",
    ),
    build: (m, step) => ({
      step,
      customBody: [
        `await page.getByRole("button", { name: /add (?:medication|prescription)/i }).click();`,
        `await page.getByLabel(/medication name/i).fill(${JSON.stringify(m[1])});`,
        `await page.getByRole("button", { name: /prescribe|save/i }).click();`,
      ].join("\n"),
    }),
  },

  // HEALTH:08 — `the patient has signed consent form "HIPAA-1"`
  {
    pattern:
      /^(?:the )?patient has (not )?signed (?:consent )?form ["']([^"']+)["']$/i,
    build: (m, step) => {
      const matcher = m[1] ? "not.toBeVisible" : "toBeVisible";
      return {
        step,
        customBody: `await expect(page.locator(\`[data-testid='consent-${m[2].replace(/[^\\w-]/g, "")}'], [data-form='${m[2]}'][data-signed='true']\`).first()).${matcher}();`,
      };
    },
  },

  // HEALTH:09 — `the HL7 message type is "ADT^A01"`
  {
    pattern: /^(?:the )?HL7 message type is ["']?([A-Z]{3}\^[A-Z]\d{2})["']?$/i,
    build: (m, step) => ({
      step,
      customBody: `await expect(page.locator("[data-testid='hl7-msh-9']").first()).toContainText(${JSON.stringify(m[1])});`,
    }),
  },

  // HEALTH:10 — `the FHIR resource is "Patient/123"`
  {
    pattern:
      /^(?:the )?FHIR resource is ["']?([A-Z][a-zA-Z]+\/[\w-]+)["']?$/i,
    build: (m, step) => ({
      step,
      customBody: [
        `// FHIR resource ref — exposed by the EHR's data attribute.`,
        `await expect(page.locator(\`[data-fhir-ref='${m[1]}']\`)).toBeVisible();`,
      ].join("\n"),
    }),
  },

  // HEALTH:11 — `the patient's data is encrypted`
  {
    pattern:
      /^(?:the )?patient'?s? (?:data|record|chart) is (not )?encrypted$/i,
    build: (m, step) => {
      const matcher = m[1] ? "not.toBeVisible" : "toBeVisible";
      return {
        step,
        customBody: `await expect(page.locator("[data-testid='encryption-status'], [aria-label='HIPAA-compliant']").first()).${matcher}();`,
      };
    },
  },

  // HEALTH:12 — `the blood pressure reading is "120/80"`
  {
    pattern:
      /^(?:the )?blood pressure(?: reading)? is ["']?(\d{2,3}\/\d{2,3})["']?(?: mmHg)?$/i,
    build: (m, step) => ({
      step,
      customBody: `await expect(page.locator("[data-testid='vital-bp'], [aria-label*='blood pressure' i]").first()).toContainText(${JSON.stringify(m[1])});`,
    }),
  },

  // HEALTH:13 — `the heart rate is (N) bpm`
  {
    pattern: /^(?:the )?heart rate is (\d{2,3})(?:\s*bpm)?$/i,
    build: (m, step) => ({
      step,
      customBody: [
        `const _hr = await page.locator("[data-testid='vital-hr']").first().innerText();`,
        `expect(Number(_hr.replace(/\\D/g, ""))).toBe(${m[1]});`,
      ].join("\n"),
    }),
  },

  // HEALTH:14 — `the patient is allergic to "penicillin"`
  {
    pattern:
      /^(?:the )?patient is (not )?allergic to ["']([^"']+)["']$/i,
    build: (m, step) => {
      const matcher = m[1] ? "not.toContainText" : "toContainText";
      return {
        step,
        customBody: `await expect(page.locator("[data-testid='allergy-list'], .allergies").first()).${matcher}(${JSON.stringify(m[2])});`,
      };
    },
  },

  // HEALTH:15 — `the provider NPI is "1234567890"`
  {
    pattern: /^(?:the )?provider NPI is ["']?(\d{10})["']?$/i,
    build: (m, step) => ({
      step,
      customBody: `await expect(page.locator("[data-testid='provider-npi'], .npi").first()).toContainText(${JSON.stringify(m[1])});`,
    }),
  },

  // HEALTH:16 — `the provider DEA number is "AB1234567"`
  {
    pattern:
      /^(?:the )?provider DEA(?: number)? is ["']?([A-Z]{2}\d{7})["']?$/i,
    build: (m, step) => ({
      step,
      customBody: `await expect(page.locator("[data-testid='provider-dea']").first()).toContainText(${JSON.stringify(m[1])});`,
    }),
  },

  // HEALTH:17 — `the lab result for "HbA1c" is "5.8"`
  {
    pattern:
      /^(?:the )?lab result for ["']([^"']+)["'] is ["']?([\d.]+)["']?(?: ([\w/%]+))?$/i,
    build: (m, step) => ({
      step,
      customBody: [
        `const _labRow = page.locator("[data-testid='lab-row']").filter({ hasText: ${JSON.stringify(m[1])} }).first();`,
        `await expect(_labRow).toContainText(${JSON.stringify(m[2])});`,
      ].join("\n"),
    }),
  },

  // HEALTH:18 — `I admit the patient to "ICU"`
  {
    pattern: new RegExp(
      `^(?:${SUBJ}\\s+)?admit(?:s)? (?:the )?patient to ["']([^"']+)["']$`,
      "i",
    ),
    build: (m, step) => ({
      step,
      customBody: [
        `await page.getByRole("button", { name: /admit/i }).click();`,
        `await page.getByLabel(/unit|ward|location/i).selectOption({ label: ${JSON.stringify(m[1])} });`,
        `await page.getByRole("button", { name: /confirm|admit/i }).click();`,
      ].join("\n"),
    }),
  },

  // HEALTH:19 — `I discharge the patient`
  {
    pattern: new RegExp(`^(?:${SUBJ}\\s+)?discharge(?:s)? (?:the )?patient$`, "i"),
    build: (_m, step) => ({
      step,
      customBody: [
        `await page.getByRole("button", { name: /discharge/i }).click();`,
        `await page.getByRole("button", { name: /confirm/i }).click();`,
      ].join("\n"),
    }),
  },

  // HEALTH:20 — `the audit log contains a "view chart" entry for the patient`
  {
    pattern:
      /^(?:the )?audit log contains (?:a |an )?["']([^"']+)["'] entry(?: for the patient)?$/i,
    build: (m, step) => ({
      step,
      customBody: [
        `await page.getByRole("link", { name: /audit log/i }).click();`,
        `await expect(page.locator("[data-testid='audit-row']")).toContainText(${JSON.stringify(m[1])});`,
      ].join("\n"),
    }),
  },
];
