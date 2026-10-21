const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { collectNotices, generateNotices } = require("../generate-notices");

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "electrify-notices-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const write = (name, contents) => {
    const target = path.join(root, name);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, contents);
  };
  write("LICENSE.md", "Game license including Commons Clause");
  write(
    "legal/asset-notices.json",
    JSON.stringify([
      { title: "Font", text: "Font credit", file: "font-license.txt" },
    ]),
  );
  write("font-license.txt", "Font redistribution terms");
  write("public/placeholder", "");
  const packages = {
    "": { name: "game" },
    "node_modules/runtime": { version: "1.2.3" },
    "node_modules/build-only": { version: "1", dev: true },
    "node_modules/other-platform": {
      version: "1",
      optional: true,
      os: ["darwin"],
    },
  };
  write("package-lock.json", JSON.stringify({ packages }));
  write(
    "node_modules/runtime/package.json",
    JSON.stringify({ name: "runtime", version: "1.2.3", license: "MIT" }),
  );
  write("node_modules/runtime/LICENSE", "Runtime redistribution terms");
  write("node_modules/runtime/vendor/NOTICE", "Vendor attribution");
  return { root, write, packages };
}

test("ships game, asset, runtime and nested vendor notices using locked installed versions", (t) => {
  const { root } = fixture(t);
  const notices = generateNotices(root);
  assert.equal(notices.length, 3);
  assert.match(notices[0].text, /Commons Clause/);
  assert.match(notices[1].text, /Font redistribution terms/);
  assert.equal(notices[2].title, "runtime 1.2.3 (MIT)");
  assert.match(notices[2].text, /Runtime redistribution terms/);
  assert.match(notices[2].text, /Vendor attribution/);
  assert.deepEqual(
    JSON.parse(fs.readFileSync(path.join(root, "public/notices.json"))),
    { notices, chromium: false },
  );
});

test("refuses to silently omit an installed runtime package's missing redistribution terms", (t) => {
  const { root } = fixture(t);
  fs.rmSync(path.join(root, "node_modules/runtime/LICENSE"));
  fs.rmSync(path.join(root, "node_modules/runtime/vendor/NOTICE"));
  assert.throws(
    () => collectNotices(root),
    /No redistribution notice found for node_modules\/runtime/,
  );
});

test("refuses a stale dependency install and a missing nonoptional runtime", (t) => {
  const { root, write } = fixture(t);
  write(
    "node_modules/runtime/package.json",
    JSON.stringify({ name: "runtime", version: "1.2.2" }),
  );
  assert.throws(() => collectNotices(root), /differs from lockfile/);
  fs.rmSync(path.join(root, "node_modules/runtime"), { recursive: true });
  assert.throws(() => collectNotices(root), /Install the lockfile/);
});

test("desktop output preserves the runtime license and exact original Chromium notice bytes", (t) => {
  const { root, write } = fixture(t);
  write("node_modules/electron/dist/LICENSE", "Electron MIT notice");
  write(
    "node_modules/electron/dist/LICENSES.chromium.html",
    "<html>Chromium third-party original</html>",
  );
  const notices = generateNotices(root, true);
  assert.match(notices.at(-1).text, /Electron MIT notice/);
  assert.equal(
    fs.readFileSync(path.join(root, "public/notices-chromium.html"), "utf8"),
    "<html>Chromium third-party original</html>",
  );
  assert.equal(
    JSON.parse(fs.readFileSync(path.join(root, "public/notices.json")))
      .chromium,
    true,
  );
  generateNotices(root, false);
  assert.equal(
    fs.existsSync(path.join(root, "public/notices-chromium.html")),
    false,
  );
});

test("Koffi attribution is stable when a shared renderer is built on a different platform", (t) => {
  const { root, write, packages } = fixture(t);
  packages["node_modules/koffi"] = { version: "3.3.3" };
  packages["node_modules/@koromix/koffi-win32-x64"] = {
    version: "3.3.3",
    optional: true,
    os: ["win32"],
  };
  packages["node_modules/@koromix/koffi-darwin-arm64"] = {
    version: "3.3.3",
    optional: true,
    os: ["darwin"],
  };
  write("package-lock.json", JSON.stringify({ packages }));
  write(
    "node_modules/koffi/package.json",
    JSON.stringify({ name: "koffi", version: "3.3.3", license: "MIT" }),
  );
  write(
    "node_modules/koffi/LICENSE.txt",
    "Koffi MIT copyright and redistribution terms",
  );
  const before = collectNotices(root);
  write(
    "node_modules/@koromix/koffi-win32-x64/package.json",
    JSON.stringify({
      name: "@koromix/koffi-win32-x64",
      version: "3.3.3",
      license: "MIT",
    }),
  );
  assert.deepEqual(collectNotices(root), before);
  assert.match(
    before.find((notice) => notice.title.startsWith("koffi ")).text,
    /both macOS architectures/,
  );
  packages["node_modules/@koromix/koffi-darwin-arm64"].version = "3.3.4";
  write("package-lock.json", JSON.stringify({ packages }));
  assert.throws(() => collectNotices(root), /native slice versions differ/);
});
