const { test } = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const {
  waitForFullscreen,
  setFullscreen,
  applyNativeDisplay,
  applyConfirmedDisplay,
  createDisplayQueue,
} = require("./display.cjs");

function fixture() {
  const window = new EventEmitter();
  window.isDestroyed = () => false;
  window.isFullScreen = () => !!window.fullscreen;
  window.setFullScreen = (fullscreen) => {
    window.requested = fullscreen;
  };
  return window;
}

test("startup readiness waits for delayed native fullscreen entry without requesting it", async () => {
  const window = fixture();
  let completed = false;
  const ready = waitForFullscreen(window, true).then(() => {
    completed = true;
  });
  // A loaded renderer can be visible while macOS is still entering fullscreen.
  await Promise.resolve();
  assert.equal(completed, false);
  assert.equal(
    window.requested,
    undefined,
    "Observation must not repair startup",
  );
  window.fullscreen = true;
  window.emit("enter-full-screen");
  await ready;
  assert.equal(completed, true);
  assert.equal(window.requested, undefined);
  assert.equal(window.listenerCount("enter-full-screen"), 0);
  assert.equal(window.listenerCount("closed"), 0);
});

test("startup readiness accepts settled fresh and saved modes without waiting for another event", async () => {
  for (const fullscreen of [true, false]) {
    const window = fixture();
    window.fullscreen = fullscreen;
    await waitForFullscreen(window, fullscreen);
    assert.equal(window.requested, undefined);
    assert.equal(window.eventNames().length, 0);
  }
});

test("startup readiness rejects a missing native transition and cleans up after close", async () => {
  const window = fixture();
  await assert.rejects(waitForFullscreen(window, true, 5), /timed out/);
  assert.equal(window.requested, undefined);
  assert.equal(window.eventNames().length, 0);
  const closing = waitForFullscreen(window, true);
  window.emit("closed");
  await closing;
  assert.equal(window.eventNames().length, 0);
});

test("macOS fullscreen entry finishes before a subsequent queued exit", async () => {
  const window = fixture();
  let completed = false;
  const entering = setFullscreen(window, true).then(() => {
    completed = true;
  });
  await Promise.resolve();
  assert.equal(completed, false);
  window.fullscreen = true;
  window.emit("enter-full-screen");
  await entering;
  const leaving = setFullscreen(window, false);
  assert.equal(window.requested, false);
  window.fullscreen = false;
  window.emit("leave-full-screen");
  await leaving;
  assert.equal(window.listenerCount("enter-full-screen"), 0);
  assert.equal(window.listenerCount("leave-full-screen"), 0);
  assert.equal(window.listenerCount("closed"), 0);
});

test("closed fullscreen transitions release listeners, and missing transitions reject", async () => {
  const window = fixture();
  const closed = setFullscreen(window, true);
  window.emit("closed");
  await closed;
  assert.equal(window.listenerCount("enter-full-screen"), 0);
  await assert.rejects(setFullscreen(window, true, 5), /timed out/);
  assert.equal(window.listenerCount("enter-full-screen"), 0);
  assert.equal(window.listenerCount("closed"), 0);
});

function nativeFixture(fullscreen = false) {
  const window = fixture();
  window.fullscreen = fullscreen;
  window.size = [1024, 720];
  window.getContentSize = () => window.size;
  window.setFullScreen = (next) => {
    window.fullscreen = next;
    window.emit(next ? "enter-full-screen" : "leave-full-screen");
  };
  window.unmaximize = () => {};
  window.setContentSize = (width, height) => {
    window.size = [width, height];
  };
  window.center = () => {};
  return window;
}

test("display preferences commit only after the asynchronous native operation succeeds", async () => {
  const window = nativeFixture();
  const previous = { fullscreen: true, width: 1024, height: 720 };
  const next = { fullscreen: false, width: 800, height: 600 };
  let finish;
  const applied = new Promise((resolve) => {
    finish = resolve;
  });
  const commits = [];
  const change = applyConfirmedDisplay(
    window,
    previous,
    next,
    (value) => commits.push(value),
    () => applied,
  );
  await Promise.resolve();
  assert.deepEqual(commits, [], "A pending request must not be persisted");
  finish(next);
  assert.deepEqual(await change, next);
  assert.deepEqual(commits, [next]);
});

test("a sizing failure after leaving fullscreen restores the previous confirmed preference", async () => {
  const window = nativeFixture(true);
  const previous = { fullscreen: true, width: 1024, height: 720 };
  const next = { fullscreen: false, width: 800, height: 600 };
  window.setContentSize = () => {
    throw new Error("Native resize failed");
  };
  const commits = [];
  await assert.rejects(
    applyConfirmedDisplay(window, previous, next, (value) =>
      commits.push(value),
    ),
    /Native resize failed/,
  );
  assert.equal(window.isFullScreen(), true);
  assert.deepEqual(
    commits,
    [previous],
    "The rejected windowed intent must never reach the preference file",
  );
});

