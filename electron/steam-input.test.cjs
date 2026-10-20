const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  SteamInput,
  ACTION_SETS,
  INPUT_DECLARATIONS,
  loadInputFunctions,
  readGlyph,
} = require("./steam-input.cjs");
const { SteamService } = require("./steam.cjs");

// KeyValues permits repeated group/preset keys, so preserve entries as pairs.
function parseVdf(text) {
  const tokens = text.match(/"(?:[^"\\]|\\.)*"|[{}]/g) ?? [];
  let index = 0;
  function object(nested = false) {
    const entries = [];
    while (index < tokens.length && tokens[index] !== "}") {
      const key = JSON.parse(tokens[index++]);
      const token = tokens[index++];
      if (token === "{") entries.push([key, object(true)]);
      else entries.push([key, JSON.parse(token)]);
    }
    if (nested) assert.equal(tokens[index++], "}", "unclosed VDF object");
    return entries;
  }
  const result = object();
  assert.equal(index, tokens.length);
  return result;
}
const value = (entries, name) => entries.find(([key]) => key === name)?.[1];
const manifestPath = path.join(__dirname, "../steamworks/input/actions.vdf");
const manifest = value(
  parseVdf(fs.readFileSync(manifestPath, "utf8")),
  "Action Manifest",
);

function fixture(definition = manifest) {
  const calls = [];
  const frames = [];
  const errors = [];
  const state = {
    controllers: [1n],
    down: new Set(),
    now: 0,
    origin: 1,
    active: true,
  };
  const sets = new Map();
  const available = value(definition, "actions");
  const api = {
    input: () => "input",
    init: (...args) => {
      calls.push(["init", ...args]);
      return true;
    },
    shutdown: (...args) => {
      calls.push(["shutdown", ...args]);
      return true;
    },
    manifest: (...args) => {
      calls.push(["manifest", ...args]);
      return true;
    },
    runFrame: (...args) => calls.push(["runFrame", ...args]),
    controllers: (_input, buffer) => {
      state.controllers.forEach((handle, index) =>
        buffer.writeBigUInt64LE(handle, index * 8),
      );
      return state.controllers.length;
    },
    actionSet: (_input, name) => (value(available, name) ? name : 0),
    activate: (_input, controller, set) => sets.set(controller, set),
    action: (_input, name) =>
      available.some(([, set]) => value(value(set, "Button"), name)) ? name : 0,
    data: (_input, controller, action) => ({
      bActive: state.active && action.startsWith(`${sets.get(controller)}_`),
      bState: state.down.has(action),
    }),
    origins: (_input, _controller, _set, _action, buffer) => {
      buffer.writeInt32LE(state.origin);
      return state.origin ? 1 : 0;
    },
    label: (_input, origin) => (origin === 1 ? "A Button" : "Cross Button"),
    glyph: () => undefined,
  };
  const input = new SteamInput(
    api,
    manifestPath,
    (frame) => frames.push(frame),
    (error) => errors.push(error),
    () => state.now,
  );
  input.setEnabled(true);
  function poll(elapsed = 34) {
    state.now += elapsed;
    input.poll();
  }
  function press(action, context = input.context) {
    state.down.add(`${context}_${action}`);
    poll();
  }
  function release() {
    state.down.clear();
    poll();
  }
  // Activate the set, then observe a neutral frame before accepting presses.
  poll();
  poll();
  return { api, calls, frames, errors, state, input, poll, press, release };
}

