/**
 * esbuild bundle for the VS Code extension.
 *
 * VS Code extensions need to be a single CommonJS file that can be loaded
 * by the host. We bundle everything except `vscode` itself (the host
 * provides it) and a handful of optional native deps that bdd2pw lists
 * but doesn't strictly need at runtime when used as a library.
 */

const esbuild = require("esbuild");

const production = process.argv.includes("--production");
const watch = process.argv.includes("--watch");

/** @type {import('esbuild').BuildOptions} */
const opts = {
  entryPoints: ["src/extension.ts"],
  bundle: true,
  format: "cjs",
  minify: production,
  sourcemap: !production,
  sourcesContent: false,
  platform: "node",
  outfile: "dist/extension.js",
  // `vscode` is provided by the extension host at runtime.
  // Native modules bdd2pw treats as optional — exclude them so the
  // bundler doesn't try to inline binary bindings.
  external: [
    "vscode",
    "better-sqlite3",
    "pino-pretty",
    "@playwright/mcp",
    "playwright",
    "@playwright/test",
  ],
  logLevel: "info",
};

async function main() {
  if (watch) {
    const ctx = await esbuild.context(opts);
    await ctx.watch();
    console.log("[esbuild] watching…");
  } else {
    await esbuild.build(opts);
    console.log("[esbuild] build complete");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