test("failed persistence rolls back the applied window before reporting the error", async () => {
  const window = nativeFixture(true);
  const previous = { fullscreen: true, width: 1024, height: 720 };
  const next = { fullscreen: false, width: 800, height: 600 };
  const commits = [];
  await assert.rejects(
    applyConfirmedDisplay(
      window,
      previous,
      next,
      (value) => {
        if (value === next) throw new Error("Preference disk write failed");
        commits.push(value);
      },
      (native, value) =>
        applyNativeDisplay(native, value, () => Promise.resolve()),
    ),
    /disk write failed/,
  );
  assert.equal(window.isFullScreen(), true);
  assert.deepEqual(commits, [previous]);
});

test("if rollback also fails, the OS's actual state replaces the rejected preference", async () => {
  const window = nativeFixture();
  window.size = [900, 650];
  const previous = { fullscreen: true, width: 1024, height: 720 };
  const next = { fullscreen: false, width: 800, height: 600 };
  const commits = [];
  await assert.rejects(
    applyConfirmedDisplay(
      window,
      previous,
      next,
      (value) => commits.push(value),
      async () => {
        throw new Error("Native transition unavailable");
      },
    ),
    /unavailable/,
  );
  assert.deepEqual(commits, [{ fullscreen: false, width: 900, height: 650 }]);
});

test("fractional-DPI centering is corrected before committing the requested resolution", async () => {
  const window = nativeFixture();
  const next = { fullscreen: false, width: 800, height: 600 };
  window.center = () => {
    window.size = [802, 602];
  };
  const commits = [];
  await applyConfirmedDisplay(
    window,
    { fullscreen: true, width: 1024, height: 720 },
    next,
    (value) => commits.push(value),
    (native, value) =>
      applyNativeDisplay(native, value, () => Promise.resolve()),
  );
  assert.deepEqual(window.getContentSize(), [800, 600]);
  // This fixture has no native rounding: the next measured pass compensates
  // the first correction and returns to the exact requested content size.
  assert.deepEqual(commits, [next]);
});

test("a rejected native fullscreen request reports failure and releases listeners", async () => {
  const window = fixture();
  window.setFullScreen = () => {
    throw new Error("Native transition unavailable");
  };
  await assert.rejects(setFullscreen(window, true), /unavailable/);
  assert.equal(window.listenerCount("enter-full-screen"), 0);
  assert.equal(window.listenerCount("closed"), 0);
});

test("rapid fullscreen shortcuts toggle pending intent while native transitions stay serialized", async () => {
  const initial = { fullscreen: true, width: 1024, height: 720 };
  let confirmed = initial;
  let release;
  const firstTransition = new Promise((resolve) => {
    release = resolve;
  });
  const calls = [];
  const queue = createDisplayQueue(async (next) => {
    calls.push(next.fullscreen);
    if (calls.length === 1) await firstTransition;
    confirmed = next;
  });
  const toggle = () => {
    const intended = queue.intended(confirmed);
    return queue.apply({ ...intended, fullscreen: !intended.fullscreen });
  };
  const first = toggle();
  const second = toggle();
  await Promise.resolve();
  await Promise.resolve();
  assert.deepEqual(calls, [false]);
  assert.equal(queue.intended(confirmed).fullscreen, true);
  release();
  await Promise.all([first, second]);
  assert.deepEqual(calls, [false, true]);
  assert.equal(confirmed.fullscreen, true);
  assert.equal(queue.intended(initial), initial);
});

test("a failed display request does not strand the next queued native change", async () => {
  const initial = { fullscreen: true, width: 1024, height: 720 };
  const next = { fullscreen: false, width: 800, height: 600 };
  const queue = createDisplayQueue(async (requested) => {
    if (requested === initial) throw new Error("First change rejected");
    return requested;
  });
  const failed = queue.apply(initial);
  const following = queue.apply(next);
  assert.equal(queue.intended(initial), next);
  await assert.rejects(failed, /rejected/);
  assert.deepEqual(await following, next);
  assert.equal(queue.intended(initial), initial);
});

test("quit drains pending confirmed display writes and blocks later settings until cancelled", async () => {
  const requested = { fullscreen: false, width: 800, height: 600 };
  let finish;
  const pending = new Promise((resolve) => {
    finish = resolve;
  });
  const writes = [];
  const queue = createDisplayQueue(async (next) => {
    await pending;
    writes.push(next);
  });
  const changing = queue.apply(requested);
  queue.pause();
  await assert.rejects(queue.apply({ ...requested, width: 900 }), /closing/);
  let quit = false;
  const quitting = queue.drain().then(() => {
    quit = true;
  });
  await Promise.resolve();
  assert.equal(quit, false);
  assert.deepEqual(writes, []);
  finish();
  await Promise.all([changing, quitting]);
  assert.deepEqual(writes, [requested]);
  assert.equal(quit, true);
  await assert.rejects(queue.apply({ ...requested, width: 900 }), /closing/);
  queue.resume();
  await queue.apply({ ...requested, width: 900 });
  assert.equal(writes[1].width, 900);
});

test("a rejected display operation is settled for quit after its failure was reported", async () => {
  const queue = createDisplayQueue(async () => {
    throw new Error("Native transition failed");
  });
  const changing = queue.apply({ fullscreen: false, width: 800, height: 600 });
  const quitting = queue.drain();
  await assert.rejects(changing, /Native transition failed/);
  await assert.doesNotReject(quitting);
});
