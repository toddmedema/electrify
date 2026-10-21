const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("@playwright/test");
const catalog = require("../../src/achievements/AchievementCatalog.json");

const root = path.resolve(__dirname, "../..");
const digest = (data) => crypto.createHash("sha256").update(data).digest("hex");
const filename = (id, achieved) =>
  `${id}_${achieved ? "ACHIEVED" : "UNACHIEVED"}.png`;

function uploadMap(entries = catalog, sourceRoot = root) {
  const ids = new Set();
  return entries.map(({ id, name, description, icon }) => {
    assert.match(
      id,
      /^[A-Z][A-Z0-9_]+$/,
      "Steam achievement API name must be a safe stable filename",
    );
    assert(!ids.has(id), `Duplicate achievement API name: ${id}`);
    ids.add(id);
    const source = `public/images/${icon}.svg`;
    const svg = fs.readFileSync(path.join(sourceRoot, source));
    assert(
      svg.toString("utf8").includes("<svg"),
      `Fetch Git LFS source before exporting ${source}`,
    );
    return {
      apiName: id,
      name,
      description,
      source,
      sourceSha256: digest(svg),
      achieved: `uploads/${filename(id, true)}`,
      unachieved: `uploads/${filename(id, false)}`,
    };
  });
}

function verifyExports(
  directory = __dirname,
  entries = catalog,
  sourceRoot = root,
) {
  const expected = uploadMap(entries, sourceRoot);
  const actual = JSON.parse(
    fs.readFileSync(path.join(directory, "upload-map.json"), "utf8"),
  );
  assert.deepEqual(
    actual,
    expected,
    "Achievement upload map is stale; rerun the exporter",
  );
  const expectedFiles = expected
    .flatMap((entry) => [entry.achieved, entry.unachieved])
    .sort();
  const actualFiles = fs
    .readdirSync(path.join(directory, "uploads"))
    .map((name) => `uploads/${name}`)
    .sort();
  assert.deepEqual(
    actualFiles,
    expectedFiles,
    "Every catalog achievement needs exactly two upload files",
  );
  for (const name of expectedFiles) {
    const png = fs.readFileSync(path.join(directory, name));
    assert.equal(
      png.subarray(0, 8).toString("hex"),
      "89504e470d0a1a0a",
      `Invalid PNG: ${name}`,
    );
    assert.equal(png.readUInt32BE(16), 256, `Expected 256px width: ${name}`);
    assert.equal(png.readUInt32BE(20), 256, `Expected 256px height: ${name}`);
  }
  return expectedFiles.length;
}

