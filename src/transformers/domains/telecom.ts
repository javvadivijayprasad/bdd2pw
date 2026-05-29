/**
 * v3.8.0 — Telecom / mobile-carrier domain rule pack.
 *
 * Opt-in via `ScaffoldOptions.domains: ["telecom"]`. Covers
 * subscriber accounts, plan tiers, MSISDN, port-in, data/voice/SMS
 * usage, billing, service status, signal strength, device IMEI,
 * call/SMS counts.
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
  "(?:I|user|User|the user|the User|the subscriber|the customer|the agent)";
const MONEY = `\\$?["']?\\$?([\\d,]+(?:\\.\\d{1,2})?)["']?`;

export const TELECOM_RULES: Rule[] = [
  // TEL:01 — `the subscriber is "active"` / `"suspended"` / `"cancelled"` / `"churned"`
  {
    pattern:
      /^(?:the )?subscriber is ["']?(active|suspended|cancell?ed|churned|pending|disconnected)["']?$/i,
    build: (m, step) => ({
      step,
      customBody: `await expect(page.locator("[data-testid='subscriber-status']").first()).toContainText(${JSON.stringify(m[1])});`,
    }),
  },

  // TEL:02 — `the plan tier is "Premium"` / `"Basic"` / `"Pro"`
  {
    pattern: /^(?:the )?plan(?: tier)? is ["']([^"']+)["']$/i,
    build: (m, step) => ({
      step,
      customBody: `await expect(page.locator("[data-testid='plan-tier']").first()).toContainText(${JSON.stringify(m[1])});`,
    }),
  },

  // TEL:03 — `the monthly price is "$50"` / `the monthly bill is "$N"`
  {
    pattern: new RegExp(
      `^(?:the )?(?:monthly )?(?:price|bill|rate) is ${MONEY}$`,
      "i",
    ),
    build: (m, step) => ({
      step,
      customBody: `await expect(page.locator("[data-testid='monthly-price'], [data-testid='monthly-bill']").first()).toContainText(${JSON.stringify(m[1])});`,
    }),
  },

  // TEL:04 — `the MSISDN is "..."` / `the phone number is "..."`
  {
    pattern:
      /^(?:the )?(?:MSISDN|phone number|mobile number) is ["']?(\+?[\d -]{7,20})["']?$/i,
    build: (m, step) => ({
      step,
      customBody: `await expect(page.locator("[data-testid='msisdn'], [data-testid='phone-number']").first()).toContainText(${JSON.stringify(m[1])});`,
    }),
  },

  // TEL:05 — `the port-in is "in progress"` / `"complete"` / `"failed"`
  {
    pattern:
      /^(?:the )?(?:port-in|port out|number port) (?:status )?is ["']([^"']+)["']$/i,
    build: (m, step) => ({
      step,
      customBody: `await expect(page.locator("[data-testid='port-status']").first()).toContainText(${JSON.stringify(m[1])});`,
    }),
  },

  // TEL:06 — `the data usage is "5 GB"` / `"500 MB"`
  {
    pattern: /^(?:the )?data usage is ["']?(\d+(?:\.\d+)?\s*(?:GB|MB|TB))["']?$/i,
    build: (m, step) => ({
      step,
      customBody: `await expect(page.locator("[data-testid='data-usage']").first()).toContainText(${JSON.stringify(m[1])});`,
    }),
  },

  // TEL:07 — `the data allowance is "10 GB"`
  {
    pattern:
      /^(?:the )?data (?:allowance|cap|limit) is ["']?(\d+(?:\.\d+)?\s*(?:GB|MB|TB)|unlimited)["']?$/i,
    build: (m, step) => ({
      step,
      customBody: `await expect(page.locator("[data-testid='data-allowance']").first()).toContainText(${JSON.stringify(m[1])});`,
    }),
  },

  // TEL:08 — `the voice usage is "120 min"` / `"2 hours"`
  {
    pattern:
      /^(?:the )?voice usage is ["']?(\d+(?:\.\d+)?\s*(?:min|hours?|m|h))["']?$/i,
    build: (m, step) => ({
      step,
      customBody: `await expect(page.locator("[data-testid='voice-usage']").first()).toContainText(${JSON.stringify(m[1])});`,
    }),
  },

  // TEL:09 — `the SMS count is N` / `the messages count is N`
  {
    pattern:
      /^(?:the )?(?:SMS|message|text) count is (\d+)$/i,
    build: (m, step) => ({
      step,
      customBody: [
        `const _smsCount = await page.locator("[data-testid='sms-count']").first().innerText();`,
        `expect(Number(_smsCount.replace(/\\D/g, ""))).toBe(${m[1]});`,
      ].join("\n"),
    }),
  },

  // TEL:10 — `the bill is "$75.50"` / `the outstanding balance is "$X"`
  {
    pattern: new RegExp(
      `^(?:the )?(?:bill|outstanding balance|amount due) is ${MONEY}$`,
      "i",
    ),
    build: (m, step) => ({
      step,
      customBody: `await expect(page.locator("[data-testid='bill-amount'], [data-testid='balance-due']").first()).toContainText(${JSON.stringify(m[1])});`,
    }),
  },

  // TEL:11 — `the service is "active"` / `"suspended"`
  {
    pattern:
      /^(?:the )?service is ["']?(active|suspended|disconnected|pending|barred)["']?$/i,
    build: (m, step) => ({
      step,
      customBody: `await expect(page.locator("[data-testid='service-status']").first()).toContainText(${JSON.stringify(m[1])});`,
    }),
  },

  // TEL:12 — `the signal is "strong"` / `"weak"` / `"no signal"`
  {
    pattern:
      /^(?:the )?signal(?: strength)? is ["']?(strong|weak|moderate|poor|no signal|full bars)["']?$/i,
    build: (m, step) => ({
      step,
      customBody: `await expect(page.locator("[data-testid='signal-strength']").first()).toContainText(${JSON.stringify(m[1])});`,
    }),
  },

  // TEL:13 — `the device IMEI is "..."`
  {
    pattern: /^(?:the )?device IMEI is ["']?(\d{15})["']?$/i,
    build: (m, step) => ({
      step,
      customBody: `await expect(page.locator("[data-testid='imei'], [data-testid='device-imei']").first()).toContainText(${JSON.stringify(m[1])});`,
    }),
  },

  // TEL:14 — `the SIM ICCID is "..."`
  {
    pattern: /^(?:the )?(?:SIM )?ICCID is ["']?(\d{18,20})["']?$/i,
    build: (m, step) => ({
      step,
      customBody: `await expect(page.locator("[data-testid='iccid']").first()).toContainText(${JSON.stringify(m[1])});`,
    }),
  },

  // TEL:15 — `the call duration is N minutes`
  {
    pattern: /^(?:the )?call duration is (\d+(?:\.\d+)?)(?: minutes?| min| m)?$/i,
    build: (m, step) => ({
      step,
      customBody: [
        `const _duration = await page.locator("[data-testid='call-duration']").first().innerText();`,
        `expect(Number(_duration.replace(/[^\\d.]/g, ""))).toBe(${m[1]});`,
      ].join("\n"),
    }),
  },

  // TEL:16 — `I activate the SIM` / `I activate device`
  {
    pattern: new RegExp(
      `^(?:${SUBJ}\\s+)?activate(?:s)? (?:the )?(SIM|device|line)$`,
      "i",
    ),
    build: (_m, step) => ({
      step,
      customBody: [
        `await page.getByRole("button", { name: /activate/i }).first().click();`,
        `await page.getByRole("button", { name: /confirm/i }).click();`,
      ].join("\n"),
    }),
  },

  // TEL:17 — `I suspend the service` / `I cancel the service`
  {
    pattern: new RegExp(
      `^(?:${SUBJ}\\s+)?(suspend|cancel|reactivate|resume)(?:s)? (?:the )?(?:service|account|line)$`,
      "i",
    ),
    build: (m, step) => {
      const action = m[1].toLowerCase();
      return {
        step,
        customBody: [
          `await page.getByRole("button", { name: new RegExp(${JSON.stringify(action)}, "i") }).first().click();`,
          `await page.getByRole("button", { name: /confirm/i }).click();`,
        ].join("\n"),
      };
    },
  },

  // TEL:18 — `the roaming is "enabled"` / `"disabled"`
  {
    pattern:
      /^(?:the )?(?:international )?roaming is ["']?(enabled|disabled|active|inactive|on|off)["']?$/i,
    build: (m, step) => ({
      step,
      customBody: `await expect(page.locator("[data-testid='roaming-status']").first()).toContainText(${JSON.stringify(m[1])});`,
    }),
  },

  // TEL:19 — `the account number is "..."`
  {
    pattern: /^(?:the )?account(?: number)? is ["']?([A-Z0-9-]+)["']?$/i,
    build: (m, step) => ({
      step,
      customBody: `await expect(page.locator("[data-testid='account-number']").first()).toContainText(${JSON.stringify(m[1])});`,
    }),
  },

  // TEL:20 — `I add line "555-1234" to the plan`
  {
    pattern: new RegExp(
      `^(?:${SUBJ}\\s+)?add(?:s)? line ["']([^"']+)["'] to (?:the |my )?plan$`,
      "i",
    ),
    build: (m, step) => ({
      step,
      customBody: [
        `await page.getByRole("button", { name: /add line/i }).click();`,
        `await page.getByLabel(/phone|MSISDN|number/i).fill(${JSON.stringify(m[1])});`,
        `await page.getByRole("button", { name: /confirm|save/i }).click();`,
      ].join("\n"),
    }),
  },
];
