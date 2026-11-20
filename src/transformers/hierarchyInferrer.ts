/**
 * v4.7.0 — attestqa POMWright PoC (POMWright#63). Given a `LocatorChoice`
 * (the picked locator for one element on the scanned page), infer the
 * dotted POMWright path for that element by walking its xpath / CSS
 * selector for stable ancestor containers.
 *
 * The POMWright convention from DyHex's README example:
 *   path: `main.form@login.input@username`
 *          └┬─┘ └──┬────┘ └───┬───────┘
 *           │     │           └ leaf: <noun>@<name>   (name = accessible)
 *           │     └ container: <tag>@<id-or-name>
 *           └ root: top-level landmark (main | nav | aside | header | footer)
 *
 * Containers we treat as stable ancestors (i.e. stable enough to anchor
 * a path segment without the test becoming brittle):
 *   main, nav, header, footer, aside, section (only when it has an
 *   aria-label or id), form (only when it has a name, id, or
 *   aria-label), dialog (only with aria-label/aria-labelledby).
 *
 * Elements we treat as LEAVES (named by role or test-id, not container):
 *   button, link, textbox/input, checkbox, radio, combobox, img, heading.
 *
 * When the xpath / CSS doesn't yield any stable ancestor → return a
 * FLAT path (just the leaf) plus a `reviewNeeded: true` flag so the
 * caller can emit a `// TODO: review hierarchy for <name>` comment.
 * This is the explicit design call from the POMWright maintainer:
 * "where the DOM doesn't provide enough information to reliably
 * establish a hierarchy, I'd much rather see simpler locator paths
 * or something flagged for manual review than an unnecessarily
 * complicated or brittle chain."
 */

import type { LocatorChoice } from "../types";
import { camelCase } from "../utils/naming";

/** Container tags we recognise as path-segment-worthy ancestors. */
const STABLE_CONTAINER_TAGS = new Set([
  "main",
  "nav",
  "header",
  "footer",
  "aside",
  "section",
  "form",
  "dialog",
  "fieldset",
  "table",
]);

/** Map a container tag to its POMWright "role noun" for leaf naming. */
const ROLE_NOUN: Record<string, string> = {
  button: "button",
  a: "link",
  input: "input",
  textarea: "input",
  select: "select",
  img: "image",
  label: "label",
  h1: "heading",
  h2: "heading",
  h3: "heading",
  h4: "heading",
  h5: "heading",
  h6: "heading",
  table: "table",
  form: "form",
  nav: "nav",
  dialog: "dialog",
  fieldset: "group",
  aside: "aside",
  section: "section",
  header: "header",
  footer: "footer",
  main: "main",
  td: "cell",
  th: "header",
  li: "item",
  p: "text",
  span: "text",
  div: "region",
};

/**
 * v4.7.1 — attestqa POMWright review (POMWright#73 close). Playwright's
 * `getByRole(role, { name })` requires the accessible name to come from
 * `aria-label` or the browser's computed name — `id` alone does NOT
 * satisfy it. Earlier (v4.7.0) the inferrer collapsed every ancestor
 * attribute source into the segment name, so `form[@id="login"]` got
 * emitted as `getByRole("form", { name: "Login" })` — which never
 * matches on a real page and silently kills the whole subtree.
 *
 * Fix: carry the attribute SOURCE through to the emitter so it can pick
 * the right Playwright call:
 *   - `aria-label="X"`         → `getByRole(role, { name: "X" })`       ✓ real a11y name
 *   - `id="X"` only            → `.locator("<tag>#X")`                    ✓ CSS id fallback
 *   - `aria-labelledby="Y"`    → `.locator("<tag>[aria-labelledby='Y']")` + review marker
 *                                (we don't have element#Y's text in the snapshot)
 *   - `name="X"` (form attr)   → `.locator("<tag>[name='X']")`
 *   - landmark bare (main etc) → `getByRole(landmark)` unchanged
 */
export type AncestorAttrSource = "aria-label" | "id" | "aria-labelledby" | "name";

