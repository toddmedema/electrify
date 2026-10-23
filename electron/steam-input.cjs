const fs = require("node:fs");
const path = require("node:path");
const { nativeLibraryPath } = require("./steam-native.cjs");

const MENU_ACTIONS = ["up", "down", "left", "right", "confirm", "back"];
const ACTION_SETS = {
  Menu: MENU_ACTIONS,
  Gameplay: [
    ...MENU_ACTIONS,
    "pause",
    "speedUp",
    "speedDown",
    "previousPane",
    "nextPane",
    "build",
    "previousChart",
    "nextChart",
  ],
};
const DIRECTIONS = new Set(["up", "down", "left", "right"]);

// Match the SteamInput006 flat ABI in the SDK bundled with steamworks.js 0.4.0.
// In particular, Init and RunFrame both take a bool, unlike the older web docs.
// https://github.com/Noxime/steamworks-rs/blob/fbb79635b06b4feea8261e5ca3e8ea3ef42facf9/steamworks-sys/lib/steam/public/steam/steam_api_flat.h
const INPUT_DECLARATIONS = {
  input: "void * SteamAPI_SteamInput_v006()",
  init: "bool SteamAPI_ISteamInput_Init(void *, bool)",
  shutdown: "bool SteamAPI_ISteamInput_Shutdown(void *)",
  manifest:
    "bool SteamAPI_ISteamInput_SetInputActionManifestFilePath(void *, const char *)",
  runFrame: "void SteamAPI_ISteamInput_RunFrame(void *, bool)",
  controllers:
    "int SteamAPI_ISteamInput_GetConnectedControllers(void *, void *)",
  actionSet:
    "uint64_t SteamAPI_ISteamInput_GetActionSetHandle(void *, const char *)",
  activate:
    "void SteamAPI_ISteamInput_ActivateActionSet(void *, uint64_t, uint64_t)",
  action:
    "uint64_t SteamAPI_ISteamInput_GetDigitalActionHandle(void *, const char *)",
  origins:
    "int SteamAPI_ISteamInput_GetDigitalActionOrigins(void *, uint64_t, uint64_t, uint64_t, void *)",
  label:
    "const char * SteamAPI_ISteamInput_GetStringForActionOrigin(void *, int)",
  glyph:
    "const char * SteamAPI_ISteamInput_GetGlyphPNGForActionOrigin(void *, int, int, uint32_t)",
};

function loadInputFunctions(
  library = require("koffi").load(nativeLibraryPath()),
  koffi = require("koffi"),
) {
  try {
    const api = Object.fromEntries(
      Object.entries(INPUT_DECLARATIONS).map(([key, declaration]) => [
        key,
        library.func(declaration),
      ]),
    );
    api.data = library.func(
      "SteamAPI_ISteamInput_GetDigitalActionData",
      koffi.struct({ bState: "bool", bActive: "bool" }),
      ["void *", "uint64_t", "uint64_t"],
    );
    return api;
  } catch {
    // Controller support is optional, including when an older SDK is installed.
    return null;
  }
}

function validateInputContext(context) {
  if (context !== "Menu" && context !== "Gameplay")
    throw new Error("Invalid Steam Input context");
  return context;
}

