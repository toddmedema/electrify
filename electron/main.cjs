const {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  protocol,
  screen,
  session,
  shell,
} = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const {
  APP_URL,
  isAppUrl,
  resolveAsset,
  trustedSender,
  normalizeDisplay,
  resolutionsFor,
  validateBoard,
  validateScore,
} = require("./runtime.cjs");
const { atomicWrite, readJson, DesktopSaveStore } = require("./storage.cjs");
const { SteamService } = require("./steam.cjs");
const { SteamMultiplayer, lobbyFromArgs } = require("./steam-multiplayer.cjs");
const { applyConfirmedDisplay, createDisplayQueue } = require("./display.cjs");

protocol.registerSchemesAsPrivileged([
  {
    scheme: "electrify",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true,
    },
  },
]);
app.enableSandbox();
app.name = "Electrify";

const profile =
  process.argv
    .find((argument) => argument.startsWith("--electrify-profile="))
    ?.slice("--electrify-profile=".length) ||
  (!app.isPackaged && process.env.ELECTRIFY_USER_DATA_DIR);
if (profile) {
  if (!path.isAbsolute(profile))
    throw new Error("The desktop profile must be an absolute path");
  app.setPath("userData", profile);
}
let config = { mode: "offline" };
const configPath = path.join(app.getAppPath(), "desktop-config.json");
if (fs.existsSync(configPath)) config = readJson(configPath);
else if (!app.isPackaged && process.env.STEAM_APP_ID)
  config = { mode: "steam", appId: Number(process.env.STEAM_APP_ID) };
if (
  !["steam", "offline"].includes(config.mode) ||
  (config.mode === "steam" &&
    (!Number.isSafeInteger(config.appId) ||
      config.appId <= 0 ||
      config.appId > 2147483647))
)
  throw new Error("A Steam build needs its real Steam App ID");

// Take the lock before Steam starts: a second launch must not initialize the SDK, replace
// the running game's rich presence, or clear it again while it exits.
const primaryInstance = app.requestSingleInstanceLock();
const steam = new SteamService();
if (primaryInstance)
  steam.initialize(
    app,
    config,
    !app.isPackaged &&
      (process.env.ELECTRIFY_TEST === "1" ||
        process.env.ELECTRIFY_OFFLINE === "1"),
  );
let window;
let saves;
let preferences;
let quitting = false;
let finalizingQuit = false;
let quitRequested = false;
let quitTimer;
let rendererReady = false;
let rendererCrashed = false;
let quitWarningOpen = false;
let resizeTimer;
let displayUpdating = false;
let manualResize = false;
const preferenceFile = path.join(app.getPath("userData"), "display.json");
const root = path.join(app.getAppPath(), "build");

const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
  ".mp3": "audio/mpeg",
  ".ogg": "audio/ogg",
  ".wav": "audio/wav",
  ".csv": "text/csv; charset=utf-8",
  ".bin": "application/octet-stream",
  ".ico": "image/x-icon",
};

function contentPolicy() {
  const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
  const hashes = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)]
    .filter((match) => match[1].trim())
    .map(
      (match) =>
        `'sha256-${crypto.createHash("sha256").update(match[1]).digest("base64")}'`,
    );
  return `default-src 'self'; script-src 'self' ${hashes.join(" ")}; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; media-src 'self' blob: data:; connect-src 'self' blob:; worker-src 'self' blob:; object-src 'none'; base-uri 'self'; frame-src 'none'; form-action 'none'`;
}

function state() {
  const display = window
    ? screen.getDisplayMatching(window.getBounds())
    : screen.getPrimaryDisplay();
  return {
    display: {
      ...preferences,
      resolutions: resolutionsFor(display, preferences),
    },
    steam: steam.state(),
  };
}

function publishState() {
  if (window && !window.isDestroyed())
    window.webContents.send("desktop:state-changed", state());
}

function publishGameFocus() {
  if (window && !window.isDestroyed())
    window.webContents.send(
      "desktop:focus-changed",
      window.isFocused() && !steam.overlayActive,
    );
}
steam.onOverlayChanged = publishGameFocus;

function savePreferences() {
  atomicWrite(preferenceFile, JSON.stringify(preferences));
  publishState();
}

const displayChanges = createDisplayQueue(updateDisplay);
function applyDisplay(input) {
  const display = screen.getDisplayMatching(window.getBounds());
  const next = normalizeDisplay(input, display);
  return displayChanges.apply(next);
}

