const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const {
  isAppUrl,
  resolveAsset,
  trustedSender,
  normalizeDisplay,
  resolutionsFor,
  validateBoard,
  validateScore,
  libraryJson,
  parseLibrary,
  MAX_LIBRARY_BYTES,
} = require("./runtime.cjs");

test("score metadata survives validation and rejects invalid build versions", () => {
  const score = {
    scenarioId: 101,
    difficulty: "CEO",
    challengeId: "rules-a",
    score: 100,
  };
  const appVersion = "26sept26-1507";
  assert.equal(validateScore({ ...score, appVersion }).appVersion, appVersion);
  assert.equal(validateScore(score).appVersion, undefined);
  for (const invalid of [null, 12, "", "x".repeat(65), "bad\u0000version"])
    assert.throws(
      () => validateScore({ ...score, appVersion: invalid }),
      /app version/,
    );
});

test("bundled origin rejects foreign origins, credentials and asset traversal", () => {
  const root = path.resolve("build");
  assert.equal(
    resolveAsset(root, "electrify://app/data/weather/region.bin?v=1"),
    path.join(root, "data/weather/region.bin"),
  );
  assert.equal(
    resolveAsset(root, "electrify://app/"),
    path.join(root, "index.html"),
  );
  for (const url of [
    "https://app/index.html",
    "electrify://other/index.html",
    "electrify://user@app/index.html",
    "electrify://app:123/index.html",
    "electrify://app/%2e%2e%2fsecret",
    "electrify://app/%5c..%5csecret",
    "electrify://app/%00secret",
  ])
    assert.throws(() => resolveAsset(root, url), undefined, url);
  assert.equal(isAppUrl("not a URL"), false);
});

test("URL-normalized parent segments still resolve inside the renderer bundle", () => {
  const root = path.resolve("build");
  for (const asset of ["package.json", "electron/main.cjs"]) {
    const url = `electrify://app/../../${asset}`;
    assert.equal(new URL(url).pathname, `/${asset}`);
    assert.equal(resolveAsset(root, url), path.join(root, asset));
    assert.notEqual(resolveAsset(root, url), path.resolve(asset));
    assert.throws(
      () => resolveAsset(root, `electrify://app/%2e%2e%2f${asset}`),
      /escapes the bundle/,
    );
  }
});

test("only the fixed app notice URL reads the packaged platform's Chromium terms", () => {
  const root = path.resolve("build");
  const runtimeNotices = path.resolve("resources/runtime-notices");
  for (const suffix of ["", "?v=1", "#license"])
    assert.equal(
      resolveAsset(
        root,
        `electrify://app/notices-chromium.html${suffix}`,
        runtimeNotices,
      ),
      path.join(runtimeNotices, "LICENSES.chromium.html"),
    );
  assert.equal(
    resolveAsset(
      "build",
      "electrify://app/notices-chromium.html",
      runtimeNotices,
    ),
    path.join(runtimeNotices, "LICENSES.chromium.html"),
    "Relative bundle roots have the same fixed notice exception",
  );
  assert.equal(
    resolveAsset(root, "electrify://app/notices-chromium.html"),
    path.join(root, "notices-chromium.html"),
    "The development renderer retains its bundled notice file",
  );
  for (const file of [
    "LICENSE",
    "manifest.json",
    "runtime-notices/LICENSE",
    "notices-chromium.html/other",
  ])
    assert.equal(
      resolveAsset(root, `electrify://app/${file}`, runtimeNotices),
      path.join(root, file),
      "The notice exception must not expose other packaged resources",
    );
  for (const url of [
    "https://app/notices-chromium.html",
    "electrify://other/notices-chromium.html",
    "electrify://user@app/notices-chromium.html",
    "electrify://app:123/notices-chromium.html",
    "electrify://app/%2e%2e%2fnotices-chromium.html",
    "electrify://app/%5c..%5cnotices-chromium.html",
    "electrify://app/%00notices-chromium.html",
  ])
    assert.throws(
      () => resolveAsset(root, url, runtimeNotices),
      undefined,
      url,
    );
});

