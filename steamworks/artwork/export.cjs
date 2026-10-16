const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { pathToFileURL } = require("node:url");
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
const scene = (file, w, h, align = "xMidYMid") =>
  `<image href="${file}" width="${w}" height="${h}" preserveAspectRatio="${align} slice"/>`;
const layouts = [
  {
    file: "store-header.png",
    width: 920,
    height: 430,
    slot: "Store / Header Capsule",
    required: true,
    art: "dispatch-landscape.png",
    title: [45, 48, 510],
  },
  {
    file: "store-small.png",
    width: 462,
    height: 174,
    slot: "Store / Small Capsule",
    required: true,
    art: "dispatch-small.png",
    title: [18, 44, 326],
  },
  {
    file: "store-main.png",
    width: 1232,
    height: 706,
    slot: "Store / Main Capsule",
    required: true,
    art: "dispatch-landscape.png",
    title: [72, 100, 680],
  },
  {
    file: "store-vertical.png",
    width: 748,
    height: 896,
    slot: "Store / Vertical Capsule",
    required: true,
    art: "dispatch-store-portrait.png",
    title: [48, 42, 652],
  },
  {
    file: "library-capsule.png",
    width: 600,
    height: 900,
    slot: "Library / Capsule",
    required: true,
    art: "dispatch-portrait.png",
    title: [40, 66, 520],
  },
  {
    file: "library-header.png",
    width: 920,
    height: 430,
    slot: "Library / Header",
    required: true,
    art: "dispatch-landscape.png",
    title: [45, 48, 510],
  },
  {
    file: "library-hero.png",
    width: 3840,
    height: 1240,
    slot: "Library / Hero",
    required: true,
    art: "dispatch-hero.png",
  },
  {
    file: "library-logo.png",
    width: 1280,
    height: 299,
    slot: "Library / Logo",
    required: true,
    transparent: true,
    title: [0, 0, 1280],
  },
  {
    file: "page-background.png",
    width: 1438,
    height: 810,
    slot: "Store / Page Background",
    required: false,
    art: "dispatch-landscape.png",
    dim: true,
  },
  {
    file: "event-cover.png",
    width: 800,
    height: 450,
    slot: "Events / Cover (when posting an event)",
    required: false,
    art: "dispatch-landscape.png",
    title: [44, 52, 442],
  },
  {
    file: "event-header.png",
    width: 1920,
    height: 622,
    slot: "Events / Header",
    required: false,
    art: "dispatch-hero.png",
    title: [86, 100, 740],
  },
];

function inlineImages(source) {
  return source.replace(
    /href="([^":]+\.png)"/g,
    (_, name) =>
      `href="data:image/png;base64,${fs.readFileSync(path.join(sources, name)).toString("base64")}"`,
  );
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
  return page.screenshot({
    omitBackground: transparent,
    animations: "disabled",
  });
}

