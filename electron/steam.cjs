const {
  boardName,
  loadFunctions,
  loadTimelineFunctions,
  initializeBinding,
  SteamLeaderboards,
} = require("./steam-native.cjs");
const { atomicWrite, readJson } = require("./storage.cjs");
const {
  validateScore,
  validateActivity,
  validateTimelineEvent,
} = require("./runtime.cjs");
const { SteamActivity } = require("./steam-activity.cjs");
const fs = require("node:fs");
const path = require("node:path");
const {
  SteamNativeDialogs,
  loadDialogFunctions,
} = require("./steam-dialog.cjs");
const { SteamDispatcher } = require("./steam-dispatch.cjs");
const { SteamAchievements } = require("./steam-achievements.cjs");
const {
  SteamInput,
  loadInputFunctions,
  validateInputContext,
} = require("./steam-input.cjs");
const {
  SteamTextInput,
  loadTextInputFunctions,
  validateTextInput,
} = require("./steam-text-input.cjs");

const CLOUD_PREFIX = /^electrify\/device-[a-f0-9]{32}\.json$/;
const MAX_CLOUD_FILE_BYTES = 100 * 1024 * 1024;

class SteamService {
  constructor() {
    this.client = null;
    this.leaderboards = null;
    this.identity = {};
    this.pending = [];
    this.overlayActive = false;
  }

  initialize(app, config, disabled = false) {
    app.on("will-quit", () => {
      this.multiplayer?.dispose();
      this.achievements?.dispose();
      this.activity?.dispose();
      this.input?.dispose();
      this.textInput?.dispose();
      this.dialogs?.dispose();
      this.stopped = true;
      this.leaderboards?.dispose();
      this.dispatcher?.dispose();
      if (this.client) {
        try {
          this.native?.shutdown();
          this.client = null;
        } catch {
          // Electron is exiting; durable files were completed by the quit handshake.
        }
      }
    });
    if (config.mode !== "steam" || disabled) return;
    try {
      const steamworks = require("steamworks.js");
      if (app.isPackaged && steamworks.restartAppIfNecessary(config.appId)) {
        app.exit(0);
        return;
      }
      // Configure the overlay before Chromium creates its graphics context. The binding
      // forces repaint while idle, as required for Steam's overlay with a browser UI.
      steamworks.electronEnableSteamOverlay();
      this.client = initializeBinding(config.appId);
      this.identity = {
        steamId: this.client.localplayer.getSteamId().steamId64.toString(),
        displayName: this.client.localplayer.getName(),
      };
      this.native = loadFunctions();
      this.user = this.native.user();
      this.activity = new SteamActivity(
        this.native,
        loadTimelineFunctions(),
        () => this.state().online,
      );
      this.setActivity({ phase: "menu", timelineEnabled: false });
      this.dispatcher = new SteamDispatcher(
        this.native,
        (active) => {
          this.overlayActive = active;
          this.onOverlayChanged?.(active);
        },
        (error) => {
          this.textInput?.dispose();
          this.overlayActive = false;
          this.onOverlayChanged?.(false);
          console.warn(`Steam callbacks unavailable: ${error.message}`);
        },
      );
      this.dispatcher.start();
      try {
        this.textInput = new SteamTextInput(
          loadTextInputFunctions(),
          this.dispatcher,
          () => this.onOverlayChanged?.(this.overlayActive),
        );
      } catch (error) {
        console.warn(`Steam text input unavailable: ${error.message}`);
      }
      this.dialogs = new SteamNativeDialogs(
        loadDialogFunctions(),
        () => this.onOverlayChanged?.(this.overlayActive),
        (error) =>
          console.warn(
            `Steam native dialog input unavailable: ${error.message}`,
          ),
      );
      this.leaderboards = new SteamLeaderboards(this.native, this.dispatcher);
    } catch (error) {
      console.warn(
        `Steam unavailable; continuing with local saves: ${error.message}`,
      );
      // Successful identity/cloud initialization remains useful if a leaderboard interface fails.
      if (!this.identity.steamId) this.client = null;
    }
  }

  withNativeDialog(open) {
    return this.dialogs ? this.dialogs.run(open) : open();
  }

  state() {
    if (this.stopped)
      return {
        available: false,
        online: false,
        cloudEnabled: false,
        timelineSupported: false,
        ...this.identity,
      };
    let online = false;
    let cloudEnabled = false;
    try {
      online = !!this.native && !!this.user && this.native.online(this.user);
      cloudEnabled =
        !!this.client?.cloud.isEnabledForAccount() &&
        !!this.client?.cloud.isEnabledForApp();
    } catch {
      // Losing the Steam client must never disable local play.
    }
    return {
      available: !!this.client,
      online,
      cloudEnabled,
      timelineSupported: !!this.activity?.supported,
      ...this.identity,
    };
  }

  configureInput(manifest, publish) {
    if (!this.client || this.stopped) return;
    try {
      this.input = new SteamInput(
        loadInputFunctions(),
        manifest,
        publish,
        (error) => console.warn(`Steam Input unavailable: ${error.message}`),
      );
      this.input.start();
    } catch (error) {
      console.warn(`Steam Input unavailable: ${error.message}`);
    }
  }

  setInputContext(context) {
    validateInputContext(context);
    return (
      this.input?.setContext(context) ?? {
        connected: false,
        actions: [],
        glyphs: {},
      }
    );
  }

