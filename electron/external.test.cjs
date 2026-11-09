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

test("all exact runtime entries are removed while other path entries retain their order", () => {
  const env = {
    ELECTRIFY_RUNTIME_LIB: "/depot/lib",
    LD_LIBRARY_PATH: ":/depot/lib:/host/lib::/depot/lib:/depot/lib-extra:",
  };
  assert.deepEqual(hostEnvironment(env), {
    LD_LIBRARY_PATH: ":/host/lib::/depot/lib-extra:",
  });
  assert.equal(env.ELECTRIFY_RUNTIME_LIB, "/depot/lib");
  assert.deepEqual(
    hostEnvironment({
      ELECTRIFY_RUNTIME_LIB: "/depot/lib",
      LD_LIBRARY_PATH: "/depot/lib::/depot/lib",
    }),
    {},
  );
});

for (const code of [1, 4, null]) {
  for (const response of [0, 1]) {
    test(`xdg-open exit ${code} requires explicit retry (response ${response})`, async () => {
      const opened = [];
      const prompts = [];
      const child = Object.assign(new EventEmitter(), { unref() {} });
      const href = "https://electrifygame.com/";
      openExternalUrl({ openExternal: (url) => opened.push(url) }, href, {
        env: { ELECTRIFY_RUNTIME_LIB: "/depot/lib" },
        platform: "linux",
        launch: () => child,
        dialog: {
          showMessageBox: async (options) => {
            prompts.push(options);
            return { response };
          },
        },
      });
      child.emit("spawn");
      child.emit("exit", code);
      child.emit("error", new Error("late failure"));
      assert.deepEqual(opened, []);
      assert.equal(prompts.length, 1);
      assert.equal(prompts[0].defaultId, 0);
      assert.equal(prompts[0].cancelId, 0);
      await new Promise(setImmediate);
      assert.deepEqual(opened, response === 1 ? [href] : []);
    });
  }
}

test("successful xdg-open exits do not prompt or retry", () => {
  const child = Object.assign(new EventEmitter(), { unref() {} });
  openExternalUrl(
    { openExternal: () => assert.fail("unexpected retry") },
    "https://electrifygame.com/",
    {
      env: { ELECTRIFY_RUNTIME_LIB: "/depot/lib" },
      platform: "linux",
      launch: () => child,
      dialog: { showMessageBox: () => assert.fail("unexpected prompt") },
    },
  );
  child.emit("spawn");
  child.emit("exit", 0);
});
