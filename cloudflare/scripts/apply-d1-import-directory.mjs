import { access, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";

const [inputDirectory] = process.argv.slice(2);
if (!inputDirectory) {
  throw new Error("Usage: node apply-d1-import-directory.mjs <directory-with-manifest>");
}

const directory = resolve(inputDirectory);
const manifest = JSON.parse((await readFile(join(directory, "manifest.json"), "utf8")).replace(/^\uFEFF/, ""));
const files = (manifest.files || []).filter((file) => String(file).toLowerCase().endsWith(".sql"));
if (!files.length || !Number(manifest.products)) {
  throw new Error("The catalogue import is empty. Do not deploy until the retailer crawl succeeds.");
}
if (manifest.source === "makro-category-sitemap") {
  if (!Number(manifest.successfulCategories)) {
    throw new Error("The Makro category crawl did not complete any category pages.");
  }
} else {
  const requiredStaples = ["milk", "eggs", "bread", "beef mince", "chicken", "flour"];
  const missingStaples = requiredStaples.filter((term) => !Number(manifest.termProductCounts?.[term]));
  if (missingStaples.length) {
    throw new Error(`The Makro crawl did not cover every basic staple (${missingStaples.join(", ")}). Retry after human verification clears.`);
  }
}

const wranglerEntry = process.env.WRANGLER_ENTRY
  ? resolve(process.env.WRANGLER_ENTRY)
  : join(process.cwd(), "node_modules", "wrangler", "bin", "wrangler.js");
await access(wranglerEntry);

function applyFile(file) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(process.execPath, [
      wranglerEntry,
      "d1",
      "execute",
      "randbasket-catalogue",
      "--remote",
      `--file=${join(directory, file)}`,
    ], { stdio: "inherit" });
    child.once("error", rejectPromise);
    child.once("exit", (code) => {
      if (code === 0) resolvePromise();
      else rejectPromise(new Error(`D1 import failed for ${file} with exit code ${code}`));
    });
  });
}

console.log(`Importing ${manifest.products} products from ${files.length} Makro D1 batch files.`);
for (const file of files) await applyFile(file);
console.log("Makro D1 import completed.");