  setInputEnabled(enabled) {
    this.input?.setEnabled(enabled && !this.stopped && !this.textInput?.active);
  }

  showTextInput(input) {
    validateTextInput(input);
    return (
      this.textInput?.show(input) ?? Promise.resolve({ status: "unavailable" })
    );
  }

  cloudState() {
    const state = this.state();
    if (!state.available || !state.cloudEnabled) return "disabled";
    return state.online ? "ready" : "offline";
  }

  readCloudLibraries(kind = "solo") {
    const prefix =
      kind === "coop"
        ? /^electrify\/co-op-device-[a-f0-9]{32}\.json$/
        : CLOUD_PREFIX;
    const files = this.client.cloud
      .listFiles()
      .filter((file) => prefix.test(file.name));
    if (files.length > 128)
      throw new Error("Too many Steam Cloud device libraries");
    let bytes = 0;
    return files.map((file) => {
      const size = Number(file.size);
      bytes += size;
      if (
        !Number.isSafeInteger(size) ||
        size < 0 ||
        size > MAX_CLOUD_FILE_BYTES ||
        bytes > 256 * 1024 * 1024
      )
        throw new Error("Steam Cloud library is too large");
      return this.client.cloud.readFile(file.name);
    });
  }

  writeCloudLibrary(name, json, kind = "solo") {
    const prefix =
      kind === "coop"
        ? /^electrify\/co-op-device-[a-f0-9]{32}\.json$/
        : CLOUD_PREFIX;
    if (!prefix.test(name) || Buffer.byteLength(json) > MAX_CLOUD_FILE_BYTES)
      throw new Error("Steam Cloud library is too large");
    return this.client.cloud.writeFile(name, json);
  }

  configureScoreQueue(directory) {
    this.queueFile = path.join(directory, "pending-scores.json");
    try {
      const pending = readJson(this.queueFile, []);
      if (!Array.isArray(pending) || pending.length > 1024)
        throw new Error("Invalid pending Steam scores");
      this.pending = pending.map(validateScore);
    } catch {
      // An invalid queue must not keep players out of the game or destroy recovery evidence.
      this.pending = [];
      try {
        if (fs.existsSync(this.queueFile))
          fs.copyFileSync(
            this.queueFile,
            `${this.queueFile}.invalid-${Date.now()}`,
          );
        const previous = readJson(`${this.queueFile}.previous`, []);
        if (Array.isArray(previous) && previous.length <= 1024)
          this.pending = previous.map(validateScore);
      } catch {
        // A queue is optional; local game saves remain usable when even its backup is invalid.
      }
    }
  }

  configureAchievements(directory, appId) {
    this.achievements = new SteamAchievements(
      path.join(directory, "achievements.json"),
      this.native,
      this.dispatcher,
      appId,
      this.identity.steamId,
    );
    this.achievements.refresh();
  }

  submitAchievements(intent) {
    if (!this.stopped) this.achievements?.add(intent);
  }

  readAchievements() {
    const data = this.achievements?.data;
    return {
      version: 1,
      earned: [...(data?.earned ?? [])],
      tutorials: [...(data?.tutorials ?? [])],
      wins: [...(data?.wins ?? [])],
    };
  }

  refreshAchievements() {
    if (!this.stopped) this.achievements?.refresh();
  }

  async submitScore(selection) {
    const key = boardName(selection);
    const existing = this.pending.findIndex(
      (entry) => boardName(entry) === key,
    );
    if (existing < 0) this.pending.push(selection);
    else if (this.pending[existing].score < selection.score)
      this.pending[existing] = selection;
    if (this.pending.length > 1024)
      throw new Error("Too many pending Steam scores");
    atomicWrite(this.queueFile, JSON.stringify(this.pending));
    await this.flushScores();
  }

  async flushScores() {
    if (this.flushing) return this.flushing;
    if (!this.state().online || !this.leaderboards) return;
    this.flushing = (async () => {
      // Keep requests after failures for retry at the next leaderboard visit or submission.
      while (this.pending.length && this.state().online) {
        const selection = this.pending[0];
        try {
          await this.leaderboards.upload(selection);
        } catch {
          break;
        }
        const index = this.pending.indexOf(selection);
        if (index >= 0) this.pending.splice(index, 1);
        atomicWrite(this.queueFile, JSON.stringify(this.pending));
      }
    })().finally(() => {
      this.flushing = null;
    });
    return this.flushing;
  }

  async getLeaderboard(selection) {
    if (!this.state().online || !this.leaderboards)
      throw new Error(
        "Steam scores are unavailable offline. Your completed scores are saved locally.",
      );
    await this.flushScores();
    return this.leaderboards.read(selection);
  }

  openFriends() {
    if (!this.client) throw new Error("The Steam overlay is unavailable");
    this.client.overlay.activateDialog(0);
  }

  setActivity(input) {
    const activity = validateActivity(input);
    if (!this.stopped) this.activity?.setActivity(activity);
  }

  addTimelineEvent(input) {
    const event = validateTimelineEvent(input);
    if (!this.stopped) this.activity?.addEvent(event);
  }

  refreshActivity() {
    if (!this.stopped) this.activity?.refresh();
  }
}

module.exports = { SteamService, CLOUD_PREFIX, MAX_CLOUD_FILE_BYTES };
