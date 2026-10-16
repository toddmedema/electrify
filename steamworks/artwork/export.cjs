const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("@playwright/test");

const root = __dirname;
const sources = path.join(root, "sources");
const uploads = path.join(root, "uploads");
const svg = (w, h, body) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${body}</svg>`;
const logo = fs
  .readFileSync(path.join(sources, "wordmark.svg"), "utf8")
  .replace(/^<svg[^>]*>/, "")
  .replace(/<\/svg>\s*$/, "");
const mark = (x, y, w) =>
  `<svg x="${x}" y="${y}" width="${w}" height="${(w * 70) / 300}" viewBox="0 0 300 70" fill="none">${logo}</svg>`;
const scene = (file, w, h, align = "xMidYMid", frame) => {
  const data = fs.readFileSync(path.join(sources, file));
  const image = `data:image/png;base64,${data.toString("base64")}`;
  if (!frame)
    return `<image href="${image}" width="${w}" height="${h}" preserveAspectRatio="${align} slice"/>`;
  return `<svg width="${w}" height="${h}" viewBox="${frame.join(" ")}" preserveAspectRatio="${align} slice"><image href="${image}" width="${data.readUInt32BE(16)}" height="${data.readUInt32BE(20)}"/></svg>`;
};

// The store and library header slots use the same store-header.png file.
const layouts = [
  {
    file: "store-header.png",
    width: 920,
    height: 430,
    art: "connected-wide.png",
    title: [45, 48, 510],
  },
  {
    file: "store-small.png",
    width: 462,
    height: 174,
    art: "connected-small.png",
    title: [18, 44, 326],
  },
  {
    file: "store-main.png",
    width: 1232,
    height: 706,
    art: "connected-wide.png",
    align: "xMaxYMid",
    title: [72, 100, 680],
  },
  {
    file: "store-vertical.png",
    width: 748,
    height: 896,
    art: "connected-store-portrait.png",
    title: [48, 42, 652],
  },
  {
    file: "library-capsule.png",
    width: 600,
    height: 900,
    art: "connected-portrait.png",
    title: [40, 66, 520],
  },
  {
    file: "library-hero.png",
    width: 3840,
    height: 1240,
    art: "connected-hero.png",
    frame: [0, 12, 2171, 700],
  },
  {
    file: "library-logo.png",
    width: 1280,
    height: 299,
    transparent: true,
    title: [0, 0, 1280],
  },
];

function pngSize(data) {
  assert.equal(
    data.subarray(0, 8).toString("hex"),
    "89504e470d0a1a0a",
    "Expected PNG bytes; fetch Git LFS assets first",
  );
  return [data.readUInt32BE(16), data.readUInt32BE(20)];
}

async function render(page, source, width, height, transparent = false) {
  await page.setViewportSize({ width, height });
  await page.setContent(
    `<html><body style="margin:0;background:${transparent ? "transparent" : "#0c2032"}">${source}</body></html>`,
  );
  await page.evaluate(async () => {
    await Promise.all(
      Array.from(document.querySelectorAll("svg image")).map(
        async (element) => {
          const image = new Image();
          image.src = element.getAttribute("href");
          await image.decode();
        },
      ),
    );
  });
  const data = await page.screenshot({
    omitBackground: transparent,
    animations: "disabled",
  });
  assert.deepEqual(pngSize(data), [width, height]);
  return data;
}

function icns(images) {
  const chunks = images.map(({ type, data }) => {
    const header = Buffer.alloc(8);
    header.write(type);
    header.writeUInt32BE(data.length + 8, 4);
    return Buffer.concat([header, data]);
  });
  const header = Buffer.alloc(8);
  header.write("icns");
  header.writeUInt32BE(
    chunks.reduce((sum, chunk) => sum + chunk.length, 8),
    4,
  );
  return Buffer.concat([header, ...chunks]);
}

async function main() {
  fs.mkdirSync(uploads, { recursive: true });
  const write = (file, data) =>
    fs.writeFileSync(path.join(uploads, file), data);
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  try {
    for (const {
      file,
      width,
      height,
      art,
      title,
      transparent,
      align,
      frame,
    } of layouts) {
      const body =
        (art ? scene(art, width, height, align, frame) : "") +
        (title ? mark(...title) : "");
      write(
        file,
        await render(
          page,
          svg(width, height, body),
          width,
          height,
          transparent,
        ),
      );
    }
    const icon = fs
      .readFileSync(path.join(root, "../../public/images/icon/1024x1024.png"))
      .toString("base64");
    const iconSource = (size) =>
      `<image width="${size}" height="${size}" href="data:image/png;base64,${icon}"/>`;
    const icons = new Map();
    for (const size of [16, 32, 64, 128, 256, 512, 1024]) {
      icons.set(
        size,
        await render(page, svg(size, size, iconSource(size)), size, size, true),
      );
    }
    write("shortcut-icon.png", icons.get(512));
    write(
      "mac-icon.icns",
      icns(
        [
          ["icp4", 16],
          ["icp5", 32],
          ["icp6", 64],
          ["ic07", 128],
          ["ic08", 256],
          ["ic09", 512],
          ["ic10", 1024],
        ].map(([type, size]) => ({ type, data: icons.get(size) })),
      ),
    );
    await render(
      page,
      svg(
        184,
        184,
        `<rect width="184" height="184" fill="#102133"/>${iconSource(184)}`,
      ),
      184,
      184,
    );
    write("app-icon.jpg", await page.screenshot({ type: "jpeg", quality: 95 }));
    assert.deepEqual(
      fs.readdirSync(uploads).sort(),
      [
        ...layouts.map(({ file }) => file),
        "shortcut-icon.png",
        "mac-icon.icns",
        "app-icon.jpg",
      ].sort(),
      "Unexpected or missing upload files",
    );
    const screenshots = fs
      .readdirSync(path.join(root, "screenshots"))
      .filter((file) => file.endsWith(".png"));
    assert.ok(
      screenshots.length >= 5,
      "Steam requires at least five gameplay screenshots",
    );
    for (const file of screenshots)
      assert.deepEqual(
        pngSize(fs.readFileSync(path.join(root, "screenshots", file))),
        [1920, 1080],
        file,
      );
    console.log(
      `Exported ${layouts.length + 3} Steam artwork files; verified dimensions and ${screenshots.length} gameplay screenshots.`,
    );
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
