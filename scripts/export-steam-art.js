// Export self-contained SVG sources and exact-size PNG capsules using the lockfile’s Chromium.
// No fonts, remote imagery, or runtime assets are required by the exported artwork.
const fs = require("fs");
const path = require("path");
const { chromium } = require("@playwright/test");

const root = path.resolve(__dirname, "..");
const output = path.join(root, "assets", "steam");
const readImage = (name) =>
  fs.readFileSync(path.join(root, "public", "images", name), "utf8");
const body = (svg) =>
  svg.slice(svg.indexOf(">") + 1, svg.lastIndexOf("</svg>"));

// logo-home’s final path is the outlined “Take charge of the power market” tagline. Preserve
// every wordmark letter and its integrated wire/plant details; omit only that final path.
const homeLogo = readImage("logo-home.svg");
const logoPaths = homeLogo.match(/<path\b[^>]*\/>/g);
if (!logoPaths || logoPaths.length !== 15) {
  throw new Error(
    "Home logo changed: inspect the title-only path selection before exporting.",
  );
}
const titleLogo = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 70" fill="none"><title>Electrify</title>${logoPaths.slice(0, -1).join("\n")}</svg>\n`;
const scene = readImage("power-system.svg");
const piece = (name, translation) => {
  const group = scene.match(new RegExp(`<g id="${name}"[\\s\\S]*?</g>`));
  if (!group) throw new Error(`Missing scenic artwork group: ${name}`);
  return `<g transform="translate(${translation})">${group[0]}</g>`;
};
// Recompose the same silhouettes for portrait; avoid slicing a turbine or building at an edge.
const portraitScene = `<svg viewBox="0 0 748 560" fill="none"><path d="M254 238Q290 296 322 340M482 340Q530 384 560 396" stroke="#455a64" stroke-width="10" stroke-linecap="round"/>${piece("wind", "84 28")}${piece("solar", "-246 216")}${piece("tower", "-228 216")}${piece("homes", "-316 216")}<path d="M24 526H724" stroke="#b0bec5" stroke-width="10" stroke-linecap="round"/></svg>`;

const CAPSULES = [
  {
    name: "header",
    width: 920,
    height: 430,
    logo: [120, 36, 680, 159],
    world: [40, 176, 840, 252],
  },
  {
    name: "small",
    width: 462,
    height: 174,
    logo: [46, 20, 370, 87],
    world: [96, 96, 270, 81],
  },
  {
    name: "main",
    width: 1232,
    height: 706,
    logo: [116, 100, 1000, 234],
    world: [56, 354, 1120, 336],
  },
  {
    name: "vertical",
    width: 748,
    height: 896,
    logo: [64, 112, 620, 145],
    world: [0, 316, 748, 560],
  },
];

const place = (source, viewBox, bounds) => {
  const [x, y, width, height] = bounds;
  return `<svg x="${x}" y="${y}" width="${width}" height="${height}" viewBox="${viewBox}" fill="none">${body(source)}</svg>`;
};

async function main() {
  fs.mkdirSync(output, { recursive: true });
  fs.writeFileSync(path.join(output, "title-logo.svg"), titleLogo);
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ deviceScaleFactor: 1 });
    for (const capsule of CAPSULES) {
      const { name, width, height, logo, world } = capsule;
      const portrait = name === "vertical";
      const ground = portrait ? 842 : world[1] + (world[3] * 310) / 360;
      const source = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><title>Electrify ${name} capsule</title><rect width="${width}" height="${height}" fill="#fff"/><rect y="${ground}" width="${width}" height="${height - ground}" fill="#eceff1"/>${place(titleLogo, "0 0 300 70", logo)}${place(portrait ? portraitScene : scene, portrait ? "0 0 748 560" : "0 0 1200 360", world)}</svg>\n`;
      fs.writeFileSync(path.join(output, `${name}.svg`), source);
      await page.setViewportSize({ width, height });
      await page.setContent(
        `<style>body{margin:0}svg{display:block}</style>${source}`,
      );
      await page.screenshot({ path: path.join(output, `${name}.png`) });
    }
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
