/// <reference lib="dom" />
/**
 * Page discovery client.
 *
 * Two implementations behind one entrypoint:
 *   1. **Real browser** (Phase 1b, this file). Launches Chromium via
 *      `playwright`, navigates to the URL, walks the DOM, returns a flat
 *      `ElementIR[]`-shaped accessibility list.
 *   2. **File snapshot** (Phase 1a fallback). Reads a pre-captured JSON
 *      snapshot when `opts.snapshotFile` is set. Useful for offline / CI /
 *      no-network tests, and for scenarios where you've captured a known-good
 *      page state and don't want to re-scan every run.
 *
 * The orchestrator picks based on whether `snapshotFile` is set. Both
 * implementations return the same `PageSnapshot` shape so `parseSnapshot`
 * downstream is unaware of the choice.
 *
 * **AQ-2 resolved:** uses `playwright` directly, not `@playwright/mcp`.
 * MCP is an LLM-control protocol; we just need a one-shot programmatic
 * browser. Direct Playwright is one fewer process, one fewer protocol
 * layer, no JSON-RPC overhead. The MCP framing only made sense if we were
 * letting an LLM drive the browser interactively — we're not.
 *
 * **Optional dependency.** `playwright` is in `optionalDependencies`. The
 * scanner imports it dynamically and surfaces a clear install hint in
 * `McpError` if it's missing.
 */

import * as fs from "fs-extra";

export class McpError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "McpError";
  }
}

export interface ScanPageOptions {
  url: string;
  /** Pre-authenticated storage state JSON path (Playwright format). */
  storageState?: string;
  /** Show the browser window. Default: headless. */
  headed?: boolean;
  /**
   * If set, read snapshot from this JSON file instead of launching a
   * browser. Used by tests, CI without network, and pinned-fixture runs.
   */
  snapshotFile?: string;
  /** ms to wait for `networkidle` after navigation. Default: 5000. */
  waitForNetworkIdleMs?: number;
}

export interface PageSnapshot {
  url: string;
  title: string;
  /** Flat list of element descriptors (snapshotParser handles flat-array shape). */
  accessibilityTree: unknown;
  /** Raw outer HTML of <body>, length-capped — used by some downstream heuristics. */
  domSnapshot: string;
}

export async function scanPage(opts: ScanPageOptions): Promise<PageSnapshot> {
  if (opts.snapshotFile) {
    return scanPageFromFile(opts.snapshotFile);
  }
  return scanPageWithBrowser(opts);
}

// ─── File-snapshot fallback ────────────────────────────────────────────────

async function scanPageFromFile(snapshotFile: string): Promise<PageSnapshot> {
  if (!(await fs.pathExists(snapshotFile))) {
    throw new McpError(`Snapshot file not found: ${snapshotFile}`);
  }
  let parsed: any;
  try {
    parsed = await fs.readJSON(snapshotFile);
  } catch (err) {
    throw new McpError(`Could not parse snapshot JSON: ${snapshotFile}`, err);
  }
  return {
    url: parsed.url ?? "",
    title: parsed.title ?? "",
    accessibilityTree: parsed.accessibilityTree ?? parsed.elements ?? [],
    domSnapshot: parsed.domSnapshot ?? "",
  };
}

// ─── Real browser scanner (Phase 1b) ───────────────────────────────────────