async function exportArtwork() {
  const entries = uploadMap();
  const uploads = path.join(__dirname, "uploads");
  fs.mkdirSync(uploads, { recursive: true });
  // Only remove old exporter-owned icon files, never arbitrary user files.
  for (const name of fs.readdirSync(uploads))
    if (/^[A-Z][A-Z0-9_]+_(?:ACHIEVED|UNACHIEVED)\.png$/.test(name))
      fs.rmSync(path.join(uploads, name));
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({
      viewport: { width: 1280, height: 900 },
      deviceScaleFactor: 1,
    });
    for (const entry of entries) {
      const source = fs
        .readFileSync(path.join(root, entry.source))
        .toString("base64");
      for (const achieved of [true, false]) {
        const png = await page.evaluate(
          async ({ source, achieved }) => {
            const image = new Image();
            image.src = `data:image/svg+xml;base64,${source}`;
            await image.decode();
            const canvas = document.createElement("canvas");
            canvas.width = canvas.height = 256;
            const context = canvas.getContext("2d");
            context.fillStyle = "#eaf1f7";
            context.fillRect(0, 0, 256, 256);
            context.drawImage(image, 8, 8, 240, 240);
            if (!achieved) {
              const pixels = context.getImageData(0, 0, 256, 256);
              for (let i = 0; i < pixels.data.length; i += 4) {
                const gray = Math.round(
                  pixels.data[i] * 0.2126 +
                    pixels.data[i + 1] * 0.7152 +
                    pixels.data[i + 2] * 0.0722,
                );
                pixels.data[i] = pixels.data[i + 1] = pixels.data[i + 2] = gray;
              }
              context.putImageData(pixels, 0, 0);
            }
            return canvas.toDataURL("image/png").split(",")[1];
          },
          { source, achieved },
        );
        fs.writeFileSync(
          path.join(uploads, filename(entry.apiName, achieved)),
          Buffer.from(png, "base64"),
        );
      }
    }
    fs.writeFileSync(
      path.join(__dirname, "upload-map.json"),
      JSON.stringify(entries, null, 2) + "\n",
    );
    const escape = (value) =>
      value
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll('"', "&quot;");
    const inline = (name) =>
      `data:image/png;base64,${fs.readFileSync(path.join(__dirname, name)).toString("base64")}`;
    const cards = entries
      .map(
        (entry) =>
          `<article><h2>${escape(entry.name)}</h2><code>${entry.apiName}</code><div class="full"><img src="${inline(entry.achieved)}" alt="Achieved"><img src="${inline(entry.unachieved)}" alt="Unachieved"></div><div class="small"><span><img src="${inline(entry.achieved)}"><img src="${inline(entry.unachieved)}"></span><span class="dark"><img src="${inline(entry.achieved)}"><img src="${inline(entry.unachieved)}"></span></div></article>`,
      )
      .join("");
    const html = `<!doctype html><html lang="en"><meta charset="utf-8"><title>Electrify Steam achievement review</title><style>body{margin:16px;background:#edf1f5;color:#17212b;font:14px Arial}main{display:grid;grid-template-columns:repeat(2,544px);gap:16px}article{background:white;padding:12px}h2{margin:0 0 4px;font-size:18px}code{display:block;font-size:11px;margin-bottom:12px}.full{display:flex;gap:8px}.full img{width:256px;height:256px}.small{display:flex;margin-top:8px;gap:8px}.small span{padding:8px;background:#fff;display:flex;gap:8px}.small .dark{background:#0d141a}.small img{width:48px;height:48px}</style><h1>Steam achievements — achieved / unachieved</h1><p>256px uploads above, 48px previews on light and dark surfaces below.</p><main>${cards}</main></html>`;
    const preview = path.join(root, ".tmp", "achievement-review");
    fs.mkdirSync(preview, { recursive: true });
    fs.writeFileSync(path.join(preview, "index.html"), html);
    await page.setContent(html);
    await page.locator("img").evaluateAll(async (images) => {
      await Promise.all(images.map((image) => image.decode()));
    });
    // Decode the actual upload PNGs, rather than trusting only their headers.
    await page.locator(".full img").evaluateAll((images) => {
      for (const image of images) {
        if (image.naturalWidth !== 256 || image.naturalHeight !== 256)
          throw new Error("Invalid decoded upload dimensions");
        const canvas = document.createElement("canvas");
        canvas.width = canvas.height = 256;
        const context = canvas.getContext("2d");
        context.drawImage(image, 0, 0);
        const pixels = context.getImageData(0, 0, 256, 256).data;
        let hasDark = false;
        for (let i = 0; i < pixels.length; i += 4) {
          if (pixels[i + 3] !== 255)
            throw new Error(
              "Upload background must remain opaque on Steam dark surfaces",
            );
          if (pixels[i] < 50 && pixels[i + 1] < 50 && pixels[i + 2] < 50)
            hasDark = true;
          if (
            image.alt === "Unachieved" &&
            (pixels[i] !== pixels[i + 1] || pixels[i] !== pixels[i + 2])
          )
            throw new Error("Unachieved icon is not grayscale");
        }
        if (!hasDark) throw new Error("Blank or missing icon artwork");
      }
    });
    await page.screenshot({
      path: path.join(preview, "full.png"),
      fullPage: true,
    });
    await page.addStyleTag({
      content:
        "main{grid-template-columns:repeat(5,224px)}article{padding:8px}.full{display:none}h2{font-size:14px}code{font-size:8px}.small span{padding:4px}.small img{width:40px;height:40px}.small{gap:4px}",
    });
    await page.screenshot({
      path: path.join(preview, "small.png"),
      fullPage: true,
    });
    console.error(
      `Exported and decoded ${verifyExports()} achievement PNGs; review .tmp/achievement-review at 256px and 40–48px.`,
    );
  } finally {
    await browser.close();
  }
}

if (require.main === module) {
  if (process.argv.includes("--check"))
    console.error(`Verified ${verifyExports()} achievement PNGs.`);
  else
    exportArtwork().catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
}
module.exports = { uploadMap, verifyExports };
