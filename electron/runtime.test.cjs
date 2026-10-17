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
  const score = { scenarioId: 101, difficulty: "CEO", score: 100 };
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
    { ...board, score: Infinity },
    { ...board, score: 2147483648 },
  ])
    assert.throws(() =>
      "score" in entry ? validateScore(entry) : validateBoard(entry),
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
