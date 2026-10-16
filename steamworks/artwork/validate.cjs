const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { chromium } = require("@playwright/test");

const root = __dirname;
const pngSize = (data) => {
  assert.equal(
    data.subarray(0, 8).toString("hex"),
    "89504e470d0a1a0a",
    "Expected PNG bytes, not an LFS pointer",
  );
  return [data.readUInt32BE(16), data.readUInt32BE(20)];
};

async function main() {
  const manifest = JSON.parse(
    fs.readFileSync(path.join(root, "manifest.json"), "utf8"),
  );
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  try {
    for (const entry of manifest) {
      const data = fs.readFileSync(path.join(root, "uploads", entry.file));
      assert.equal(
        crypto.createHash("sha256").update(data).digest("hex"),
        entry.sha256,
        `${entry.file}: stale manifest`,
      );
      if (entry.file.endsWith(".png") || entry.file.endsWith(".jpg")) {
        const mime = entry.file.endsWith(".png") ? "image/png" : "image/jpeg";
        const result = await page.evaluate(
          async (url) => {
            const image = new Image();
            image.src = url;
            await image.decode();
            const canvas = document.createElement("canvas");
            canvas.width = image.width;
            canvas.height = image.height;
            const context = canvas.getContext("2d");
            context.drawImage(image, 0, 0);
            const pixels = context.getImageData(
              0,
              0,
              canvas.width,
              canvas.height,
            ).data;
            let transparent = 0;
            let visible = 0;
            for (let i = 3; i < pixels.length; i += 4) {
              if (pixels[i] === 0) transparent += 1;
              if (pixels[i] > 0) visible += 1;
            }
            return { size: [image.width, image.height], transparent, visible };
          },
          `data:${mime};base64,${data.toString("base64")}`,
        );
        assert.deepEqual(result.size, [entry.width, entry.height], entry.file);
        assert.ok(result.visible > 0, `${entry.file}: empty image`);
        if (entry.transparent)
          assert.ok(
            result.transparent > result.visible / 10,
            `${entry.file}: transparency lost`,
          );
        else
          assert.equal(
            result.transparent,
            0,
            `${entry.file}: unexpected alpha`,
          );
      } else if (entry.file.endsWith(".ico")) {
        assert.equal(data.readUInt16LE(2), 1);
        assert.equal(data.readUInt16LE(4), entry.sizes.length);
        entry.sizes.forEach((size, i) => {
          const start = 6 + i * 16;
          const length = data.readUInt32LE(start + 8);
          const offset = data.readUInt32LE(start + 12);
          assert.deepEqual(pngSize(data.subarray(offset, offset + length)), [
            size,
            size,
          ]);
        });
      } else if (entry.file.endsWith(".icns")) {
        assert.equal(data.toString("ascii", 0, 4), "icns");
        assert.equal(data.readUInt32BE(4), data.length);
        const sizes = [];
        for (let offset = 8; offset < data.length;) {
          const length = data.readUInt32BE(offset + 4);
          assert.ok(length > 8 && offset + length <= data.length);
          const [width, height] = pngSize(
            data.subarray(offset + 8, offset + length),
          );
          assert.equal(width, height);
          sizes.push(width);
          offset += length;
        }
        assert.deepEqual(sizes, entry.sizes);
      }
    }
    const screenshots = JSON.parse(
      fs.readFileSync(path.join(root, "screenshots.json"), "utf8"),
    );
    assert.ok(
      screenshots.length >= 5,
      "Steam needs at least five gameplay screenshots",
    );
    for (const shot of screenshots) {
      assert.deepEqual(
        pngSize(fs.readFileSync(path.join(root, "screenshots", shot.file))),
        [1920, 1080],
        shot.file,
      );
    }
    console.log(
      `Verified ${manifest.length} Steam upload files and ${screenshots.length} gameplay screenshots: dimensions, formats, hashes, transparency and icon containers.`,
    );
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
