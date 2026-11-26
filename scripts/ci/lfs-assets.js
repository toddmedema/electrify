const { execFileSync } = require("node:child_process");
const { createHash } = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const achievements = require("../../src/achievements/AchievementCatalog.json");

const publicAssets = ["public/**"];
const cpuFixtures = [
  // ManualFigures.test.ts compares the dimensions of the originals and WebP copies.
  "docs/manual-images/*.png",
  "docs/manual-images/*.jpg",
  "docs/manual-images/*.jpeg",
  "public/images/manual-*.webp",
  // site-pages.test.js compares the sizes of the responsive previews.
  "public/images/gameplay-preview.png",
  "public/images/gameplay-preview-*.webp",
  // CtaColor.test.ts reads the fill colors in both home wordmarks.
  "public/images/logo-home.svg",
  "public/images/logo-home-dark.svg",
  // MenuAssets.test.ts reads the three PCM cues. Music tests mock the downloads.
  "public/audio/menu/back.wav",
  "public/audio/menu/confirm.wav",
  "public/audio/menu/select.wav",
  // achievement-artwork.test.js checks the upload PNGs and their SVG provenance.
  "steamworks/achievement-artwork/uploads/*.png",
  ...new Set(achievements.map(({ icon }) => `public/images/${icon}.svg`)),
];

function readVerified(file, { name, size, oid }) {
  if (!fs.lstatSync(file, { throwIfNoEntry: false })?.isFile())
    throw new Error(`Missing LFS asset: ${name}`);
  const bytes = fs.readFileSync(file);
  if (bytes.length !== size) throw new Error(`Wrong LFS asset size: ${name}`);
  if (createHash("sha256").update(bytes).digest("hex") !== oid)
    throw new Error(`Wrong LFS asset hash: ${name}`);
  return bytes;
}

function prepareAssets(profile, renderer, root = process.cwd()) {
  const paths = profile === "cpu" ? cpuFixtures : publicAssets;
  const scope = [`--include=${paths.join(",")}`, "--exclude="];
  const git = (args, options) =>
    execFileSync("git", args, { cwd: root, ...options });
  const { files: assets } = JSON.parse(
    git(["lfs", "ls-files", "--json", ...scope, "HEAD"], { encoding: "utf8" }),
  );

  if (!renderer && assets.length) {
    // A checkout with automatic LFS disabled may not have configured filters.
    git(["lfs", "install", "--local", "--skip-repo", "--skip-smudge"], {
      stdio: "inherit",
    });
    git(
      ["-c", "lfs.fetchrecentalways=false", "lfs", "pull", ...scope, "origin"],
      { stdio: "inherit" },
    );
  }

  for (const asset of assets) {
    const target = path.join(root, asset.name);
    if (renderer) {
      const source = path.resolve(
        root,
        renderer,
        asset.name.slice("public/".length),
      );
      // Verify the original pointer before replacing it, then let packaging
      // compare the restored sources and the renderer as usual.
      fs.writeFileSync(target, readVerified(source, asset));
    } else readVerified(target, asset);
  }

  const unique = new Map(assets.map(({ oid, size }) => [oid, size]));
  const bytes = [...unique.values()].reduce((total, size) => total + size, 0);
  console.error(
    `Verified ${assets.length} ${profile} LFS paths (${bytes} unique bytes).`,
  );
}

if (require.main === module) {
  const [profile, renderer, ...extra] = process.argv.slice(2);
  if (
    !["cpu", "public", "renderer"].includes(profile) ||
    (profile === "renderer") !== Boolean(renderer) ||
    extra.length
  ) {
    console.error(
      "Usage: node scripts/ci/lfs-assets.js cpu|public|renderer [build-dir]",
    );
    process.exitCode = 1;
  } else {
    try {
      prepareAssets(profile, renderer);
    } catch (error) {
      console.error(error.message);
      process.exitCode = 1;
    }
  }
}
