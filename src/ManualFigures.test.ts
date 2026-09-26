import { existsSync, readdirSync, readFileSync, statSync } from "fs";
import { resolve } from "path";

// The manual's figures ship as WebP compressed from the originals in design/manual/ by
// `node scripts/compress-manual-images.js`. These tests keep the two in step.
const root = process.cwd();
const sourceDir = resolve(root, "design/manual");
const imagesDir = resolve(root, "public/images");

type Size = { width: number; height: number };

function pngSize(bytes: Buffer): Size {
  expect(bytes.toString("latin1", 12, 16)).toBe("IHDR");
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

function jpegSize(bytes: Buffer): Size {
  let offset = 2;
  while (offset < bytes.length) {
    const marker = bytes[offset + 1];
    // Any start-of-frame marker except DHT (C4), JPG (C8) and DAC (CC) carries the dimensions.
    if (
      marker >= 0xc0 &&
      marker <= 0xcf &&
      ![0xc4, 0xc8, 0xcc].includes(marker)
    ) {
      return {
        height: bytes.readUInt16BE(offset + 5),
        width: bytes.readUInt16BE(offset + 7),
      };
    }
    offset += 2 + bytes.readUInt16BE(offset + 2);
  }
  throw new Error("No JPEG frame header");
}

function webpSize(bytes: Buffer): Size {
  expect(bytes.toString("latin1", 0, 4)).toBe("RIFF");
  expect(bytes.toString("latin1", 8, 12)).toBe("WEBP");
  const chunk = bytes.toString("latin1", 12, 16);
  if (chunk === "VP8 ") {
    return {
      width: bytes.readUInt16LE(26) & 0x3fff,
      height: bytes.readUInt16LE(28) & 0x3fff,
    };
  }
  if (chunk === "VP8L") {
    const bits = bytes.readUInt32LE(21);
    return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
  }
  if (chunk === "VP8X") {
    return {
      width: bytes.readUIntLE(24, 3) + 1,
      height: bytes.readUIntLE(27, 3) + 1,
    };
  }
  throw new Error(`Unknown WebP chunk ${chunk}`);
}

function imageSize(path: string): Size {
  const bytes = readFileSync(path);
  if (path.endsWith(".png")) return pngSize(bytes);
  if (path.endsWith(".webp")) return webpSize(bytes);
  return jpegSize(bytes);
}

const originals = readdirSync(sourceDir)
  .filter((file) => /\.(png|jpe?g)$/i.test(file))
  .sort();

describe("manual figures", () => {
  it("keeps an original for every figure", () => {
    expect(originals.length).toBeGreaterThan(0);
  });

  it.each(originals)(
    "%s ships as a smaller WebP of the same size",
    (original) => {
      const source = resolve(sourceDir, original);
      const compressed = resolve(
        imagesDir,
        original.replace(/\.[^.]+$/, ".webp"),
      );

      expect(existsSync(compressed)).toBe(true);
      expect(imageSize(compressed)).toEqual(imageSize(source));
      expect(statSync(compressed).size).toBeLessThan(statSync(source).size);
      // The originals stay out of the deployed site and the offline cache.
      expect(existsSync(resolve(imagesDir, original))).toBe(false);
    },
  );

  it("declares each figure's real size, so the layout doesn't shift or stretch", () => {
    const entries = readFileSync(
      resolve(root, "src/components/base/ManualEntries.tsx"),
      "utf8",
    );
    const figures = [
      ...entries.matchAll(
        /<Figure\s+src="\/images\/([^"]+)"[\s\S]*?width=\{(\d+)\}\s+height=\{(\d+)\}/g,
      ),
    ];

    expect(figures.map(([, file]) => file).sort()).toEqual(
      originals.map((file) => file.replace(/\.[^.]+$/, ".webp")),
    );
    for (const [, file, width, height] of figures) {
      expect(imageSize(resolve(imagesDir, file))).toEqual({
        width: Number(width),
        height: Number(height),
      });
    }
  });
});