test("manifest supplies unique, localized actions and every default layout binds each action", () => {
  const definitions = value(manifest, "actions");
  const english = value(value(manifest, "localization"), "english");
  const names = new Set();
  for (const [context, actions] of Object.entries(ACTION_SETS)) {
    const set = value(definitions, context);
    assert.ok(value(english, value(set, "title").slice(1)));
    for (const action of actions) {
      const name = `${context}_${action}`;
      assert.ok(!names.has(name));
      names.add(name);
      assert.ok(
        value(english, value(value(set, "Button"), name).slice(1)),
        name,
      );
    }
  }
  const configs = value(manifest, "configurations");
  assert.equal(configs.length, 6);
  for (const [type, paths] of configs) {
    const file = value(paths[0][1], "path");
    const config = value(
      parseVdf(
        fs.readFileSync(path.join(path.dirname(manifestPath), file), "utf8"),
      ),
      "controller_mappings",
    );
    assert.equal(value(config, "controller_type"), type);
    assert.deepEqual(value(config, "actions"), definitions);
    const groups = config
      .filter(([key]) => key === "group")
      .map(([, group]) => group);
    const presets = config
      .filter(([key]) => key === "preset")
      .map(([, preset]) => preset);
    for (const preset of presets) {
      const context = value(preset, "name");
      const bound = new Set();
      for (const [id] of value(preset, "group_source_bindings")) {
        const group = groups.find((candidate) => value(candidate, "id") === id);
        assert.ok(group, `${file} preset references a missing group`);
        for (const [, input] of value(group, "inputs")) {
          const binding = value(
            value(value(value(input, "activators"), "Full_Press"), "bindings"),
            "binding",
          );
          const match = /^game_action (\w+) (\w+)$/.exec(binding);
          assert.ok(
            match,
            "defaults use semantic actions without OS key/mouse duplication",
          );
          assert.equal(match[1], context);
          assert.ok(names.has(match[2]), `${file} unknown action ${match[2]}`);
          bound.add(match[2]);
        }
      }
      assert.deepEqual(
        [...bound].sort(),
        ACTION_SETS[context].map((action) => `${context}_${action}`).sort(),
      );
    }
  }
});

test("real authored manifest resolves Menu and Gameplay actions through the polling API", () => {
  const f = fixture();
  for (const context of Object.keys(ACTION_SETS)) {
    f.input.setContext(context);
    f.poll();
    f.poll();
    for (const action of ACTION_SETS[context]) {
      f.press(action);
      assert.deepEqual(
        f.frames.at(-1).actions,
        [action],
        `${context}_${action}`,
      );
      f.release();
    }
  }
  assert.deepEqual(f.calls[0], ["init", "input", true]);
  assert.deepEqual(f.calls[1], ["manifest", "input", manifestPath]);
});

test("a broken manifest action fails the actual action dispatch contract", () => {
  const broken = structuredClone(manifest);
  const buttons = value(value(value(broken, "actions"), "Menu"), "Button");
  buttons.find(([name]) => name === "Menu_confirm")[0] = "wrong_confirm";
  const f = fixture(broken);
  f.press("confirm");
  assert.ok(!f.frames.some((frame) => frame.actions.includes("confirm")));
  // The valid neighboring action still dispatches: this isn't an inactive fixture.
  f.press("back");
  assert.deepEqual(f.frames.at(-1).actions, ["back"]);
});

test("confirmation is edge-only while directions repeat after a bounded delay", () => {
  const f = fixture();
  f.press("confirm");
  const confirmed = f.frames.length;
  f.poll(1000);
  assert.equal(f.frames.length, confirmed);
  f.release();
  f.press("down");
  const moved = f.frames.length;
  f.poll(399);
  assert.equal(f.frames.length, moved);
  f.poll(1);
  assert.deepEqual(f.frames.at(-1).actions, ["down"]);
  f.poll(120);
  assert.equal(f.frames.length, moved + 2);
});

test("context changes, focus/overlay suspension and hotplug require release before activation", () => {
  const f = fixture();
  f.press("confirm");
  const transition = f.frames.length;
  f.input.setContext("Gameplay");
  f.state.down.add("Gameplay_confirm");
  f.poll();
  f.poll();
  assert.deepEqual(f.input.setContext("Gameplay").actions, []);
  assert.ok(
    !f.frames
      .slice(transition)
      .some((frame) => frame.actions.includes("confirm")),
  );
  f.release();
  f.press("confirm");
  assert.deepEqual(f.frames.at(-1).actions, ["confirm"]);
  f.input.setEnabled(false);
  const before = f.frames.length;
  f.poll(1000);
  f.input.setEnabled(true);
  f.poll();
  assert.equal(f.frames.length, before);
  f.release();
  f.press("pause");
  assert.deepEqual(f.frames.at(-1).actions, ["pause"]);
  f.state.controllers = [];
  f.poll();
  assert.deepEqual(f.frames.at(-1), {
    connected: false,
    disconnected: true,
    actions: [],
    glyphs: {},
  });
  f.state.controllers = [2n];
  f.poll();
  f.poll();
  assert.deepEqual(f.frames.at(-1).actions, []);
  f.release();
  f.press("pause");
  assert.deepEqual(f.frames.at(-1).actions, ["pause"]);
});