async function updateDisplay(input) {
  const display = screen.getDisplayMatching(window.getBounds());
  const next = normalizeDisplay(input, display);
  displayUpdating = true;
  manualResize = false;
  clearTimeout(resizeTimer);
  try {
    await applyConfirmedDisplay(window, preferences, next, (confirmed) => {
      preferences = confirmed;
      savePreferences();
    });
    return window.isDestroyed() ? next : state().display;
  } finally {
    displayUpdating = false;
    manualResize = false;
    publishState();
  }
}

async function finishQuit() {
  if (finalizingQuit) return;
  finalizingQuit = true;
  quitRequested = true;
  clearTimeout(quitTimer);
  // Keep the native close guard until confirmed settings have reached disk.
  // The queue blocks later inputs and treats already-reported failures as settled.
  await displayChanges.drain();
  quitting = true;
  app.quit();
}

async function quitFailure() {
  clearTimeout(quitTimer);
  if (quitWarningOpen || finalizingQuit) return;
  if (!window || window.isDestroyed()) return finishQuit();
  const crashed = !rendererReady;
  quitWarningOpen = true;
  let response;
  try {
    ({ response } = await dialog.showMessageBox(
      window,
      crashed
        ? {
            type: "warning",
            title: "Restart or quit",
            message: "The game stopped unexpectedly.",
            detail:
              "Your previous saves are safe. Restart to reload the game using the last saved state, or quit.",
            buttons: ["Restart game", "Quit with previous save"],
            defaultId: 0,
            cancelId: 0,
          }
        : {
            type: "warning",
            title: "Save before quitting",
            message: "Your latest game could not finish saving.",
            detail:
              "Your previous saves are safe. You can retry, return to the game, or quit using the last saved state.",
            buttons: [
              "Retry saving",
              "Return to game",
              "Quit with previous save",
            ],
            defaultId: 0,
            cancelId: 1,
          },
    ));
  } finally {
    quitWarningOpen = false;
  }
  if (response === (crashed ? 1 : 2)) return finishQuit();
  quitRequested = false;
  displayChanges.resume();
  if (!window || window.isDestroyed()) return finishQuit();
  // The renderer can also die while the ordinary save warning is already open.
  // Both Retry and Return then recover the game instead of pretending to save it.
  if (crashed || !rendererReady) window.webContents.reload();
  else if (response === 0) requestQuit();
}

function requestQuit() {
  if (quitting || quitRequested) return;
  if (!window || window.isDestroyed() || (!rendererReady && !rendererCrashed))
    return finishQuit();
  quitRequested = true;
  displayChanges.pause();
  if (rendererCrashed) return quitFailure();
  window.webContents.send("desktop:before-quit");
  quitTimer = setTimeout(() => {
    void quitFailure();
  }, 20000);
}

function handle(channel, callback) {
  ipcMain.handle(channel, (event, ...arguments_) => {
    if (!trustedSender(event, window))
      throw new Error("Untrusted desktop request");
    return callback(...arguments_);
  });
}

handle("desktop:state", () => {
  rendererReady = true;
  rendererCrashed = false;
  void steam.flushScores();
  return state();
});
handle("desktop:display", applyDisplay);
handle("desktop:quit", requestQuit);
handle("desktop:read-saves", () => saves.read());
handle("desktop:write-saves", (library, sync) => saves.write(library, sync));
handle("desktop:leaderboard", async (input) => {
  if (!input || !["global", "friends", "player"].includes(input.scope))
    throw new Error("Invalid leaderboard scope");
  if (input.difficulty === undefined) {
    const rows = [];
    for (const difficulty of ["Intern", "Employee", "Manager", "VP", "CEO"])
      rows.push(
        ...(await steam.getLeaderboard({
          ...validateBoard({ ...input, difficulty }),
          scope: input.scope,
        })),
      );
    return rows.sort((left, right) => right.score - left.score);
  }
  return steam.getLeaderboard({ ...validateBoard(input), scope: input.scope });
});
handle("desktop:score", (input) => steam.submitScore(validateScore(input)));
handle("desktop:friends", () => {
  steam.openFriends();
});
handle("desktop:activity", (activity) => steam.setActivity(activity));
handle("desktop:timeline-event", (event) => steam.addTimelineEvent(event));
handle("desktop:achievements", (intent) => steam.submitAchievements(intent));
handle("desktop:readAchievements", () => steam.readAchievements());
function multiplayerRequest(input) {
  if (!steam.multiplayer && (!steam.state().online || !steam.dispatcher)) {
    if (input?.kind === "state")
      return {
        available: false,
        members: [],
        connected: [],
        error: "Connect to Steam to play with friends",
      };
    throw new Error("Connect to Steam to play with friends");
  }
  steam.multiplayer ??= new SteamMultiplayer(
    steam,
    steam.dispatcher,
    saves.directory,
    (event) => {
      if (window && !window.isDestroyed()) {
        if (event.kind === "state") {
          const throttle = !event.state.lobbyId;
          if (window.webContents.getBackgroundThrottling() !== throttle)
            window.webContents.setBackgroundThrottling(throttle);
        }
        window.webContents.send("desktop:multiplayer-event", event);
      }
    },
  );
  return steam.multiplayer.request(input);
}
handle("desktop:multiplayer", multiplayerRequest);
ipcMain.on("desktop:ready-to-quit", (event, success) => {
  if (
    !trustedSender(event, window) ||
    !quitRequested ||
    finalizingQuit ||
    typeof success !== "boolean"
  )
    return;
  if (success) finishQuit();
  else void quitFailure();
});

