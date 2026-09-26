// Regenerates the manual's figures in public/images/ from the originals in design/manual/.
//
// Every player's service worker downloads these in the background (see
// scripts/generate-icon-manifest.js), so they ship as WebP instead of the originals: charts that
// were already JPEGs re-encode lossy at a quality that is indistinguishable at 3x zoom, and PNGs
// re-encode losslessly. Always encode from the originals, never from a previous output, so
// quality losses never compound.
//
// Requires `cwebp` (brew install webp, or apt install webp).
const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const sourceDir = path.join(root, "design", "manual");
const outputDir = path.join(root, "public", "images");

// Chosen by SSIM against the original and side-by-side review at 3x zoom (see README). q88 with
// sharp RGB->YUV conversion keeps thin chart lines and small legend text crisp.
const LOSSY = ["-q", "88", "-m", "6", "-sharp_yuv"];
const LOSSLESS = ["-lossless", "-z", "9"];

function webpArgs(file) {
  return /\.png$/i.test(file) ? LOSSLESS : LOSSY;
}

function main() {
  const sources = fs
    .readdirSync(sourceDir)
    .filter((file) => /\.(png|jpe?g)$/i.test(file))
    .sort();
  for (const file of sources) {
    const input = path.join(sourceDir, file);
    const output = path.join(outputDir, file.replace(/\.[^.]+$/, ".webp"));
    execFileSync("cwebp", [
      "-quiet",
      "-metadata",
      "none",
      ...webpArgs(file),
      input,
      "-o",
      output,
    ]);
    const before = fs.statSync(input).size;
    const after = fs.statSync(output).size;
    process.stdout.write(
      `${path.relative(root, output)}: ${before} -> ${after} bytes ` +
        `(${Math.round((1 - after / before) * 100)}% smaller)\n`,
    );
  }
}

main();