export interface AncestorMeta {
  tag: string;
  attrSource?: AncestorAttrSource;
  attrValue?: string;
}

export interface InferredPath {
  /** The dotted POMWright path, e.g. "main.form@login.input@username". */
  path: string;
  /** Segments in order, root-first. Convenient for callers that want to
   *  register parent segments too. */
  segments: string[];
  /** True when the DOM didn't give us enough to chain reliably; the
   *  caller should emit a review marker. */
  reviewNeeded: boolean;
  /** v4.7.1 — per-ancestor-segment metadata so the emitter can pick the
   *  right Playwright call (id-only → `.locator('#id')`, aria-label →
   *  `getByRole(role, { name })`, etc.). Keyed by the full dotted path
   *  prefix of the segment (e.g. "main", "main.form@login"). Leaf segment
   *  is NOT in this map — the leaf uses the picked LocatorChoice's own api. */
  ancestorSources: Map<string, AncestorMeta>;
}

/**
 * Build the POMWright path for a single `LocatorChoice`.
 *
 * Strategy:
 *   1. Extract ancestor container segments from xpath (preferred) or
 *      CSS selector. Each stable ancestor becomes `<tag>@<name>`
 *      (name from `id`, `name`, `aria-label` — whichever exists).
 *      Ancestors without any of those are dropped (not stable).
 *   2. The leaf's own segment comes from the element's role (or tag)
 *      plus its accessible name / label / placeholder / testid /
 *      field-name.
 *   3. If no stable ancestors are found, the path is just the leaf;
 *      `reviewNeeded = true` so the emitter can warn.
 */
export function inferPomwrightPath(choice: LocatorChoice): InferredPath {
  const el = choice.source;
  // v4.7.1 audit fix — for GENERIC wrapper tags (`div`/`span`/`p`/`section`/
  // `article`) prefer the actual ARIA role (e.g. `alert` for a div with
  // role="alert") over the tag-to-noun mapping (which maps div → "region").
  // Otherwise the path says `main.region@error` but the locator uses
  // `getByRole("alert", ...)` — semantically confusing. For specific tags
  // (`input` / `button` / `a` / `img` / `h1-h6`), keep the tag mapping:
  // `input@username` reads better than `textbox@username`.
  const GENERIC_WRAPPER_TAGS = new Set(["div", "span", "p", "section", "article"]);
  const leafNoun = GENERIC_WRAPPER_TAGS.has(el.tag)
    ? (el.role ?? ROLE_NOUN[el.tag] ?? "element")
    : (ROLE_NOUN[el.tag] ?? el.role ?? "element");
  const leafName =
    camelCase(choice.fieldName)
      // Strip any role suffix the classic picker appended (`usernameInput` → `username`).
      .replace(
        /(Input|Button|Link|Select|Checkbox|Radio|Heading|Alert|Image|Textarea)$/,
        "",
      ) || camelCase(choice.fieldName);

  const leafSegment = `${leafNoun}@${leafName}`;

  // Walk xpath first (most reliable), fall back to CSS selector.
  // v4.7.1 — extractAncestors now returns each segment with its source
  // metadata so the emitter can pick the right Playwright call.
  const ancestorMetas = extractAncestors(el.xpath, el.cssSelector);

  if (ancestorMetas.length === 0) {
    return {
      path: leafSegment,
      segments: [leafSegment],
      reviewNeeded: true,
      ancestorSources: new Map(),
    };
  }

  const ancestorSegments = ancestorMetas.map((m) => m.segment);
  const segments = [...ancestorSegments, leafSegment];

  // Build the ancestorSources map keyed by the full dotted prefix of
  // each ancestor segment (e.g. "main", "main.form@login"). The leaf
  // segment is NOT in the map because its locator comes from the
  // LocatorChoice the picker chose for the element itself.
  const ancestorSources = new Map<string, AncestorMeta>();
  for (let i = 0; i < ancestorMetas.length; i++) {
    const prefix = ancestorSegments.slice(0, i + 1).join(".");
    ancestorSources.set(prefix, {
      tag: ancestorMetas[i].tag,
      attrSource: ancestorMetas[i].attrSource,
      attrValue: ancestorMetas[i].attrValue,
    });
  }

  return {
    path: segments.join("."),
    segments,
    reviewNeeded: false,
    ancestorSources,
  };
}

