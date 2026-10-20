const { test } = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const settle = () => new Promise(setImmediate);

/** Run the real main entry point without loading Electron or opening a native window. */
async function startup(
  t,
  { preferences = null, rejectFirstEntry = false } = {},
) {
  const created = Promise.withResolvers();
  const shown = Promise.withResolvers();
  const failed = Promise.withResolvers();
  const calls = [];
  const writes = [];
  const errors = [];
  const handlers = new Map();
  const appRoot = path.resolve(".tmp", "main-startup-app");
  const display = { workAreaSize: { width: 1920, height: 1080 } };
  let game;

  class BrowserWindow extends EventEmitter {
    constructor(options) {
      super();
      game = this;
      this.visible = options.show !== false;
      this.fullscreen = false;
      this.destroyed = false;
      // Native initial content can differ from requested constructor bounds.
      this.size = [1100, 800];
      this.webContents = Object.assign(new EventEmitter(), {
        mainFrame: { url: "electrify://app/index.html" },
        setWindowOpenHandler() {},
        send() {},
      });
      calls.push({ kind: "construct", visible: this.visible });
      // A hidden macOS window does not confirm the constructor's fullscreen intent.
      if (options.fullscreen) this.requestFullscreen(true, "constructor");
      created.resolve(this);
    }
    setMenu() {}
    loadURL() {
      return Promise.resolve();
    }
    isDestroyed() {
      return this.destroyed;
    }
    isFullScreen() {
      return this.fullscreen;
    }
    isFocused() {
      return this.visible;
    }
    getBounds() {
      return { x: 0, y: 0, width: this.size[0], height: this.size[1] };
    }
    getContentSize() {
      return [...this.size];
    }
    setContentSize(width, height) {
      calls.push({ kind: "resize", visible: this.visible, width, height });
      this.size = [width, height];
    }
    unmaximize() {}
    center() {}
    show() {
      this.visible = true;
      calls.push({ kind: "show", size: this.getContentSize() });
      shown.resolve();
    }
    requestFullscreen(fullscreen, source) {
      calls.push({
        kind: "fullscreen",
        fullscreen,
        source,
        visible: this.visible,
      });
      if (!this.visible) return;
      if (fullscreen && rejectFirstEntry) {
        rejectFirstEntry = false;
        throw new Error("Native startup entry rejected");
      }
      this.pendingFullscreen = fullscreen;
    }
    setFullScreen(fullscreen) {
      this.requestFullscreen(fullscreen, "method");
    }
    completeFullscreen(fullscreen) {
      assert.equal(this.visible, true);
      assert.equal(
        this.pendingFullscreen,
        fullscreen,
        "Native completion needs a visible request",
      );
      this.pendingFullscreen = undefined;
      this.fullscreen = fullscreen;
      this.emit(fullscreen ? "enter-full-screen" : "leave-full-screen");
    }
    destroy() {
      if (this.destroyed) return;
      this.destroyed = true;
      this.emit("closed");
    }
  }

  const app = Object.assign(new EventEmitter(), {
    isPackaged: true,
    enableSandbox() {},
    getAppPath: () => appRoot,
    getPath: () => path.join(appRoot, "profile"),
    requestSingleInstanceLock: () => true,
    whenReady: () => Promise.resolve(),
    quit() {},
  });
  const ipcMain = Object.assign(new EventEmitter(), {
    handle: (channel, callback) => handlers.set(channel, callback),
  });
  class SteamService {
    state() {
      return { online: false };
    }
    initialize() {}
    configureScoreQueue() {}
    configureAchievements() {}
    configureInput() {}
    setInputEnabled() {}
    flushScores() {}
  }
  const electron = {
    app,
    BrowserWindow,
    ipcMain,
    dialog: { showErrorBox: (_title, error) => errors.push(error) },
    protocol: { registerSchemesAsPrivileged() {} },
    screen: {
      getPrimaryDisplay: () => display,
      getDisplayMatching: () => display,
    },
    session: {
      fromPartition: () => ({
        setPermissionRequestHandler() {},
        setPermissionCheckHandler() {},
        webRequest: { onBeforeRequest() {} },
        protocol: { handle() {} },
      }),
    },
    shell: {},
  };
  const dependencies = {
    electron,
    "node:fs": {
      existsSync: (filename) => path.basename(filename) === "index.html",
      readFileSync: () => "<html></html>",
    },
    "./storage.cjs": {
      readJson: () => preferences,
      atomicWrite: (_filename, value) => {
        const saved = JSON.parse(value);
        writes.push(saved);
        calls.push({ kind: "commit", fullscreen: saved.fullscreen });
      },
      DesktopSaveStore: class {
        constructor() {
          this.directory = path.join(appRoot, "saves");
        }
      },
    },
    "./steam.cjs": { SteamService },
    "./steam-multiplayer.cjs": {},
    // Startup may initialize other disk-backed services; keep this fixture windowless
    // and in memory while the real main/display/runtime own the display lifecycle.
    "./mods.cjs": {
      ModStore: class {
        cleanupStages() {
          return Promise.resolve();
        }
      },
    },
    "./steam-workshop.cjs": { SteamWorkshop: class {} },
  };
  const filename = path.join(__dirname, "main.cjs");
  const run = vm.runInNewContext(
    `(function (require, __dirname) { ${fs.readFileSync(filename, "utf8")}\n})`,
    {
      process: {
        argv: [],
        env: {},
        platform: "darwin",
        resourcesPath: appRoot,
      },
      URL,
      setTimeout,
      clearTimeout,
      setInterval: () => ({ unref() {} }),
      clearInterval() {},
      console: {
        error: (...values) => {
          const message = values.map(String).join(" ");
          errors.push(message);
          failed.resolve(message);
        },
      },
    },
    { filename },
  );
  run((name) => dependencies[name] ?? require(name), __dirname);
  t.after(async () => {
    game?.destroy();
    await settle();
  });
  await created.promise;
  await settle();
  return {
    game,
    calls,
    writes,
    errors,
    shown: shown.promise,
    failed: failed.promise,
    request: (channel, ...args) =>
      handlers.get(channel)(
        { sender: game.webContents, senderFrame: game.webContents.mainFrame },
        ...args,
      ),
  };
}

