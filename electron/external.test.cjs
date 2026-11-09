const { test } = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { hostEnvironment, openExternalUrl } = require("./external.cjs");

test("programs opened from the Linux depot do not inherit its bundled NSS libraries", () => {
  const lib = "/games/Electrify/lib";
  assert.deepEqual(
    hostEnvironment({
      ELECTRIFY_RUNTIME_LIB: lib,
      LD_LIBRARY_PATH: `${lib}:/steam/runtime/lib`,
      HOME: "/home/player",
    }),
    { LD_LIBRARY_PATH: "/steam/runtime/lib", HOME: "/home/player" },
  );
  assert.deepEqual(
    hostEnvironment({ ELECTRIFY_RUNTIME_LIB: lib, LD_LIBRARY_PATH: lib }),
    {},
  );
  // Without the launcher's marker nothing is removed.
  assert.deepEqual(hostEnvironment({ LD_LIBRARY_PATH: lib }), {
    LD_LIBRARY_PATH: lib,
  });
});

test("Linux depot builds open links through xdg-open with the host environment", () => {
  const opened = [];
  const shell = { openExternal: (href) => opened.push(["shell", href]) };
  const env = {
    ELECTRIFY_RUNTIME_LIB: "/depot/lib",
    LD_LIBRARY_PATH: "/depot/lib",
  };
  const href = "https://electrifygame.com/";
  let child;
  openExternalUrl(shell, href, {
    env,
    platform: "linux",
    launch: (command, args, options) => {
      opened.push([command, ...args, options.env.LD_LIBRARY_PATH]);
      child = Object.assign(new EventEmitter(), { unref: () => {} });
      return child;
    },
  });
  assert.deepEqual(opened, [["xdg-open", href, undefined]]);
  // A missing xdg-open falls back to Electron's own opener.
  child.emit("error", new Error("ENOENT"));
  assert.deepEqual(opened.at(-1), ["shell", href]);
  for (const options of [
    { env, platform: "darwin" },
    { env: {}, platform: "linux" },
  ]) {
    opened.length = 0;
    openExternalUrl(shell, href, {
      ...options,
      launch: () => assert.fail("must not spawn"),
    });
    assert.deepEqual(opened, [["shell", href]]);
  }
});
