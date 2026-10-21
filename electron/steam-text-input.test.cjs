const { test } = require("node:test");
const assert = require("node:assert/strict");
const koffi = require("koffi");
const { SteamDispatcher } = require("./steam-dispatch.cjs");
const { SteamService } = require("./steam.cjs");
const {
  SteamTextInput,
  TEXT_INPUT_CALLBACK,
  loadTextInputFunctions,
  validateTextInput,
} = require("./steam-text-input.cjs");

const request = {
  description: "Save name",
  text: "Campaign one",
  maxLength: 80,
  multiline: false,
  password: false,
};

function fixture() {
  const callbacks = [];
  const calls = [];
  const active = [];
  const state = { text: "Électricité ⚡", shown: true };
  let current;
  let handling = false;
  const api = {
    pipe: () => 42,
    runFrame: () => {
      handling = true;
      calls.push("pump");
    },
    nextCallback: (_pipe, buffer) => {
      current = callbacks.shift();
      if (!current) {
        handling = false;
        return false;
      }
      buffer.writeInt32LE(TEXT_INPUT_CALLBACK, 4);
      buffer.writeBigUInt64LE(koffi.address(current), 8);
      buffer.writeInt32LE(current.length, 16);
      return true;
    },
    freeCallback: () => {
      calls.push("free");
      current = undefined;
    },
    utils: () => "utils",
    appId: () => 123,
    show: (...args) => {
      calls.push(args);
      return state.shown;
    },
    length: () => {
      assert.equal(
        handling,
        true,
        "retrieve text inside the existing callback pump",
      );
      calls.push("length");
      return state.length ?? Buffer.byteLength(state.text) + 1;
    },
    text: (_utils, buffer, length) => {
      assert.equal(handling, true);
      assert.equal(length, buffer.length);
      calls.push("text");
      buffer.write(state.text, "utf8");
      return true;
    },
  };
  const dispatcher = new SteamDispatcher(api, () => {}, assert.fail, "win32");
  const input = new SteamTextInput(api, dispatcher, (value) =>
    active.push(value),
  );
  const dismiss = (submitted = true, appId = 123) => {
    const payload = Buffer.alloc(12);
    payload[0] = submitted ? 1 : 0;
    payload.writeUInt32LE(Buffer.byteLength(state.text) + 1, 4);
    payload.writeUInt32LE(appId, 8);
    callbacks.push(payload);
    dispatcher.pump();
  };
  return { input, state, calls, active, dismiss, dispatcher, callbacks };
}

test("submits UTF-8 through the sole dispatcher and releases the keyboard input guard", async () => {
  const f = fixture();
  const pending = f.input.show(request);
  assert.equal(f.input.active, true);
  assert.deepEqual(f.calls, [["utils", 0, 0, "Save name", 80, "Campaign one"]]);
  assert.deepEqual(await f.input.show(request), { status: "unavailable" });
  // A dismissal for a different app cannot settle the active editor.
  f.dismiss(true, 999);
  assert.equal(f.input.active, true);
  f.dismiss();
  assert.deepEqual(await pending, { status: "submitted", text: f.state.text });
  assert.deepEqual(f.active, [true, false]);
  assert.equal(f.input.active, false);
  assert.deepEqual(f.calls.slice(-4), ["pump", "free", "length", "text"]);
  f.input.dispose();
  f.dispatcher.dispose();
});

test("cancellation never reads or writes submitted text and a later request can submit", async () => {
  const f = fixture();
  const first = f.input.show(request);
  f.dismiss(false);
  assert.deepEqual(await first, { status: "cancelled" });
  assert.ok(!f.calls.includes("text"));
  const second = f.input.show({ ...request, multiline: true, password: true });
  assert.deepEqual(f.calls.at(-1), [
    "utils",
    1,
    1,
    "Save name",
    80,
    "Campaign one",
  ]);
  f.dismiss();
  assert.equal((await second).status, "submitted");
  f.input.dispose();
  f.dispatcher.dispose();
});