async function scanPageWithBrowser(opts: ScanPageOptions): Promise<PageSnapshot> {
  // Dynamic import — `playwright` is an optional dependency. If the user
  // hasn't installed it, surface an actionable error rather than a stack trace.
  let chromium: any;
  try {
    ({ chromium } = await import("playwright"));
  } catch (err) {
    throw new McpError(
      "Page discovery requires `playwright`. Install it in your project " +
        "(`npm install -D playwright`) and run `npx playwright install chromium`. " +
        "Alternatively, pre-capture a snapshot.json and pass --snapshot-file.",
      err,
    );
  }

  let browser: any;
  try {
    browser = await chromium.launch({ headless: !opts.headed });
  } catch (err) {
    throw new McpError(
      "Could not launch chromium. Did you run `npx playwright install chromium`?",
      err,
    );
  }

  try {
    const ctx = await browser.newContext(
      opts.storageState ? { storageState: opts.storageState } : {},
    );
    const page = await ctx.newPage();

    try {
      await page.goto(opts.url, {
        waitUntil: "networkidle",
        timeout: opts.waitForNetworkIdleMs ?? 5000,
      });
    } catch (err) {
      // Network-idle is best-effort; some SPAs never reach it. Fall back to
      // domcontentloaded — the page DOM is at least populated.
      try {
        await page.goto(opts.url, { waitUntil: "domcontentloaded", timeout: 10_000 });
      } catch (innerErr) {
        throw new McpError(
          `Could not navigate to ${opts.url}: ${(innerErr as Error).message}`,
          innerErr,
        );
      }
    }

    const title = await page.title().catch(() => "");

    // Walk the DOM and extract every "interesting" element with a stable
    // descriptor. The selector list covers anything a Gherkin step would
    // plausibly target. Each descriptor maps 1:1 onto `ElementIR`, so
    // `snapshotParser` (already in place) handles it without changes.
    //
    // The status/notification id+class patterns at the bottom catch elements
    // like `<div id="error">` and `<div class="alert-warning">` that don't
    // have an explicit ARIA role but are clearly named after their purpose.
    // Without these, "Then I should see an error message" can't find a POM
    // field and falls back to `page.getByText(...)` which often matches twice
    // (real error + instructional copy on the page).
    const elements: unknown = await page.evaluate(() => {
      const SELECTORS = [
        "input",
        "textarea",
        "select",
        "button",
        "a",
        "[role]",
        "[data-testid]",
        "[aria-label]",
        "h1",
        "h2",
        "h3",
        "h4",
        "h5",
        "h6",
        "label",
        "[type=submit]",
        // Status / notification regions — catch by id or class hint
        "[id*=error i]",
        "[id*=alert i]",
        "[id*=message i]",
        "[id*=warning i]",
        "[id*=success i]",
        "[id*=notification i]",
        "[class*=error i]",
        "[class*=alert i]",
        "[class*=notification i]",
        "[class*=banner i]",
      ].join(",");

      function getLabelFor(el: Element): string | undefined {
        const id = el.getAttribute("id");
        if (id) {
          const lab = document.querySelector(`label[for="${CSS.escape(id)}"]`);
          if (lab && lab.textContent) return lab.textContent.trim();
        }
        const wrapping = el.closest("label");
        if (wrapping && wrapping.textContent) return wrapping.textContent.trim();
        return undefined;
      }

      function bestCss(el: Element): string | undefined {
        const id = el.getAttribute("id");
        if (id) return "#" + id;
        const cls =
          typeof (el as HTMLElement).className === "string"
            ? (el as HTMLElement).className.trim().split(/\s+/)[0]
            : undefined;
        if (cls) return "." + cls;
        return undefined;
      }

      /**
       * Implicit ARIA role for native HTML elements. Without this, picker
       * falls through `getByRole` (which requires a role) to `getByText` —
       * which is brittle on pages where the same text appears in multiple
       * places (button label vs instructional copy). Promoting `<button>`
       * to `role: "button"` lets the picker emit
       *   page.getByRole("button", { name: "Submit" })
       * which is what the user authoring tests by hand would write.
       */
      function implicitRole(el: Element, tag: string): string | undefined {
        const explicit = el.getAttribute("role");
        if (explicit) return explicit;
        if (tag === "button") return "button";
        if (tag === "a" && el.hasAttribute("href")) return "link";
        if (tag === "select") return "combobox";
        if (tag === "textarea") return "textbox";
        if (/^h[1-6]$/.test(tag)) return "heading";
        if (tag === "input") {
          const type = (el.getAttribute("type") || "text").toLowerCase();
          if (type === "submit" || type === "button" || type === "reset") return "button";
          if (type === "checkbox") return "checkbox";
          if (type === "radio") return "radio";
          if (type === "search") return "searchbox";
          if (type === "range") return "slider";
          if (type === "number") return "spinbutton";
          // text, email, password, tel, url, etc. → textbox
          return "textbox";
        }
        return undefined;
      }

      /**
       * Filter out elements that are visually absent (display:none, hidden,
       * or zero-sized). Decorative wrapper divs and screen-reader-only
       * spans are not what test steps target.
       *
       * EXCEPTION: status regions (error / alert / notification banners)
       * are *intended* to be hidden until triggered. Bypass the visibility
       * check when the id or class hints at a status role, otherwise the
       * `<div id="error">` element disappears from the POM and step
       * matcher falls back to a non-unique getByText.
       */
      const STATUS_HINT = /error|alert|message|warning|success|notification|status/i;
      function isLikelyStatusRegion(el: Element): boolean {
        const id = el.getAttribute("id") || "";
        const cls =
          typeof (el as HTMLElement).className === "string"
            ? (el as HTMLElement).className
            : "";
        return STATUS_HINT.test(id) || STATUS_HINT.test(cls);
      }
      function isVisible(el: Element): boolean {
        const r = (el as HTMLElement).getBoundingClientRect();
        if (r.width === 0 || r.height === 0) return false;
        const cs = window.getComputedStyle(el);
        if (cs.display === "none" || cs.visibility === "hidden" || cs.opacity === "0") {
          return false;
        }
        return true;
      }

      const seen = new Set<Element>();
      const out: any[] = [];
      const all = document.querySelectorAll(SELECTORS);
      all.forEach((el) => {
        if (seen.has(el)) return;
        seen.add(el);
        // Status regions bypass the visibility filter
        if (!isLikelyStatusRegion(el) && !isVisible(el)) return;

        const tag = el.tagName.toLowerCase();
        const role = implicitRole(el, tag);
        const ariaLabel = el.getAttribute("aria-label") || undefined;
        const placeholder = el.getAttribute("placeholder") || undefined;
        const testId = el.getAttribute("data-testid") || undefined;
        const text = (el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 200);

        // Accessible name — best-effort: aria-label > visible text (for
        // buttons/links/headings) > placeholder.
        let name: string | undefined = ariaLabel;
        if (!name && /^(button|a|h[1-6]|label)$/.test(tag) && text) name = text;
        // For native form controls promoted to role:button via type=submit
        if (!name && role === "button" && (el as HTMLInputElement).value) {
          name = (el as HTMLInputElement).value;
        }

        out.push({
          tag,
          role,
          name,
          label: getLabelFor(el),
          placeholder,
          testId,
          text: text || undefined,
          cssSelector: bestCss(el),
        });
      });
      return out;
    });

    const domSnapshot = await page
      .evaluate(() => document.body.outerHTML.slice(0, 50_000))
      .catch(() => "");

    return {
      url: opts.url,
      title,
      accessibilityTree: elements,
      domSnapshot,
    };
  } finally {
    await browser.close().catch(() => undefined);
  }
}
