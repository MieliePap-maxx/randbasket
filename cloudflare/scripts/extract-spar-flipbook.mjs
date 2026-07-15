import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const modulesRoot = process.env.SPAR_OCR_MODULES || process.cwd();
const require = createRequire(join(modulesRoot, "package.json"));
const { createCanvas } = require("@napi-rs/canvas");
const { createWorker, PSM } = require("tesseract.js");
const pdfjs = await import(pathToFileURL(require.resolve("pdfjs-dist/legacy/build/pdf.mjs")).href);

const [pdfPath, outputDir, scaleArg = "2"] = process.argv.slice(2);
if (!pdfPath || !outputDir) {
  throw new Error("Usage: node extract-spar-flipbook.mjs <flipbook.pdf> <output-dir> [scale]");
}

const scale = Math.min(3, Math.max(1, Number.parseFloat(scaleArg) || 2));
const data = new Uint8Array(await readFile(pdfPath));
const document = await pdfjs.getDocument({ data, disableWorker: true }).promise;
const worker = await createWorker("eng", 1, { cachePath: modulesRoot });
await worker.setParameters({
  tessedit_pageseg_mode: PSM.SPARSE_TEXT,
  preserve_interword_spaces: "1",
});
await mkdir(outputDir, { recursive: true });

const pages = [];
try {
  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    const page = await document.getPage(pageNumber);
    const viewport = page.getViewport({ scale });
    const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
    const context = canvas.getContext("2d");
    await page.render({ canvasContext: context, viewport }).promise;

    const image = canvas.toBuffer("image/png");
    const imageName = `page-${String(pageNumber).padStart(2, "0")}.png`;
    await writeFile(join(outputDir, imageName), image);

    const embedded = await page.getTextContent();
    const embeddedText = embedded.items.map((item) => item.str || "").join(" ").replace(/\s+/g, " ").trim();
    const result = await worker.recognize(image, {}, { text: true, tsv: true });
    pages.push({
      page: pageNumber,
      image: imageName,
      embeddedText,
      ocrText: result.data.text.replace(/\r/g, "").trim(),
      ocrTsv: result.data.tsv,
      ocrConfidence: result.data.confidence,
    });
    console.log(`Processed page ${pageNumber}/${document.numPages}`);
  }
} finally {
  await worker.terminate();
}

const result = {
  source: basename(pdfPath),
  extractedAt: new Date().toISOString(),
  scale,
  pageCount: pages.length,
  pages,
};
await writeFile(join(outputDir, "extracted.json"), JSON.stringify(result, null, 2), "utf8");
await writeFile(join(outputDir, "extracted.txt"), pages.map((page) => [
  `=== PAGE ${page.page} ===`,
  page.ocrText,
  "",
  "--- EMBEDDED TEXT ---",
  page.embeddedText,
].join("\n")).join("\n\n"), "utf8");
console.log(`Extracted ${pages.length} pages from ${basename(pdfPath)}.`);
