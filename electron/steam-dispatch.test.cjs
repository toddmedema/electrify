const { test } = require("node:test");
const assert = require("node:assert/strict");
const koffi = require("koffi");
const { SteamDispatcher } = require("./steam-dispatch.cjs");

test("stats callbacks use the sole pump and arrive after the SDK payload is freed", () => {
  const { dispatcher, callbacks, calls } = fixture();
  let copied;
  const stop = dispatcher.onCallback(1102, (payload) => {
    assert.equal(calls.at(-1), "free");
    copied = payload;
  });
  const payload = Buffer.alloc(16);
  payload.writeBigUInt64LE(123n);
  callbacks.push({ id: 1102, payload });
  dispatcher.pump();
  payload.fill(0);
  assert.equal(copied.readBigUInt64LE(0), 123n);
  stop();
  callbacks.push({ id: 1102, payload: Buffer.alloc(16) });
  dispatcher.pump();
  assert.equal(copied.readBigUInt64LE(0), 123n);
  dispatcher.dispose();
});

function fixture(platform = "win32") {
  const callbacks = [];
  const events = [];
  const calls = [];
  let current;
  const api = {
    pipe: () => 42,
    runFrame: (pipe) => {
      assert.equal(pipe, 42);
      calls.push("frame");
    },
    nextCallback: (pipe, message) => {
      assert.equal(pipe, 42);
      assert.equal(
        current,
        undefined,
        "Previous callback must be freed before fetching another",
      );
      assert.equal(message.length, platform === "win32" ? 24 : 20);
      current = callbacks.shift();
      if (!current) return false;
      message.writeInt32LE(8, 0);
      message.writeInt32LE(current.id, 4);
      message.writeBigUInt64LE(koffi.address(current.payload), 8);
      message.writeInt32LE(current.payload.length, 16);
      return true;
    },
    freeCallback: (pipe) => {
      assert.equal(pipe, 42);
      assert(current);
      current = undefined;
      calls.push("free");
    },
    callResult: (pipe, handle, target, bytes, callback, failed) => {
      assert.equal(pipe, 42);
      assert.equal(
        current.id,
        703,
        "Results are read only inside the completion callback",
      );
      assert.equal(current.payload.readBigUInt64LE(0), handle);
      assert.equal(current.payload.readInt32LE(8), callback);
      assert.equal(current.payload.readUInt32LE(12), bytes);
      calls.push(["result", handle, bytes, callback]);
      failed[0] = 0;
      target.writeBigUInt64LE(999n);
      target[8] = 1;
      return true;
    },
  };
  const dispatcher = new SteamDispatcher(
    api,
    (active) => {
      assert.equal(
        current,
        undefined,
        "Overlay event is delivered after freeing native memory",
      );
      events.push(active);
    },
    () => {},
    platform,
  );
  const complete = (
    handle,
    callback = 1104,
    bytes = platform === "win32" ? 16 : 12,
  ) => {
    const payload = Buffer.alloc(16);
    payload.writeBigUInt64LE(handle, 0);
    payload.writeInt32LE(callback, 8);
    payload.writeUInt32LE(bytes, 12);
    callbacks.push({ id: 703, payload });
  };
  return { api, callbacks, events, calls, dispatcher, complete };
}

for (const platform of ["win32", "linux", "darwin"]) {
  test(`sole manual ${platform} pump dispatches overlay open/close and matching leaderboard results`, async () => {
    const { callbacks, events, calls, dispatcher, complete } =
      fixture(platform);
    const size = platform === "win32" ? 16 : 12;
    const pending = dispatcher.callResult(101n, { size, callback: 1104 });
    const open = Buffer.alloc(12);
    open[0] = 1;
    callbacks.push({ id: 331, payload: open });
    complete(101n);
    callbacks.push({ id: 331, payload: Buffer.alloc(12) });
    // Unknown events are acknowledged without invoking a second callback consumer.
    callbacks.push({ id: 999, payload: Buffer.alloc(4) });
    dispatcher.pump();
    assert.equal((await pending).readBigUInt64LE(0), 999n);
    assert.deepEqual(events, [true, false]);
    assert.equal(calls.filter((value) => value === "free").length, 4);
    assert.equal(dispatcher.pending.size, 0);
    dispatcher.dispose();
  });
}

test("manual completion failures and mismatched layouts reject without fabricated success", async () => {
  for (const failure of ["io", "callback", "size", "throw"]) {
    const { api, dispatcher, complete, calls } = fixture();
    const pending = dispatcher.callResult(101n, { size: 16, callback: 1104 });
    if (failure === "io") api.callResult = () => false;
    if (failure === "throw")
      api.callResult = () => {
        throw new Error("native failure");
      };
    complete(
      101n,
      failure === "callback" ? 1105 : 1104,
      failure === "size" ? 24 : 16,
    );
    dispatcher.pump();
    await assert.rejects(pending, /failed|Invalid|failure/);
    assert.equal(calls.filter((value) => value === "free").length, 1);
    dispatcher.dispose();
  }
});

test("shutdown cancels the sole pump and rejects every outstanding request before native shutdown", async () => {
  const { dispatcher, calls, callbacks } = fixture();
  const pending = dispatcher.callResult(101n, { size: 16, callback: 1104 });
  dispatcher.start();
  assert(dispatcher.timer);
  dispatcher.dispose();
  dispatcher.dispose();
  await assert.rejects(pending, /shutting down/);
  callbacks.push({ id: 331, payload: Buffer.alloc(12) });
  dispatcher.pump();
  assert.equal(dispatcher.pending.size, 0);
  assert.equal(dispatcher.timer, undefined);
  assert.deepEqual(calls, []);
});

test("invalid callback payload is still freed and disposal preserves pending rejection", async () => {
  const { dispatcher, callbacks, calls } = fixture();
  const pending = dispatcher.callResult(101n, { size: 16, callback: 1104 });
  callbacks.push({ id: 703, payload: Buffer.alloc(8) });
  assert.throws(() => dispatcher.pump(), /Invalid/);
  assert.equal(calls.filter((value) => value === "free").length, 1);
  dispatcher.dispose();
  await assert.rejects(pending, /shutting down/);
});

test("timed out or unknown handles cannot consume another request's result", async () => {
  const { dispatcher, complete, calls } = fixture();
  dispatcher.requestTimeoutMs = 5;
  const pending = dispatcher.callResult(101n, { size: 16, callback: 1104 });
  await assert.rejects(pending, /timed out/);
  complete(101n);
  complete(888n);
  dispatcher.pump();
  assert.equal(calls.filter(Array.isArray).length, 0);
  assert.equal(calls.filter((value) => value === "free").length, 2);
  await assert.rejects(
    dispatcher.callResult(0n, { size: 16, callback: 1104 }),
    /could not start/,
  );
  dispatcher.dispose();
});
