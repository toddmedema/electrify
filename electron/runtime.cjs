const path = require("node:path");
const { runtimeNoticeFilename } = require("./runtime-notices.cjs");

const APP_ORIGIN = "electrify://app";
const APP_URL = `${APP_ORIGIN}/index.html`;
const MAX_LIBRARY_BYTES = 64 * 1024 * 1024;
const RESOLUTIONS = [
  [800, 600],
  [1024, 768],
  [1280, 720],
  [1280, 800],
  [1366, 768],
  [1600, 900],
  [1920, 1080],
  [2560, 1440],
  [3840, 2160],
];

function isAppUrl(value) {
  try {
    const url = new URL(value);
    return (
      url.protocol === "electrify:" &&
      url.hostname === "app" &&
      !url.port &&
      !url.username &&
      !url.password
    );
  } catch {
    return false;
  }
}

function resolveAsset(root, value, runtimeNotices) {
  if (!isAppUrl(value)) throw new Error("Untrusted asset origin");
  const pathname = decodeURIComponent(new URL(value).pathname);
  if (pathname.includes("\\") || pathname.includes("\0"))
    throw new Error("Invalid asset path");
  const filename = path.resolve(
    root,
    `.${pathname === "/" ? "/index.html" : pathname}`,
  );
  const relative = path.relative(root, filename);
  if (relative.startsWith("..") || path.isAbsolute(relative))
    throw new Error("Asset path escapes the bundle");
  // The shared renderer is built on Linux. Only this fixed URL reads the
  // actual packaged platform's original Chromium terms outside that bundle.
  const notice = runtimeNoticeFilename(relative);
  if (runtimeNotices && notice) return path.join(runtimeNotices, notice);
  return filename;
}

function trustedSender(event, window) {
  return (
    window &&
    !window.isDestroyed() &&
    event.sender === window.webContents &&
    event.senderFrame === window.webContents.mainFrame &&
    isAppUrl(event.senderFrame.url)
  );
}

function resolutionsFor(display, current) {
  // Electron uses device-independent pixels for window bounds, including scaled monitors.
  const { width, height } = display.workAreaSize;
  const modes = RESOLUTIONS.filter(([w, h]) => w <= width && h <= height).map(
    ([w, h]) => ({ width: w, height: h }),
  );
  if (!modes.some((mode) => mode.width === width && mode.height === height))
    modes.push({ width, height });
  if (
    current &&
    !modes.some(
      (mode) => mode.width === current.width && mode.height === current.height,
    )
  )
    modes.push({ width: current.width, height: current.height });
  return modes;
}

function normalizeDisplay(input, display) {
  if (input && typeof input.fullscreen !== "boolean")
    throw new Error("Fullscreen must be a boolean");
  const bounds = display.workAreaSize;
  const width = input?.width ?? Math.min(1280, bounds.width);
  const height = input?.height ?? Math.min(720, bounds.height);
  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width < 320 ||
    height < 240 ||
    width > 16384 ||
    height > 16384
  )
    throw new Error("Invalid window resolution");
  return {
    fullscreen: input?.fullscreen ?? true,
    width: Math.min(Math.max(width, Math.min(800, bounds.width)), bounds.width),
    height: Math.min(
      Math.max(height, Math.min(600, bounds.height)),
      bounds.height,
    ),
  };
}

function validateBoard(input) {
  const difficulties = ["Intern", "Employee", "Manager", "VP", "CEO"];
  if (
    !input ||
    !Number.isSafeInteger(input.scenarioId) ||
    input.scenarioId < 0 ||
    input.scenarioId > 100000 ||
    !difficulties.includes(input.difficulty) ||
    typeof input.challengeId !== "string" ||
    input.challengeId.length > 100 ||
    !/^[a-zA-Z0-9:_-]+$/.test(input.challengeId)
  )
    throw new Error("Invalid leaderboard selection");
  return {
    scenarioId: input.scenarioId,
    difficulty: input.difficulty,
    challengeId: input.challengeId,
  };
}

function validateScore(input) {
  const board = validateBoard(input);
  if (
    !Number.isFinite(input.score) ||
    input.score < -2147483648 ||
    input.score > 2147483647
  )
    throw new Error("Score is outside the Steam integer range");
  if (
    input.appVersion !== undefined &&
    (typeof input.appVersion !== "string" ||
      !/^[a-zA-Z0-9.-]{1,64}$/.test(input.appVersion))
  )
    throw new Error("Invalid score app version");
  return {
    ...board,
    score: Math.round(input.score),
    ...(input.appVersion ? { appVersion: input.appVersion } : {}),
  };
}

function activityObject(input, keys) {
  if (
    !input ||
    typeof input !== "object" ||
    Array.isArray(input) ||
    Object.keys(input).some((key) => !keys.includes(key))
  )
    throw new Error("Invalid Steam activity");
}

function activityNumber(value, maximum) {
  return Number.isSafeInteger(value) && value >= 1 && value <= maximum;
}

function validateActivity(input) {
  activityObject(input, [
    "phase",
    "scenarioId",
    "year",
    "totalYears",
    "timelineEnabled",
  ]);
  if (
    ![
      "loading",
      "menu",
      "playing",
      "paused",
      "replay",
      "victory",
      "ended",
    ].includes(input.phase) ||
    typeof input.timelineEnabled !== "boolean" ||
    (input.scenarioId !== undefined &&
      (!Number.isSafeInteger(input.scenarioId) ||
        input.scenarioId < 0 ||
        input.scenarioId > 100000)) ||
    (input.year !== undefined && !activityNumber(input.year, 10000)) ||
    (input.totalYears !== undefined && !activityNumber(input.totalYears, 10000))
  )
    throw new Error("Invalid Steam activity");
  return {
    phase: input.phase,
    scenarioId: input.scenarioId,
    year: input.year,
    totalYears: input.totalYears,
    timelineEnabled: input.timelineEnabled,
  };
}

function validateTimelineEvent(input) {
  activityObject(input, ["runId", "eventId", "kind", "scenarioId", "year"]);
  if (
    !["construction", "blackout", "recovery", "victory"].includes(input.kind) ||
    !Number.isSafeInteger(input.scenarioId) ||
    input.scenarioId < 0 ||
    input.scenarioId > 100000 ||
    !activityNumber(input.year, 10000) ||
    [input.runId, input.eventId].some(
      (id) =>
        typeof id !== "string" ||
        id.length < 1 ||
        id.length > 128 ||
        !/^[a-zA-Z0-9:_-]+$/.test(id),
    )
  )
    throw new Error("Invalid Steam Timeline event");
  return {
    runId: input.runId,
    eventId: input.eventId,
    kind: input.kind,
    scenarioId: input.scenarioId,
    year: input.year,
  };
}

function libraryJson(library) {
  if (!library || typeof library !== "object" || library.version !== 1)
    throw new Error("Invalid desktop save library");
  const json = JSON.stringify(library);
  if (Buffer.byteLength(json) > MAX_LIBRARY_BYTES)
    throw new Error("The desktop save library is too large");
  return json;
}

function parseLibrary(json) {
  if (Buffer.byteLength(json) > MAX_LIBRARY_BYTES)
    throw new Error("The desktop save library is too large");
  const library = JSON.parse(json);
  libraryJson(library);
  return library;
}

module.exports = {
  APP_ORIGIN,
  APP_URL,
  MAX_LIBRARY_BYTES,
  isAppUrl,
  resolveAsset,
  trustedSender,
  resolutionsFor,
  normalizeDisplay,
  validateBoard,
  validateScore,
  validateActivity,
  validateTimelineEvent,
  libraryJson,
  parseLibrary,
};