test("main starts fullscreen visibly, confirms native entry, and serializes the next display request", async (t) => {
  const fixture = await startup(t);
  const { game, calls, writes, request } = fixture;
  assert.equal(game.visible, false);
  assert.deepEqual(
    calls,
    [{ kind: "construct", visible: false }],
    "Hidden construction must not request native fullscreen",
  );
  game.emit("ready-to-show");
  await settle();
  assert.deepEqual(calls.slice(1), [
    { kind: "show", size: [1100, 800] },
    { kind: "fullscreen", fullscreen: true, source: "method", visible: true },
  ]);
  assert.equal(game.isFullScreen(), false);
  assert.equal(
    request("desktop:state").display.fullscreen,
    true,
    "Readiness must retain the requested mode while native entry is pending",
  );
  assert.deepEqual(writes, [], "A request is not a confirmed preference");
  const windowed = request("desktop:display", {
    fullscreen: false,
    width: 1024,
    height: 768,
  });
  await settle();
  assert.equal(calls.filter((call) => call.kind === "fullscreen").length, 1);
  game.completeFullscreen(true);
  await settle();
  assert.deepEqual(
    writes.map((write) => write.fullscreen),
    [true],
  );
  assert.deepEqual(calls.filter((call) => call.kind === "fullscreen").at(-1), {
    kind: "fullscreen",
    fullscreen: false,
    source: "method",
    visible: true,
  });
  game.completeFullscreen(false);
  await windowed;
  assert.equal(game.isFullScreen(), false);
  assert.deepEqual(game.getContentSize(), [1024, 768]);
  assert.deepEqual(
    writes.map((write) => write.fullscreen),
    [true, false],
  );
  assert.deepEqual(fixture.errors, []);
});

test("main restores the saved windowed content size before showing the window", async (t) => {
  const fixture = await startup(t, {
    preferences: { fullscreen: false, width: 1024, height: 768 },
  });
  fixture.game.emit("ready-to-show");
  await settle();
  assert.equal(fixture.game.visible, false);
  await fixture.shown;
  assert.deepEqual(fixture.calls.at(-1), { kind: "show", size: [1024, 768] });
  assert.deepEqual(fixture.writes, [
    { fullscreen: false, width: 1024, height: 768 },
  ]);
  assert.deepEqual(
    fixture.calls.filter((call) => call.kind === "fullscreen"),
    [],
  );
  assert.deepEqual(fixture.errors, []);
});

test("main rolls a rejected first fullscreen entry back to actual windowed state and accepts another request", async (t) => {
  const fixture = await startup(t, { rejectFirstEntry: true });
  assert.equal(
    fixture.calls.some((call) => call.kind === "fullscreen"),
    false,
    "Startup fullscreen belongs to the visible window",
  );
  fixture.game.emit("ready-to-show");
  assert.match(await fixture.failed, /Native startup entry rejected/);
  assert.deepEqual(fixture.writes, [
    { fullscreen: false, width: 1100, height: 800 },
  ]);
  assert.deepEqual(
    fixture.calls.filter((call) => call.kind === "fullscreen"),
    [{ kind: "fullscreen", fullscreen: true, source: "method", visible: true }],
    "Rollback must not retry an unconfirmed fullscreen preference",
  );
  assert.equal(fixture.request("desktop:state").display.fullscreen, false);
  await fixture.request("desktop:display", {
    fullscreen: false,
    width: 800,
    height: 600,
  });
  assert.deepEqual(fixture.game.getContentSize(), [800, 600]);
  assert.equal(fixture.game.visible, true);
});
