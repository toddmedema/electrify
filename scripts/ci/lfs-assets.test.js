const assert = require("node:assert/strict");
const { execFileSync, spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");
const { pathToFileURL } = require("node:url");
const achievements = require("../../src/achievements/AchievementCatalog.json");

const script = path.join(__dirname, "lfs-assets.js");
const cue = "public/audio/menu/confirm.wav";
const soundtrack = "public/audio/menu/quiet-current.wav";
const image = "public/images/manual-cost.webp";
const icon = `public/images/${achievements[0].icon}.svg`;
const assets = {
  [cue]: "Short PCM cue",
  [soundtrack]: "Soundtrack bytes",
  [image]: "Compressed manual figure",
  [icon]: "Achievement SVG",
  "public/images/logo.svg": "Unrelated SVG",
  "public/.well-known/image.png": "A public asset in a dot-directory",
  "docs/manual-images/manual-cost.png": "Original manual figure",
  "docs/manual-images/manual-cost.svg": "Unused manual source SVG",
  "steamworks/achievement-artwork/uploads/ACHIEVED.png": "Achievement upload",
  "steamworks/artwork/screenshots/store.png": "Store artwork",
};
const env = {
  ...process.env,
  GIT_CONFIG_GLOBAL: os.devNull,
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_LFS_SKIP_SMUDGE: "1",
};

function git(root, ...args) {
  return execFileSync("git", args, { cwd: root, env, encoding: "utf8" });
}

function write(root, file, bytes) {
  const target = path.join(root, file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, bytes);
}

function read(root, file) {
  return fs.readFileSync(path.join(root, file), "utf8");
}

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "electrify-lfs-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const source = path.join(root, "source");
  const remote = path.join(root, "remote.git");
  const checkout = path.join(root, "checkout");
  git(root, "init", "--quiet", "--bare", remote);
  git(root, "init", "--quiet", source);
  git(source, "lfs", "install", "--local");
  write(
    source,
    ".gitattributes",
    ["*.png", "*.svg", "*.wav", "*.webp"]
      .map((pattern) => `${pattern} filter=lfs diff=lfs merge=lfs -text\n`)
      .join(""),
  );
  for (const [file, bytes] of Object.entries(assets))
    write(source, file, bytes);
  git(source, "add", ".");
  git(
    source,
    "-c",
    "user.name=Test",
    "-c",
    "user.email=test@example.com",
    "commit",
    "--quiet",
    "-m",
    "Add tracked assets",
  );
  git(source, "remote", "add", "origin", pathToFileURL(remote).href);
  git(source, "push", "--quiet", "origin", "HEAD:refs/heads/fixtures");
  git(
    root,
    "clone",
    "--quiet",
    "--branch",
    "fixtures",
    pathToFileURL(remote).href,
    checkout,
  );
  return checkout;
}

function prepare(root, ...args) {
  return spawnSync(process.execPath, [script, ...args], {
    cwd: root,
    env,
    encoding: "utf8",
  });
}

test("CPU downloads only fixtures whose test suites need the bytes", (t) => {
  const checkout = fixture(t);
  const result = prepare(checkout, "cpu");
  assert.equal(result.status, 0, result.stderr);
  const expected = [
    cue,
    image,
    icon,
    "docs/manual-images/manual-cost.png",
    "steamworks/achievement-artwork/uploads/ACHIEVED.png",
  ];
  const entries = JSON.parse(
    git(checkout, "lfs", "ls-files", "--json", "HEAD"),
  ).files;
  assert.deepEqual(
    entries
      .filter(({ downloaded }) => downloaded)
      .map(({ name }) => name)
      .sort(),
    expected.sort(),
  );
  for (const name of expected) assert.equal(read(checkout, name), assets[name]);
});

test("public download excludes non-public assets and renderer restore verifies committed hashes", (t) => {
  const checkout = fixture(t);
  const result = prepare(checkout, "public");
  assert.equal(result.status, 0, result.stderr);
  const publicFiles = Object.keys(assets).filter((name) =>
    name.startsWith("public/"),
  );
  for (const name of publicFiles) {
    assert.equal(read(checkout, name), assets[name]);
    write(checkout, name.replace("public/", "build/"), assets[name]);
    write(checkout, name, git(checkout, "show", `HEAD:${name}`));
  }
  assert.match(
    read(checkout, "docs/manual-images/manual-cost.png"),
    /^version https:\/\/git-lfs/,
  );

  git(checkout, "remote", "remove", "origin");
  const packagedCue = "build/audio/menu/confirm.wav";
  fs.unlinkSync(path.join(checkout, packagedCue));
  for (const [bytes, message] of [
    [null, /Missing LFS asset/],
    ["pointer", /Wrong LFS asset size/],
    [assets[cue].replace("S", "s"), /Wrong LFS asset hash/],
  ]) {
    if (bytes !== null) write(checkout, packagedCue, bytes);
    const rejected = prepare(checkout, "renderer", "build");
    assert.equal(rejected.status, 1);
    assert.match(rejected.stderr, message);
    assert.match(read(checkout, cue), /^version https:\/\/git-lfs/);
  }

  write(checkout, packagedCue, assets[cue]);
  const restored = prepare(checkout, "renderer", "build");
  assert.equal(restored.status, 0, restored.stderr);
  for (const name of publicFiles)
    assert.equal(read(checkout, name), assets[name]);
});
