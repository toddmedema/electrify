const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { preserveRuntimeNotices } = require("../scripts/runtime-notices.js");
const { readRuntimeNoticeAssets } = require("./runtime-notices.cjs");

const version = require("../package-lock.json").packages[
  "node_modules/electron"
].version;

function fixture(t) {
  const parent = path.resolve(".tmp", "native-tests");
  fs.mkdirSync(parent, { recursive: true });
  const directory = fs.mkdtempSync(path.join(parent, "runtime-notices-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const appOutDir = path.join(directory, "windows-runtime");
  fs.mkdirSync(appOutDir);
  const targetBytes = Buffer.from(
    "<html>Windows Chromium original terms</html>\r\n",
  );
  fs.writeFileSync(
    path.join(appOutDir, "LICENSE.electron.txt"),
    "Electron MIT",
  );
  fs.writeFileSync(path.join(appOutDir, "LICENSES.chromium.html"), targetBytes);
  preserveRuntimeNotices({
    appOutDir,
    electronPlatformName: "win32",
    packager: { info: { framework: { version } } },
  });
  const target = path.join(appOutDir, "resources", "runtime-notices");
  return { target };
}

test("target notice expectations reject incomplete, altered or mismatched extraction metadata", (t) => {
  const cases = [
    [
      "version",
      (manifest) => {
        manifest.version = "0.0.0";
      },
    ],
    [
      "missing entry",
      (manifest) => {
        manifest.files.pop();
      },
    ],
    [
      "duplicate entry",
      (manifest) => {
        manifest.files[1] = manifest.files[0];
      },
    ],
    [
      "wrong size",
      (manifest) => {
        manifest.files[1].bytes++;
      },
    ],
    [
      "wrong hash",
      (manifest) => {
        manifest.files[1].sha256 = "0".repeat(64);
      },
    ],
    [
      "unsafe filename",
      (manifest) => {
        manifest.files[1].name = "../LICENSES.chromium.html";
      },
    ],
  ];
  for (const [label, mutate] of cases) {
    const { target } = fixture(t);
    const filename = path.join(target, "manifest.json");
    const manifest = JSON.parse(fs.readFileSync(filename, "utf8"));
    mutate(manifest);
    fs.writeFileSync(filename, JSON.stringify(manifest));
    assert.throws(
      () => readRuntimeNoticeAssets(target, version),
      /Packaged Electron notice (?:manifest|mismatch)/,
      label,
    );
  }
  const { target } = fixture(t);
  fs.rmSync(path.join(target, "LICENSE"));
  assert.throws(() => readRuntimeNoticeAssets(target, version), /ENOENT/);
});