function readGlyph(filename) {
  // Only main supplies this SDK-returned path; the renderer cannot request files.
  if (!filename || !path.isAbsolute(filename)) return undefined;
  try {
    if (fs.statSync(filename).size > 128 * 1024) return undefined;
    const data = fs.readFileSync(filename);
    if (!data.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex")))
      return undefined;
    return `data:image/png;base64,${data.toString("base64")}`;
  } catch {
    return undefined;
  }
}

class SteamInput {
  constructor(api, manifest, publish, onError = () => {}, now = Date.now) {
    this.api = api;
    this.publish = publish;
    this.onError = onError;
    this.now = now;
    this.context = "Menu";
    this.enabled = false;
    this.controllers = new Map();
    this.connectedHandles = [];
    this.sets = new Map();
    this.handles = new Map();
    this.glyphCache = new Map();
    this.frame = { connected: false, actions: [], glyphs: {} };
    if (!api) return;
    this.input = api.input();
    if (!this.input || !api.init(this.input, true)) return;
    this.initialized = true;
    try {
      if (!api.manifest(this.input, manifest))
        throw new Error("Steam Input action manifest unavailable");
    } catch (error) {
      this.dispose();
      throw error;
    }
  }

  start() {
    if (!this.initialized || this.timer) return;
    this.timer = setInterval(() => this.poll(), 1000 / 30);
    this.timer.unref();
  }

  setEnabled(enabled) {
    if (this.enabled === enabled) return;
    this.enabled = enabled;
    // A button held over an overlay, focus change or quit cannot activate on return.
    for (const state of this.controllers.values()) state.armed = false;
  }

  setContext(context) {
    validateInputContext(context);
    if (this.context !== context) {
      this.context = context;
      this.controllers.clear();
      this.glyphController = undefined;
      this.nextGlyphRefresh = 0;
      this.glyphsNeedRefresh = true;
      this.glyphs = {};
      this.frame = { ...this.frame, glyphs: {} };
    }
    return { ...this.frame, actions: [] };
  }

  handle(cache, name, getter) {
    if (!cache.has(name)) {
      const handle = getter(this.input, name);
      // Bindings can still be loading when Steam Input starts. Retry missing handles.
      if (handle) {
        cache.set(name, handle);
        this.glyphsNeedRefresh = true;
      }
      return handle;
    }
    return cache.get(name);
  }

  poll() {
    if (!this.initialized) return;
    try {
      this.readFrame();
    } catch (error) {
      if (this.frame.connected)
        this.publish({
          connected: false,
          disconnected: true,
          actions: [],
          glyphs: {},
        });
      this.frame = { connected: false, actions: [], glyphs: {} };
      this.dispose();
      this.onError(error);
    }
  }

  readFrame() {
    const { api, input } = this;
    api.runFrame(input, true);
    const buffer = Buffer.alloc(16 * 8);
    const count = api.controllers(input, buffer);
    if (!Number.isInteger(count) || count < 0 || count > 16)
      throw new Error("Invalid Steam Input controller count");
    const handles = Array.from({ length: count }, (_, index) =>
      buffer.readBigUInt64LE(index * 8),
    ).filter((handle) => handle !== 0n);
    const disconnected = this.connectedHandles.some(
      (handle) => !handles.includes(handle),
    );
    this.connectedHandles = handles;
    for (const handle of this.controllers.keys())
      if (!handles.includes(handle)) this.controllers.delete(handle);
    const actionSet = this.handle(this.sets, this.context, api.actionSet);
    const actions = new Set();
    const now = this.now();
    for (const controller of handles) {
      let state = this.controllers.get(controller);
      if (!state) {
        state = { armed: false, held: new Map() };
        this.controllers.set(controller, state);
        if (actionSet) api.activate(input, controller, actionSet);
        // Activate before the next RunFrame, so the first read sees the new set.
        continue;
      }
      if (!actionSet) continue;
      api.activate(input, controller, actionSet);
      let active = false;
      let held = false;
      for (const action of ACTION_SETS[this.context]) {
        const handle = this.handle(
          this.handles,
          `${this.context}_${action}`,
          api.action,
        );
        if (!handle) continue;
        const data = api.data(input, controller, handle);
        active ||= data.bActive;
        const pressed = data.bActive && data.bState;
        held ||= pressed;
        const repeatAt = state.held.get(action);
        if (
          pressed &&
          this.enabled &&
          state.armed &&
          !disconnected &&
          (repeatAt === undefined ||
            (DIRECTIONS.has(action) && now >= repeatAt))
        ) {
          actions.add(action);
          this.glyphController = controller;
          state.held.set(action, now + (repeatAt === undefined ? 400 : 120));
        } else if (!pressed) state.held.delete(action);
      }
      if (!this.enabled || disconnected) state.armed = false;
      else if (active && !held) state.armed = true;
    }
    const glyphController = handles.includes(this.glyphController)
      ? this.glyphController
      : handles[0];
    if (
      now >= (this.nextGlyphRefresh ?? 0) ||
      this.glyphsNeedRefresh ||
      glyphController !== this.previousGlyphController
    ) {
      const glyphs = this.readGlyphs(glyphController, actionSet);
      // PNG data can be large; compare it only on the throttled origin refresh.
      if (JSON.stringify(glyphs) !== JSON.stringify(this.glyphs))
        this.glyphs = glyphs;
      this.glyphsNeedRefresh = false;
      this.previousGlyphController = glyphController;
      this.nextGlyphRefresh = now + 1000;
    }
    const next = {
      connected: handles.length > 0,
      actions: [],
      glyphs: this.glyphs ?? {},
    };
    const changed =
      next.connected !== this.frame.connected ||
      next.glyphs !== this.frame.glyphs;
    this.frame = next;
    if (actions.size || disconnected || changed) {
      this.publish({
        ...this.frame,
        actions: [...actions],
        ...(disconnected ? { disconnected: true } : {}),
      });
    }
  }

  readGlyphs(controller, actionSet) {
    if (!controller || !actionSet) return {};
    const glyphs = {};
    for (const action of ACTION_SETS[this.context]) {
      const handle = this.handles.get(`${this.context}_${action}`);
      if (!handle) continue;
      const origins = Buffer.alloc(8 * 4);
      const count = this.api.origins(
        this.input,
        controller,
        actionSet,
        handle,
        origins,
      );
      if (count < 1 || count > 8) continue;
      const origin = origins.readInt32LE(0);
      if (!origin) continue;
      const label = this.api.label(this.input, origin)?.slice(0, 128);
      if (!label) continue;
      if (!this.glyphCache.has(origin)) {
        // Medium PNG, dark backing with neutral white symbols (SDK flags 0x2 | 0x10).
        // The default transparent white outlines disappear against the light palette.
        const image = readGlyph(this.api.glyph(this.input, origin, 1, 0x12));
        if (image) {
          if (this.glyphCache.size >= 128)
            this.glyphCache.delete(this.glyphCache.keys().next().value);
          this.glyphCache.set(origin, image);
        }
      }
      const image = this.glyphCache.get(origin);
      glyphs[action] = { label, ...(image ? { image } : {}) };
    }
    return glyphs;
  }

  dispose() {
    clearInterval(this.timer);
    this.timer = undefined;
    if (this.initialized) {
      this.initialized = false;
      try {
        this.api.shutdown(this.input);
      } catch {
        // Steam may have exited before the game.
      }
    }
  }
}

module.exports = {
  SteamInput,
  ACTION_SETS,
  INPUT_DECLARATIONS,
  loadInputFunctions,
  validateInputContext,
  readGlyph,
};