test("unavailable Steam, native refusal and lost callbacks preserve text and release controls", async () => {
  assert.deepEqual(await new SteamService().showTextInput(request), {
    status: "unavailable",
  });
  const unsupported = new SteamTextInput(null, null);
  assert.deepEqual(await unsupported.show(request), { status: "unavailable" });
  const f = fixture();
  f.state.shown = false;
  assert.deepEqual(await f.input.show(request), { status: "unavailable" });
  assert.deepEqual(f.active, [true, false]);
  f.state.shown = true;
  const pending = f.input.show(request);
  f.input.dispose();
  assert.deepEqual(await pending, { status: "unavailable" });
  assert.equal(f.input.active, false);
  f.dispatcher.dispose();
});

test("rejects untrusted bridge arguments before calling any native API", () => {
  for (const invalid of [
    null,
    { ...request, maxLength: 0 },
    { ...request, maxLength: 2049 },
    { ...request, maxLength: 1.5 },
    { ...request, text: "x".repeat(81) },
    { ...request, text: "bad\0text" },
    { ...request, description: "x".repeat(257) },
    { ...request, description: "" },
    { ...request, multiline: "true" },
    { ...request, password: 1 },
  ])
    assert.throws(() => validateTextInput(invalid), /Invalid Steam text input/);
  assert.deepEqual(
    validateTextInput({ ...request, unknown: "omitted" }),
    request,
  );
});

test("bounds SDK-returned sizes before allocation and ignores late callbacks after disposal", async () => {
  const f = fixture();
  const pending = f.input.show(request);
  f.state.length = 1024 * 1024;
  f.dismiss();
  assert.deepEqual(await pending, { status: "unavailable" });
  assert.ok(!f.calls.includes("text"));
  f.input.dispose();
  f.dismiss();
  assert.equal(f.input.active, false);
  f.dispatcher.dispose();
});

test("a lost dismissal times out without accepting a late result for another field", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const f = fixture();
  const pending = f.input.show(request);
  t.mock.timers.tick(5 * 60 * 1000);
  assert.deepEqual(await pending, { status: "unavailable" });
  assert.deepEqual(await f.input.show(request), { status: "unavailable" });
  f.dismiss();
  assert.ok(!f.calls.includes("text"));
  assert.deepEqual(f.active, [true, false]);
  f.input.dispose();
  f.dispatcher.dispose();
});

test("native input remains guarded until Steam text entry finishes", () => {
  const service = new SteamService();
  const enabled = [];
  service.input = { setEnabled: (value) => enabled.push(value) };
  service.textInput = { active: true };
  service.setInputEnabled(true);
  service.textInput.active = false;
  service.setInputEnabled(true);
  service.setInputEnabled(false);
  assert.deepEqual(enabled, [false, true, false]);
});

test("the sandboxed preload forwards only the text request and result", async () => {
  const fs = require("node:fs");
  const vm = require("node:vm");
  let bridge;
  const calls = [];
  const result = { status: "submitted", text: "Campaign two" };
  vm.runInNewContext(
    fs.readFileSync(require.resolve("./preload.cjs"), "utf8"),
    {
      require: (name) => {
        assert.equal(name, "electron");
        return {
          contextBridge: {
            exposeInMainWorld: (name, value) => {
              assert.equal(name, "electrifyDesktop");
              bridge = value;
            },
          },
          ipcRenderer: {
            invoke: (...args) => {
              calls.push(args);
              return Promise.resolve(result);
            },
          },
        };
      },
    },
  );
  assert.equal(await bridge.showTextInput(request), result);
  assert.deepEqual(calls, [["desktop:text-input", request]]);
  assert.equal(bridge.ipcRenderer, undefined);
});

test("text input resolves every native export in the bundled Steam SDK and is optional", () => {
  assert.ok(loadTextInputFunctions());
  assert.equal(
    loadTextInputFunctions({
      func: () => {
        throw new Error("older SDK");
      },
    }),
    null,
  );
});