function openExternal(url) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" || parsed.username || parsed.password)
      return;
    const allowed = [
      "electrifygame.com",
      "github.com",
      "store.steampowered.com",
      "steamcommunity.com",
      "toddmedema.com",
      "www.toddmedema.com",
      "discord.gg",
      "discord.com",
    ];
    if (!allowed.includes(parsed.hostname)) return;
    void shell.openExternal(parsed.href);
  } catch {
    // Ignore malformed or unapproved external URLs.
  }
}

async function createWindow() {
  if (!fs.existsSync(path.join(root, "index.html")))
    throw new Error("Run npm run desktop:build before opening Electrify");
  const display = screen.getPrimaryDisplay();
  try {
    preferences = normalizeDisplay(readJson(preferenceFile, null), display);
  } catch {
    preferences = normalizeDisplay(null, display);
  }
  saves = new DesktopSaveStore(app.getPath("userData"), steam);
  steam.configureScoreQueue(saves.directory);
  steam.configureAchievements(saves.directory, config.appId);
  if (steam.state().online) {
    try {
      multiplayerRequest({ kind: "state" });
    } catch (error) {
      console.warn(`Steam multiplayer unavailable: ${error.message}`);
    }
  }
  const player = steam.state().steamId || "offline";
  const isolatedSession = session.fromPartition(`persist:electrify-${player}`);
  isolatedSession.setPermissionRequestHandler(
    (_contents, _permission, callback) => callback(false),
  );
  isolatedSession.setPermissionCheckHandler(() => false);
  isolatedSession.webRequest.onBeforeRequest((details, callback) => {
    // All gameplay resources are in this bundle. Steam networking uses its native client APIs.
    callback({
      cancel:
        !isAppUrl(details.url) &&
        !details.url.startsWith("devtools:") &&
        !details.url.startsWith("blob:") &&
        !details.url.startsWith("data:"),
    });
  });
  const policy = contentPolicy();
  await isolatedSession.protocol.handle("electrify", async (request) => {
    try {
      const filename = resolveAsset(root, request.url);
      const data = await fs.promises.readFile(filename);
      const headers = {
        "Content-Type":
          contentTypes[path.extname(filename).toLowerCase()] ||
          "application/octet-stream",
        "Content-Security-Policy": policy,
        "X-Content-Type-Options": "nosniff",
        "Accept-Ranges": "bytes",
      };
      const range = request.headers.get("range");
      if (range) {
        const match = /^bytes=(\d+)-(\d*)$/.exec(range);
        if (!match) return new Response(null, { status: 416 });
        const start = Number(match[1]);
        const end = match[2]
          ? Math.min(Number(match[2]), data.length - 1)
          : data.length - 1;
        if (start > end || start >= data.length)
          return new Response(null, { status: 416 });
        return new Response(data.subarray(start, end + 1), {
          status: 206,
          headers: {
            ...headers,
            "Content-Range": `bytes ${start}-${end}/${data.length}`,
          },
        });
      }
      return new Response(data, { headers });
    } catch {
      return new Response("Bundled asset unavailable", { status: 404 });
    }
  });
  window = new BrowserWindow({
    title: "Electrify",
    width: preferences.width,
    height: preferences.height,
    useContentSize: true,
    fullscreen: preferences.fullscreen,
    fullscreenable: true,
    show: false,
    minWidth: Math.min(800, display.workAreaSize.width),
    minHeight: Math.min(600, display.workAreaSize.height),
    backgroundColor: "#0b1016",
    autoHideMenuBar: true,
    icon: path.join(root, "images/icon/512x512.png"),
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      webviewTag: false,
      session: isolatedSession,
      devTools: !app.isPackaged,
    },
  });
  window.setMenu(null);
  window.webContents.setWindowOpenHandler(({ url }) => {
    openExternal(url);
    return { action: "deny" };
  });
  window.webContents.on("will-navigate", (event, url) => {
    if (!isAppUrl(url) || new URL(url).pathname !== "/index.html") {
      event.preventDefault();
      if (isAppUrl(url))
        openExternal(`https://electrifygame.com${new URL(url).pathname}`);
      else openExternal(url);
    }
  });
  window.webContents.on("will-frame-navigate", (event) => {
    if (!isAppUrl(event.url)) event.preventDefault();
  });
  window.webContents.on("will-attach-webview", (event) =>
    event.preventDefault(),
  );
  window.webContents.on("before-input-event", (event, input) => {
    if (
      input.type === "keyDown" &&
      !input.isAutoRepeat &&
      (input.key === "F11" || (input.alt && input.key === "Enter"))
    ) {
      event.preventDefault();
      const intended = displayChanges.intended(preferences);
      void applyDisplay({
        ...intended,
        fullscreen: !intended.fullscreen,
      }).catch((error) =>
        console.error("Display change failed:", error.message),
      );
    }
  });
  window.on("enter-full-screen", () => {
    if (displayUpdating) return;
    preferences.fullscreen = true;
    savePreferences();
  });
  window.webContents.on("render-process-gone", () => {
    // A crashed renderer can't answer the save handshake; don't make Quit wait for it.
    rendererReady = false;
    rendererCrashed = true;
    if (quitRequested && !finalizingQuit) void quitFailure();
  });
  window.on("blur", publishGameFocus);
  window.on("focus", publishGameFocus);
  window.on("leave-full-screen", () => {
    if (displayUpdating) return;
    preferences.fullscreen = false;
    savePreferences();
  });
  window.on("will-resize", () => {
    // Electron emits this only for a dragged native frame, never setContentSize,
    // fullscreen restoration, centering, or programmatic DPI corrections.
    manualResize = true;
  });
  window.on("resize", () => {
    clearTimeout(resizeTimer);
    if (process.platform === "linux" && !displayUpdating) manualResize = true;
    if (displayUpdating || !manualResize) return;
    resizeTimer = setTimeout(() => {
      if (
        !window ||
        window.isDestroyed() ||
        window.isFullScreen() ||
        window.isMaximized() ||
        displayUpdating ||
        !manualResize
      )
        return;
      const [width, height] = window.getContentSize();
      manualResize = false;
      preferences = { fullscreen: false, width, height };
      savePreferences();
    }, 250);
  });
  window.on("close", (event) => {
    if (!quitting) {
      event.preventDefault();
      requestQuit();
    }
  });
  window.once("ready-to-show", () => {
    if (preferences.fullscreen) window.show();
    else
      void applyDisplay(preferences)
        .catch((error) =>
          console.error("Display change failed:", error.message),
        )
        .then(() => {
          if (!window.isDestroyed()) window.show();
        });
  });
  await window.loadURL(APP_URL);
  let previousSteamState = JSON.stringify(steam.state());
  const steamTimer = setInterval(() => {
    steam.refreshActivity();
    steam.refreshAchievements();
    const next = JSON.stringify(steam.state());
    if (next !== previousSteamState) {
      previousSteamState = next;
      publishState();
      void steam.flushScores();
    }
  }, 5000);
  steamTimer.unref();
  window.once("closed", () => {
    clearInterval(steamTimer);
    clearTimeout(resizeTimer);
  });
}

if (!primaryInstance) app.quit();
else {
  app.on("second-instance", (_event, args) => {
    const lobbyId = lobbyFromArgs(args);
    if (lobbyId && steam.multiplayer) {
      steam.multiplayer.pendingInvite = lobbyId;
      if (window && !window.isDestroyed())
        window.webContents.send("desktop:multiplayer-event", {
          kind: "invite",
          lobbyId,
        });
    }
    if (window) {
      if (window.isMinimized()) window.restore();
      window.focus();
    }
  });
  app.on("before-quit", (event) => {
    if (!quitting && window && !window.isDestroyed()) {
      event.preventDefault();
      requestQuit();
    }
  });
  app
    .whenReady()
    .then(createWindow)
    .catch((error) => {
      console.error("Electrify startup failed:", error);
      dialog.showErrorBox("Electrify could not start", error.message);
      quitting = true;
      app.quit();
    });
  app.on("window-all-closed", () => {
    if (quitting) app.quit();
  });
}