interface _AncestorEntry {
  segment: string;
  tag: string;
  attrSource?: AncestorAttrSource;
  attrValue?: string;
}

/**
 * v4.7.1 — walk an xpath (preferred) or CSS selector and return
 * stable-ancestor entries (root-first). Each entry carries BOTH the
 * segment name AND the attribute source that produced the name, so
 * downstream can pick the right Playwright call. Earlier (v4.7.0) only
 * the segment name was returned, which forced the emitter to assume
 * every attribute was accessible-name-worthy — wrong for `id` /
 * `aria-labelledby` / `name`.
 */
function extractAncestors(
  xpath: string | undefined,
  css: string | undefined,
): _AncestorEntry[] {
  const entries: _AncestorEntry[] = [];

  if (xpath) {
    const steps = xpath.split("/").filter(Boolean);
    for (const step of steps) {
      const m = step.match(
        /^(?<tag>[a-zA-Z][a-zA-Z0-9-]*|\*)(?:\[@(?<attr>id|name|aria-label|aria-labelledby)="(?<val>[^"]+)"\])?(?:\[\d+\])?$/,
      );
      if (!m || !m.groups) continue;
      const tag = m.groups.tag.toLowerCase();
      const attrName = m.groups.attr as AncestorAttrSource | undefined;
      const attrVal = m.groups.val;

      // Landmarks: stable on their own; emitted as bare `getByRole(role)`.
      if (["main", "nav", "header", "footer", "aside"].includes(tag)) {
        entries.push({ segment: tag, tag });
        continue;
      }
      // Other container tags: require a name attribute to be stable.
      if (STABLE_CONTAINER_TAGS.has(tag) && attrVal && attrName) {
        entries.push({
          segment: `${tag}@${camelCase(attrVal)}`,
          tag,
          attrSource: attrName,
          attrValue: attrVal,
        });
        continue;
      }
      // `*[@id="..."]` — unknown tag with an id → generic section segment.
      if (tag === "*" && attrVal && attrName) {
        entries.push({
          segment: `section@${camelCase(attrVal)}`,
          tag: "section",
          attrSource: attrName,
          attrValue: attrVal,
        });
        continue;
      }
    }
    if (entries.length > 0) return entries;
  }

  // CSS selector fallback — far weaker, but catches `main form#login input[name=username]`
  // style selectors. Only parse the DESCENDANT chain (spaces), ignore
  // combinators like `>` and `+` for the PoC.
  if (css) {
    const parts = css.split(/\s+/).filter(Boolean);
    for (const part of parts) {
      const tagMatch = part.match(/^([a-zA-Z][a-zA-Z0-9-]*)/);
      const idMatch = part.match(/#([a-zA-Z_][\w-]*)/);
      const ariaLabelMatch = part.match(/\[aria-label=["']([^"']+)["']\]/);
      const tag = (tagMatch ? tagMatch[1] : "").toLowerCase();

      if (["main", "nav", "header", "footer", "aside"].includes(tag)) {
        entries.push({ segment: tag, tag });
      } else if (STABLE_CONTAINER_TAGS.has(tag) && ariaLabelMatch) {
        entries.push({
          segment: `${tag}@${camelCase(ariaLabelMatch[1])}`,
          tag,
          attrSource: "aria-label",
          attrValue: ariaLabelMatch[1],
        });
      } else if (STABLE_CONTAINER_TAGS.has(tag) && idMatch) {
        entries.push({
          segment: `${tag}@${camelCase(idMatch[1])}`,
          tag,
          attrSource: "id",
          attrValue: idMatch[1],
        });
      } else if (!tag && idMatch) {
        entries.push({
          segment: `section@${camelCase(idMatch[1])}`,
          tag: "section",
          attrSource: "id",
          attrValue: idMatch[1],
        });
      }
    }
  }

  return entries;
}
