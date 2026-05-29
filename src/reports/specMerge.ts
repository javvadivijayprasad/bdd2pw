/**
 * v3.2.0 — TestForge handoff Issue 7. Preserve user-edited blocks
 * across regeneration.
 *
 * Two artefacts make this work:
 *
 *   1. **A generated-header marker.** Every spec emitted with `merge`
 *      enabled gets a leading
 *      `// bdd2pw:generated v=<version> source=<feature>` comment, so a
 *      future run can recognise its own output.
 *
 *   2. **User-block markers.** Anywhere in the spec, the user can wrap
 *      hand-edited code in:
 *
 *          // bdd2pw:user-block id="custom-locator"
 *          await this.special = page.locator("[data-thing]");
 *          // bdd2pw:end-user-block
 *
 *      During regeneration, blocks with the same `id` are spliced back
 *      into the new output. Blocks whose id is absent from the new
 *      output are appended at end of file under a clearly-labelled
 *      "stale user blocks" section so nothing is lost silently.
 *
 * The merge is conservative — it never touches the LINES INSIDE
 * user blocks; everything else is fresh output.
 *
 * Why id-keyed splicing instead of line-based diff? Line numbers
 * shift every time the input feature changes. Id-keyed markers
 * survive arbitrary reordering and renaming.
 */

/** Match a user-block open marker plus capture its id and body. */
const USER_BLOCK_RE =
  /\/\/\s*bdd2pw:user-block\s+id\s*=\s*"([^"]+)"[ \t]*\r?\n([\s\S]*?)\/\/\s*bdd2pw:end-user-block/g;

/** Header comment we emit at the top of merge-enabled specs. */
function generatedHeader(version: string, source: string): string {
  return `// bdd2pw:generated v=${version} source=${source}`;
}

/** Detect whether a previously-emitted spec was produced with merge on. */
export function isMergeAnnotated(existing: string): boolean {
  return /^\/\/\s*bdd2pw:generated\s/.test(existing.trimStart());
}

/** Extract every user-block in `existing`, keyed by id. */
export function extractUserBlocks(existing: string): Map<string, string> {
  const out = new Map<string, string>();
  const re = new RegExp(USER_BLOCK_RE.source, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(existing)) !== null) {
    const id = m[1];
    const body = m[2];
    // Stash the WHOLE block including markers so the splice keeps
    // them in the output. (If we only captured `body`, a subsequent
    // regen would lose the markers and the next regen wouldn't see
    // the block.)
    const full = m[0];
    out.set(id, full);
  }
  return out;
}

/**
 * Splice preserved user blocks into a freshly-rendered spec.
 *
 *   - `next` is the new bdd2pw output (no user blocks yet).
 *   - `preserved` is the id → block-text map extracted from the
 *     PREVIOUS spec via `extractUserBlocks`.
 *
 * For each preserved block: if `next` contains a placeholder line
 * `// bdd2pw:user-block id="<id>"` ... `// bdd2pw:end-user-block`
 * (which bdd2pw never emits by itself — see note below), replace it.
 * Otherwise append the block under a "stale user blocks" footer so
 * the user can salvage / delete it on their own.
 *
 * Note: bdd2pw doesn't insert empty user-block placeholders by
 * default — users opt in by editing a generated spec and adding the
 * markers themselves. So in practice the splice path here is
 * usually the "append at end" branch, which is intentional — once
 * a user edits a spec under merge, the markers they added live
 * forever inside the spec until they remove them.
 */
export function mergeUserBlocks(
  next: string,
  preserved: Map<string, string>,
): string {
  if (preserved.size === 0) return next;

  // For each preserved id, replace any matching open/close marker in
  // `next`, otherwise queue for append.
  let merged = next;
  const stale: { id: string; block: string }[] = [];
  for (const [id, block] of preserved.entries()) {
    const placeholder = new RegExp(
      `\\/\\/\\s*bdd2pw:user-block\\s+id\\s*=\\s*"${escapeForRegex(id)}"[ \\t]*\\r?\\n[\\s\\S]*?\\/\\/\\s*bdd2pw:end-user-block`,
      "g",
    );
    if (placeholder.test(merged)) {
      merged = merged.replace(placeholder, block);
    } else {
      stale.push({ id, block });
    }
  }

  if (stale.length === 0) return merged;
  const footer = [
    "",
    "// ── bdd2pw:stale-user-blocks ──────────────────────────────",
    "// The following user-block sections existed in the previous",
    "// generated spec but no matching id was found in the freshly-",
    "// generated output. They're preserved here so you don't lose",
    "// them. Move them inline (or delete them) and the next merge",
    "// will pick up the change.",
    ...stale.map((s) => s.block),
    "// ── bdd2pw:end-stale-user-blocks ──────────────────────────",
    "",
  ].join("\n");
  return merged + footer;
}

/**
 * Prepend the generated header to a fresh spec so future merges can
 * detect that the file is bdd2pw-managed.
 */
export function prependGeneratedHeader(
  contents: string,
  version: string,
  source: string,
): string {
  const header = generatedHeader(version, source);
  // Idempotent: if the contents already start with our header, don't
  // duplicate it.
  if (isMergeAnnotated(contents)) return contents;
  return `${header}\n${contents}`;
}

function escapeForRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
