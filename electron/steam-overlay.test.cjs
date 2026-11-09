const { test } = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const {
  enableSteamOverlay,
  reserveSteamOverlayHotkey,
} = require("./steam-overlay.cjs");
const { SteamService } = require("./steam.cjs");

test("Linux uses X11 before enabling the in-process overlay, avoiding Wayland quit deadlock", () => {
  for (const platform of ["linux", "darwin", "win32"]) {
    const calls = [];
    enableSteamOverlay(
      { commandLine: { appendSwitch: (...args) => calls.push(args) } },
      { electronEnableSteamOverlay: () => calls.push("overlay") },
      platform,
    );
    assert.deepEqual(
      calls,
      platform === "linux"
        ? [["ozone-platform", "x11"], "overlay"]
        : ["overlay"],
    );
  }
});

test("Steam's Shift-Tab is withheld from every renderer while ordinary Tab navigation remains", () => {
  for (const enabled of [true, false]) {
    const app = new EventEmitter();
    reserveSteamOverlayHotkey(app, enabled);
    for (const _view of ["shell", "company"]) {
      const contents = new EventEmitter();
      app.emit("web-contents-created", {}, contents);
      for (const input of [
        { key: "Tab", shift: true, type: "keyDown" },
        { key: "Tab", shift: true, type: "keyUp" },
        { key: "Tab", shift: false },
        { key: "A", shift: true },
      ]) {
        let prevented = false;
        contents.emit(
          "before-input-event",
          {
            preventDefault: () => {
              prevented = true;
            },
          },
          input,
        );
        assert.equal(prevented, enabled && input.key === "Tab" && input.shift);
      }
    }
  }
});

test("overlay requests explain disabled overlays instead of silently succeeding", () => {
  const service = new SteamService();
  assert.throws(() => service.openFriends(), /overlay is unavailable/);
  let opened = 0;
  service.client = { overlay: { activateDialog: () => opened++ } };
  service.native = { utils: () => "utils", overlayEnabled: () => false };
  assert.throws(() => service.openFriends(), /Enable it in Steam/);
  assert.equal(opened, 0);
  service.native.overlayEnabled = () => true;
  service.openFriends();
  assert.equal(opened, 1);
});
