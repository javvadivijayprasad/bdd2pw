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

export interface InferredPath {
  /** The dotted POMWright path, e.g. "main.form@login.input@username". */
  path: string;
  /** Segments in order, root-first. Convenient for callers that want to
   *  register parent segments too. */
  segments: string[];
  /** True when the DOM didn't give us enough to chain reliably; the
   *  caller should emit a review marker. */
  reviewNeeded: boolean;
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
  const leafNoun = ROLE_NOUN[el.tag] ?? el.role ?? "element";
  const leafName =
    camelCase(choice.fieldName)
      // Strip any role suffix the classic picker appended (`usernameInput` → `username`).
      .replace(
        /(Input|Button|Link|Select|Checkbox|Radio|Heading|Alert|Image|Textarea)$/,
        "",
      ) || camelCase(choice.fieldName);

  const leafSegment = `${leafNoun}@${leafName}`;

  // Walk xpath first (most reliable), fall back to CSS selector.
  const ancestorSegments = extractAncestors(el.xpath, el.cssSelector);

  if (ancestorSegments.length === 0) {
    return {
      path: leafSegment,
      segments: [leafSegment],
      reviewNeeded: true,
    };
  }

  const segments = [...ancestorSegments, leafSegment];
  return {
    path: segments.join("."),
    segments,
    reviewNeeded: false,
  };
}

/**
 * Walk an xpath (preferred) or CSS selector and return stable-ancestor
 * segments, root-first. Each segment is `<tag>@<name>` when a name is
 * available, or `<tag>` for landmarks (`main`, `header`, `nav`,
 * `footer`, `aside`) which are unique enough on their own.
 */
function extractAncestors(xpath: string | undefined, css: string | undefined): string[] {
  const segments: string[] = [];

  if (xpath) {
    // xpath like `/html/body/main/form[@id="login"]/input[@name="username"]`
    // or `//*[@id="login"]/form/input`. Parse step-by-step.
    const steps = xpath.split("/").filter(Boolean);
    for (const step of steps) {
      // Step shapes:
      //   main
      //   form[@id="login"]
      //   section[@aria-label="Checkout"]
      //   div[2]                  — positional, not stable → skip
      //   *[@id="login"]          — any-tag with id
      //   dialog[@aria-labelledby="h"]
      const m = step.match(
        /^(?<tag>[a-zA-Z][a-zA-Z0-9-]*|\*)(?:\[@(?<attr>id|name|aria-label|aria-labelledby)="(?<val>[^"]+)"\])?(?:\[\d+\])?$/,
      );
      if (!m || !m.groups) continue;
      const tag = m.groups.tag.toLowerCase();
      const attrVal = m.groups.val;

      // Landmarks: stable on their own.
      if (["main", "nav", "header", "footer", "aside"].includes(tag)) {
        segments.push(tag);
        continue;
      }
      // Other container tags: require a name attribute to be stable.
      if (STABLE_CONTAINER_TAGS.has(tag) && attrVal) {
        segments.push(`${tag}@${camelCase(attrVal)}`);
        continue;
      }
      // `*[@id="..."]` — unknown tag, named by id → treat as a generic
      // section segment; keep because id is stable.
      if (tag === "*" && attrVal) {
        segments.push(`section@${camelCase(attrVal)}`);
        continue;
      }
      // Any other step (positional divs, unnamed containers, leaves) is
      // dropped — unstable or redundant.
    }
    if (segments.length > 0) return segments;
  }

  // CSS selector fallback — far weaker, but catches `main form#login input[name=username]`
  // style selectors. Only parse the DESCENDANT chain (spaces), ignore
  // combinators like `>` and `+` for the PoC.
  if (css) {
    const parts = css.split(/\s+/).filter(Boolean);
    for (const part of parts) {
      // part like `main` or `form#login` or `#checkout` or `section[aria-label="X"]`
      const tagMatch = part.match(/^([a-zA-Z][a-zA-Z0-9-]*)/);
      const idMatch = part.match(/#([a-zA-Z_][\w-]*)/);
      const ariaLabelMatch = part.match(/\[aria-label=["']([^"']+)["']\]/);
      const tag = (tagMatch ? tagMatch[1] : "").toLowerCase();
      const name = idMatch?.[1] ?? ariaLabelMatch?.[1];

      if (["main", "nav", "header", "footer", "aside"].includes(tag)) {
        segments.push(tag);
      } else if (STABLE_CONTAINER_TAGS.has(tag) && name) {
        segments.push(`${tag}@${camelCase(name)}`);
      } else if (!tag && name) {
        // Bare `#login` → section-like anchor.
        segments.push(`section@${camelCase(name)}`);
      }
      // Leaves inside the chain are handled by the caller's leaf segment.
    }
  }

  return segments;
}