test("native failure disconnects once and shuts down without breaking local play", () => {
  const f = fixture();
  f.api.runFrame = () => {
    throw new Error("Steam exited");
  };
  f.poll();
  f.poll();
  assert.equal(f.errors.length, 1);
  assert.equal(f.frames.filter((frame) => frame.disconnected).length, 1);
  assert.equal(f.calls.filter(([name]) => name === "shutdown").length, 1);
  assert.equal(f.input.frame.connected, false);
});

test("unsupported Steam and invalid contexts leave keyboard/mouse play available", () => {
  const service = new SteamService();
  assert.deepEqual(service.setInputContext("Menu"), {
    connected: false,
    actions: [],
    glyphs: {},
  });
  assert.throws(
    () => service.setInputContext("menu"),
    /Invalid Steam Input context/,
  );
  const input = new SteamInput(null, manifestPath, () =>
    assert.fail("unsupported input emitted a frame"),
  );
  input.start();
  input.poll();
  input.dispose();
  assert.equal(input.timer, undefined);
});

test("late-loaded bindings rearm only after active neutral data and prompts follow actual origins", () => {
  const f = fixture();
  f.state.active = false;
  f.input.setEnabled(false);
  f.input.setEnabled(true);
  f.poll();
  f.state.active = true;
  f.press("confirm");
  assert.ok(!f.frames.some((frame) => frame.actions.includes("confirm")));
  f.release();
  f.press("confirm");
  assert.deepEqual(f.frames.at(-1).actions, ["confirm"]);
  assert.equal(f.frames.at(-1).glyphs.confirm.label, "A Button");
  f.state.origin = 2;
  f.poll(1000);
  assert.equal(f.frames.at(-1).glyphs.confirm.label, "Cross Button");
  f.state.origin = 0;
  f.poll(1000);
  assert.deepEqual(f.frames.at(-1).glyphs, {});
});

test("glyphs expose only bounded PNG data and never expose local paths", (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "electrify-glyph-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const file = path.join(directory, "glyph.png");
  fs.writeFileSync(file, Buffer.from("89504e470d0a1a0a", "hex"));
  assert.match(readGlyph(file), /^data:image\/png;base64,/);
  assert.equal(readGlyph("relative.png"), undefined);
  fs.writeFileSync(file, "<svg>unsafe remote content</svg>");
  assert.equal(readGlyph(file), undefined);
  fs.writeFileSync(file, Buffer.alloc(128 * 1024 + 1));
  assert.equal(readGlyph(file), undefined);
});

test("optional native symbol failures do not disable other Steam APIs", () => {
  const calls = [];
  const library = {
    func: (...args) => {
      calls.push(args);
      return () => {};
    },
  };
  const struct = {};
  assert.ok(loadInputFunctions(library, { struct: () => struct }));
  assert.equal(calls.length, Object.keys(INPUT_DECLARATIONS).length + 1);
  assert.deepEqual(calls.at(-1), [
    "SteamAPI_ISteamInput_GetDigitalActionData",
    struct,
    ["void *", "uint64_t", "uint64_t"],
  ]);
  assert.equal(
    loadInputFunctions(
      {
        func: () => {
          throw new Error("older SDK");
        },
      },
      {},
    ),
    null,
  );
});

test("every SteamInput006 export and its returned bool struct resolves in the pinned SDK", () => {
  assert.ok(loadInputFunctions());
});