test("privileged IPC requires the actual game main frame, never child or foreign frames", () => {
  const mainFrame = { url: "electrify://app/index.html" };
  const webContents = { mainFrame };
  const window = { webContents, isDestroyed: () => false };
  assert.equal(
    trustedSender({ sender: webContents, senderFrame: mainFrame }, window),
    true,
  );
  assert.equal(
    trustedSender({ sender: {}, senderFrame: mainFrame }, window),
    false,
  );
  assert.equal(
    trustedSender(
      { sender: webContents, senderFrame: { ...mainFrame } },
      window,
    ),
    false,
  );
  mainFrame.url = "https://electrifygame.com";
  assert.equal(
    trustedSender({ sender: webContents, senderFrame: mainFrame }, window),
    false,
  );
});

test("first launch is fullscreen; saved resolutions remain inside scaled display work area", () => {
  const display = {
    workAreaSize: { width: 1536, height: 864 },
    scaleFactor: 1.25,
  };
  assert.deepEqual(normalizeDisplay(null, display), {
    fullscreen: true,
    width: 1280,
    height: 720,
  });
  assert.deepEqual(
    normalizeDisplay({ fullscreen: false, width: 3840, height: 2160 }, display),
    { fullscreen: false, width: 1536, height: 864 },
  );
  assert(
    resolutionsFor(display).some(
      (mode) => mode.width === 800 && mode.height === 600,
    ),
  );
  assert(
    resolutionsFor(display).every(
      (mode) => mode.width <= 1536 && mode.height <= 864,
    ),
  );
  assert(
    resolutionsFor(display, { width: 1100, height: 650 }).some(
      (mode) => mode.width === 1100 && mode.height === 650,
    ),
  );
  assert.deepEqual(
    normalizeDisplay({ fullscreen: false, width: 320, height: 240 }, display),
    { fullscreen: false, width: 800, height: 600 },
  );
  for (const input of [
    { fullscreen: 1 },
    { fullscreen: true, width: NaN },
    { fullscreen: true, height: -1 },
    { fullscreen: false, width: 20000 },
  ])
    assert.throws(() => normalizeDisplay(input, display));
});

test("Steam selections reject arbitrary names and scores outside signed integer range", () => {
  const board = {
    scenarioId: 101,
    difficulty: "CEO",
    challengeId: "rules-1-abc123",
  };
  assert.deepEqual(validateBoard(board), board);
  assert.equal(validateScore({ ...board, score: 123.45 }).score, 123);
  for (const entry of [
    { ...board, scenarioId: -1 },
    { ...board, difficulty: "custom" },
    { ...board, challengeId: "../../secrets" },
    { ...board, challengeId: undefined },
    { ...board, challengeId: "" },
    { ...board, score: Infinity },
    { ...board, score: 2147483648 },
  ])
    assert.throws(() =>
      "score" in entry ? validateScore(entry) : validateBoard(entry),
    );
});

test("current Steam scoring accepts only completed missions and preserves legacy queue identity", () => {
  const legacy = {
    scenarioId: 101,
    difficulty: "CEO",
    challengeId: "rules-1-abc123",
    score: 123,
  };
  assert.equal(validateScore(legacy).scoreVersion, undefined);
  const current = { ...legacy, scoreVersion: 2, outcome: "completed" };
  assert.deepEqual(validateScore(current), current);
  for (const outcome of ["bankrupt", "fired", undefined, "unknown"])
    assert.throws(
      () => validateScore({ ...current, outcome }),
      /Only completed missions/,
    );
  for (const scoreVersion of [0, 3, "2"])
    assert.throws(
      () => validateScore({ ...current, scoreVersion }),
      /Invalid leaderboard/,
    );
});

test("native save boundary bounds JSON while renderer owns domain validation", () => {
  const library = { version: 1, records: [{ id: "a", deleted: true }] };
  assert.deepEqual(parseLibrary(libraryJson(library)), library);
  assert.throws(() => libraryJson({ version: 2 }));
  assert.throws(() => parseLibrary("null"));
  assert(
    MAX_LIBRARY_BYTES < 100 * 1024 * 1024,
    "Save library fits Steam FileWrite's 100 MB limit",
  );
});
