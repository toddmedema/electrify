const { test } = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter, once } = require("node:events");
const { spawn } = require("node:child_process");
const { runInNewContext } = require("node:vm");
const { desktopDeadline, closeDesktop } = require("./desktop-process");
const {
  restoreFocusBeforeClosingProbe,
} = require("../../e2e/desktop-focus.ts");
// Playwright serializes this callback into Electron's main process. Exercise that
// same boundary so importing a host-only helper cannot silently break native QA.
const restoreFocus = runInNewContext(
  `(${restoreFocusBeforeClosingProbe.toString()})`,
  { setTimeout, clearTimeout },
);

function focusWindows(activate) {
  let focused = false;
  let deliveringFocus = false;
  let destroyed = false;
  const game = Object.assign(new EventEmitter(), {
    isDestroyed: () => false,
    isFocused: () => focused,
    focus: () =>
      activate(() => {
        focused = true;
        deliveringFocus = true;
        game.emit("focus");
        // Native event dispatch may drain JS microtasks before returning to AppKit.
        queueMicrotask(() => {
          deliveringFocus = false;
        });
      }),
  });
  const probe = {
    isDestroyed: () => destroyed,
    isFocused: () => !focused,
    destroy: () => {
      assert.equal(focused, true, "cannot destroy the current key window");
      assert.equal(
        deliveringFocus,
        false,
        "native focus delivery must unwind first",
      );
      destroyed = true;
    },
  };
  const electron = {
    app: { focus() {} },
    BrowserWindow: { fromId: (id) => (id === 1 ? game : probe) },
  };
  return { electron, game, probe };
}

test("native focus settles on the game before the focus probe can be destroyed", async () => {
  const { electron, game, probe } = focusWindows((activate) =>
    setImmediate(activate),
  );
  await restoreFocus(electron, { game: 1, probe: 2 });
  assert.equal(game.isFocused(), true);
  assert.equal(probe.isDestroyed(), true);
  assert.equal(game.listenerCount("focus"), 0);
  assert.equal(game.listenerCount("closed"), 0);
});

test("a failed native handoff leaves the focused probe alive for process cleanup", async () => {
  const { electron, game, probe } = focusWindows(() => {});
  await assert.rejects(
    restoreFocus(electron, { game: 1, probe: 2 }, 20),
    /did not regain native focus/,
  );
  assert.equal(probe.isDestroyed(), false);
  assert.equal(game.listenerCount("focus"), 0);
  assert.equal(game.listenerCount("closed"), 0);
});

async function stalledDesktop(t) {
  const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
    stdio: "ignore",
    windowsHide: true,
  });
  await once(child, "spawn");
  t.after(() => {
    if (child.exitCode === null && child.signalCode === null)
      child.kill("SIGKILL");
  });
  return {
    nativeProcess: child,
    isClosed: () => false,
    app: {
      process: () =>
        assert.fail("Process ownership must be captured at launch"),
      close: () => new Promise(() => {}),
    },
  };
}

test(
  "unresponsive diagnostics cannot prevent a failed desktop test from reaping Electron",
  { timeout: 2000 },
  async (t) => {
    const app = await stalledDesktop(t);
    let diagnostic;
    try {
      diagnostic = await desktopDeadline(
        "Native diagnostics",
        () => new Promise(() => {}),
        20,
      ).catch((error) => ({ unavailable: error.message }));
    } finally {
      await closeDesktop(app, { force: true, timeoutMs: 100 });
    }
    assert.match(diagnostic.unavailable, /Native diagnostics did not finish/);
    assert.equal(app.nativeProcess.signalCode, "SIGKILL");
  },
);

test(
  "a stalled graceful quit fails the test and still reaps the process",
  { timeout: 2000 },
  async (t) => {
    const app = await stalledDesktop(t);
    await assert.rejects(
      closeDesktop(app, { timeoutMs: 100 }),
      /Closing Electron did not finish/,
    );
    assert.equal(app.nativeProcess.signalCode, "SIGKILL");
  },
);

test("deadline preserves the original rejection", async () => {
  const failure = new Error("Renderer disconnected");
  await assert.rejects(
    desktopDeadline("Diagnostic", () => Promise.reject(failure)),
    (error) => error === failure,
  );
});

test("cleanup is harmless after a test has already quit the application", async () => {
  await closeDesktop({
    nativeProcess: { exitCode: 0, signalCode: null },
    isClosed: () => true,
    app: {
      process: () => {
        throw new TypeError(
          "Cannot read properties of undefined (reading '_object')",
        );
      },
      close: () =>
        assert.fail("An exited application needs no second quit RPC"),
    },
  });
});

test("a disposed app can finish exiting without another Playwright RPC", async () => {
  const child = Object.assign(new EventEmitter(), {
    exitCode: null,
    signalCode: null,
  });
  setImmediate(() => {
    child.exitCode = 0;
    child.emit("exit", 0);
  });
  await closeDesktop({
    nativeProcess: child,
    isClosed: () => true,
    app: {
      process: () => assert.fail("The app proxy is disposed"),
      close: () => assert.fail("The app proxy is disposed"),
    },
  });
  assert.equal(child.exitCode, 0);
});
