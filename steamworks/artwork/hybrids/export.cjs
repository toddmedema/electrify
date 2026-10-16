const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { pathToFileURL } = require("node:url");
const { chromium } = require("@playwright/test");

const folder = __dirname;
const sourceDir = path.join(folder, "sources");
const originalLogo = fs.readFileSync(
  path.join(folder, "../sources/wordmark.svg"),
  "utf8",
);
const logo = originalLogo.replace(/^<svg[^>]*>/, "").replace(/<\/svg>\s*$/, "");
const variants = [
  {
    id: "01-connected-landscape",
    title: "1 · Connected landscape",
    description:
      "A prominent blue pylon, bold grid connections, and a compact landscape of power sources.",
  },
  {
    id: "02-powering-the-town",
    title: "2 · Powering the town",
    description:
      "The community is the focal point, with smaller infrastructure and broad ivory land shapes.",
  },
  {
    id: "03-grid-in-silhouette",
    title: "3 · Grid in silhouette",
    description:
      "The strongest match to C: dark silhouettes, a broad ivory ribbon, and the simplest geometry.",
  },
];

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  const manifest = [];
  try {
    for (const variant of variants) {
      const data = fs.readFileSync(path.join(sourceDir, `${variant.id}.png`));
      const width = data.readUInt32BE(16);
      const height = data.readUInt32BE(20);
      const logoWidth = Math.round(width * 0.55);
      const logoX = Math.round(width * 0.058);
      const logoY = Math.round(height * 0.12);
      const source = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><title>${variant.title}</title><image width="${width}" height="${height}" href="${variant.id}.png"/><svg x="${logoX}" y="${logoY}" width="${logoWidth}" height="${(logoWidth * 70) / 300}" viewBox="0 0 300 70" fill="none">${logo}</svg></svg>`;
      fs.writeFileSync(
        path.join(sourceDir, `${variant.id}.svg`),
        `${source}\n`,
      );
      const inline = source.replace(
        `href="${variant.id}.png"`,
        `href="data:image/png;base64,${data.toString("base64")}"`,
      );
      await page.setViewportSize({ width, height });
      await page.setContent(
        `<html><body style="margin:0">${inline}</body></html>`,
      );
      await page.evaluate(async () => {
        const image = new Image();
        image.src = document.querySelector("image").getAttribute("href");
        await image.decode();
      });
      const output = await page.screenshot({
        path: path.join(folder, `${variant.id}.png`),
      });
      if (
        output.readUInt32BE(16) !== width ||
        output.readUInt32BE(20) !== height
      )
        throw new Error("Incorrect concept dimensions");
      manifest.push({
        ...variant,
        file: `${variant.id}.png`,
        width,
        height,
        sha256: crypto.createHash("sha256").update(output).digest("hex"),
      });
    }
    fs.writeFileSync(
      path.join(folder, "manifest.json"),
      `${JSON.stringify(manifest, null, 2)}\n`,
    );
    const html = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Electrify · A × C hybrids</title><style>*{box-sizing:border-box}body{margin:0;padding:24px;background:#e9eef5;color:#14243a;font:16px system-ui}h1{font-size:28px;margin:0 0 8px}header p{margin:0 0 24px;max-width:900px}main{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:24px}figure{margin:0}img{display:block;width:100%;height:auto;background:#102031}h2{font-size:18px;margin:12px 0 8px}figure p{line-height:1.45;margin:0 0 12px}a{color:#075ab4}footer{margin-top:24px;line-height:1.5}@media(max-width:950px){main{grid-template-columns:1fr}}</style><header><h1>Electrify · A × C hybrids</h1><p>Option A’s town, transmission grid, hydro, wind, solar, and power station in option C’s simplified bold style. All three use the original Electrify wordmark at the same size.</p></header><main>${variants.map((variant) => `<figure><a href="${variant.id}.png"><img src="${variant.id}.png" alt="${variant.title}"></a><figcaption><h2>${variant.title}</h2><p>${variant.description}</p><a href="${variant.id}.png">Full-size concept</a> · <a href="sources/${variant.id}.svg">Editable layout</a></figcaption></figure>`).join("")}</main><footer>These concepts preserve the complete illustration so the chosen direction can be framed for the Steam upload formats.<br><a href="../review.html">Original artwork set</a> · <a href="generation.json">ImageGen prompts</a></footer></html>`;
    fs.writeFileSync(path.join(folder, "review.html"), html);
    await page.setViewportSize({ width: 1480, height: 570 });
    await page.goto(pathToFileURL(path.join(folder, "review.html")).href);
    await page.evaluate(async () => {
      await Promise.all(
        Array.from(document.images).map((image) => image.decode()),
      );
    });
    await page.screenshot({
      path: path.join(
        folder,
        "../../../.tmp/steam-hybrids/pr-hybrid-options.png",
      ),
    });
    console.log(
      `Exported and verified ${manifest.length} branded hybrid concepts.`,
    );
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