function ico(images) {
  const header = Buffer.alloc(6 + images.length * 16);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  let offset = header.length;
  images.forEach(({ size, data }, i) => {
    const entry = 6 + i * 16;
    header[entry] = size === 256 ? 0 : size;
    header[entry + 1] = header[entry];
    header.writeUInt16LE(1, entry + 4);
    header.writeUInt16LE(32, entry + 6);
    header.writeUInt32LE(data.length, entry + 8);
    header.writeUInt32LE(offset, entry + 12);
    offset += data.length;
  });
  return Buffer.concat([header, ...images.map((image) => image.data)]);
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
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  const manifest = [];
  const record = (spec, data) => {
    fs.writeFileSync(path.join(uploads, spec.file), data);
    manifest.push({
      ...spec,
      bytes: data.length,
      sha256: crypto.createHash("sha256").update(data).digest("hex"),
    });
  };
  try {
    for (const layout of layouts) {
      const { file, width, height, art, title, dim, transparent, ...rest } =
        layout;
      const body =
        (art ? scene(art, width, height) : "") +
        (dim
          ? `<rect width="100%" height="100%" fill="#07121d" opacity=".65"/>`
          : "") +
        (title ? mark(...title) : "");
      const source = svg(width, height, body);
      fs.writeFileSync(
        path.join(sources, file.replace(".png", ".svg")),
        `${source}\n`,
      );
      record(
        {
          file,
          width,
          height,
          ...rest,
          ...(transparent ? { transparent: true } : {}),
        },
        await render(page, inlineImages(source), width, height, transparent),
      );
    }
    const originalIcon = fs.readFileSync(
      path.join(root, "../../public/images/icon/1024x1024.png"),
    );
    const iconData = originalIcon.toString("base64");
    const icons = new Map();
    for (const size of [16, 32, 48, 64, 128, 256, 512, 1024]) {
      icons.set(
        size,
        await render(
          page,
          svg(
            size,
            size,
            `<image width="${size}" height="${size}" href="data:image/png;base64,${iconData}"/>`,
          ),
          size,
          size,
          true,
        ),
      );
    }
    record(
      {
        file: "shortcut-icon.png",
        width: 512,
        height: 512,
        slot: "Community / Shortcut Icon",
        required: true,
        transparent: true,
      },
      icons.get(512),
    );
    record(
      {
        file: "shortcut-icon.ico",
        sizes: [16, 32, 48, 64, 128, 256],
        slot: "Community / Shortcut Icon (ICO alternative)",
        required: false,
      },
      ico(
        [16, 32, 48, 64, 128, 256].map((size) => ({
          size,
          data: icons.get(size),
        })),
      ),
    );
    record(
      {
        file: "mac-icon.icns",
        sizes: [16, 32, 64, 128, 256, 512, 1024],
        slot: "Community / Mac Icon",
        required: "macOS shortcuts",
      },
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
        `<rect width="184" height="184" fill="#102133"/><image href="data:image/png;base64,${iconData}" width="184" height="184"/>`,
      ),
      184,
      184,
    );
    record(
      {
        file: "app-icon.jpg",
        width: 184,
        height: 184,
        slot: "Community / App Icon",
        required: true,
      },
      await page.screenshot({ type: "jpeg", quality: 95 }),
    );
    fs.writeFileSync(
      path.join(root, "manifest.json"),
      `${JSON.stringify(manifest, null, 2)}\n`,
    );
    const review = `<html lang="en"><meta charset="utf-8"><title>Electrify Steam artwork review</title><style>body{margin:32px;background:#e8edf3;color:#142337;font:15px system-ui}h1{font-size:26px}main{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:24px}figure{margin:0}img{display:block;width:100%;height:210px;object-fit:contain;background:#102133}figcaption{padding:8px 0}small{display:block}section{margin:28px 0}.tiny{width:auto;height:auto}.hero{position:relative}.hero img{height:auto}.hero .logo{position:absolute;left:5%;bottom:18%;width:27%;height:auto;background:none}.logo-light{background:#edf2f7}</style><h1>Electrify · Dispatch desk</h1><p>Exact upload files; labels and simulated logo placement below are review aids only.</p><section><strong>Three artwork directions</strong><main><figure><img src="options/a-grid-atlas.png" alt="A Grid atlas"><figcaption>A · Grid atlas</figcaption></figure><figure><img src="options/b-power-portfolio.png" alt="B Power portfolio"><figcaption>B · Power portfolio</figcaption></figure><figure><img src="uploads/store-main.png" alt="C Dispatch desk"><figcaption>C · Dispatch desk — selected</figcaption></figure></main></section><section><strong>Actual small-capsule sizes</strong><p><img class="tiny" src="uploads/store-small.png" width="120" style="width:120px" alt="120 by 45 small capsule"></p><p><img class="tiny" src="uploads/store-small.png" width="184" style="width:184px" alt="184 by 69 small capsule"></p></section><main>${manifest
      .filter((item) => item.file.endsWith(".png"))
      .map(
        (item) =>
          `<figure><img src="uploads/${item.file}" alt="${item.slot}"><figcaption>${item.file}<small>${item.width} × ${item.height}</small></figcaption></figure>`,
      )
      .join(
        "",
      )}</main><section><strong>Library hero with separate logo (simulated placement)</strong><div class="hero"><img src="uploads/library-hero.png" alt="Text-free library hero"><img class="logo" src="uploads/library-logo.png" alt="Separate logo"></div></section><section><strong>Transparent logo on a light surface</strong><img class="logo-light" src="uploads/library-logo.png" style="width:640px;height:auto" alt="White logo transparency check; intended for dark hero"></section><h2>Gameplay screenshots</h2><main>${
      fs.existsSync(path.join(root, "screenshots"))
        ? fs
            .readdirSync(path.join(root, "screenshots"))
            .filter((f) => f.endsWith(".png"))
            .map(
              (file) =>
                `<figure><img src="screenshots/${file}" alt="${file}"><figcaption>${file}</figcaption></figure>`,
            )
            .join("")
        : ""
    }</main></html>`;
    fs.writeFileSync(path.join(root, "review.html"), review);
    await page.setViewportSize({ width: 1480, height: 1000 });
    await page.goto(pathToFileURL(path.join(root, "review.html")).href);
    await page.screenshot({
      path: path.join(root, "../../.tmp/steam-artwork/pr-artwork-review.png"),
      fullPage: true,
    });
    await page.setViewportSize({ width: 860, height: 380 });
    const heroData = fs
      .readFileSync(path.join(uploads, "library-hero.png"))
      .toString("base64");
    await page.setContent(
      `<html><body style="margin:0"><svg xmlns="http://www.w3.org/2000/svg" width="860" height="380" viewBox="1490 430 860 380"><image width="3840" height="1240" href="data:image/png;base64,${heroData}"/></svg></body></html>`,
    );
    await page.screenshot({
      path: path.join(root, "../../.tmp/steam-artwork/pr-hero-safe-area.png"),
    });
    console.log(`Exported ${manifest.length} upload files.`);
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
