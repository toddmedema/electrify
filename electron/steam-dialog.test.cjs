const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  SteamNativeDialogs,
  loadDialogFunctions,
  DIALOG_DECLARATIONS,
} = require("./steam-dialog.cjs");

function fixture(api) {
  const changes = [];
  const modes = [];
  const errors = [];
  const dialogs = new SteamNativeDialogs(
    api === undefined
      ? {
          utils: () => "utils",
          launcher: (_utils, active) => modes.push(active),
        }
      : api,
    (active) => changes.push(active),
    (error) => errors.push(error),
  );
  return { dialogs, changes, modes, errors };
}

test("a successful or cancelled chooser restores semantic input only after launcher mode ends", async () => {
  for (const result of ["scenario.json", undefined]) {
    const f = fixture();
    let complete;
    const native = new Promise((resolve) => {
      complete = resolve;
    });
    const pending = f.dialogs.run(() => native);
    assert.equal(f.dialogs.active, true);
    assert.deepEqual(f.modes, [true]);
    assert.deepEqual(f.changes, [true]);
    complete(result);
    assert.equal(await pending, result);
    assert.equal(f.dialogs.active, false);
    assert.deepEqual(f.modes, [true, false]);
    assert.deepEqual(f.changes, [true, false]);
  }
});

test("rejected and overlapping choosers release launcher mode exactly once", async () => {
  const f = fixture();
  let closeFirst;
  const first = f.dialogs.run(
    () =>
      new Promise((resolve) => {
        closeFirst = resolve;
      }),
  );
  await assert.rejects(
    f.dialogs.run(async () => {
      throw new Error("Portal closed");
    }),
    /Portal closed/,
  );
  assert.equal(f.dialogs.active, true);
  assert.deepEqual(f.modes, [true]);
  closeFirst();
  await first;
  assert.deepEqual(f.modes, [true, false]);
  assert.deepEqual(f.changes, [true, false]);
});

test("missing or failing optional Steam helpers never prevent native file selection", async () => {
  const missing = fixture(null);
  assert.equal(
    await missing.dialogs.run(async () => "offline.json"),
    "offline.json",
  );
  assert.deepEqual(missing.changes, [true, false]);
  const broken = fixture({
    utils: () => "utils",
    launcher: () => {
      throw new Error("Steam disconnected");
    },
  });
  assert.equal(
    await broken.dialogs.run(async () => "local.json"),
    "local.json",
  );
  assert.equal(broken.errors.length, 2);
  assert.equal(broken.dialogs.active, false);
  assert.equal(
    loadDialogFunctions({
      func: () => {
        throw new Error("older SDK");
      },
    }),
    null,
  );
});

test("shutdown resets launcher mode while a chooser is still open", async () => {
  const f = fixture();
  let close;
  const pending = f.dialogs.run(
    () =>
      new Promise((resolve) => {
        close = resolve;
      }),
  );
  f.dialogs.dispose();
  assert.deepEqual(f.modes, [true, false]);
  assert.equal(f.dialogs.active, false);
  close();
  await pending;
  assert.deepEqual(f.modes, [true, false]);
});

test("the bundled Steam SDK resolves the optional native-dialog exports", () => {
  const api = loadDialogFunctions();
  assert.ok(api);
  assert.deepEqual(Object.keys(api), Object.keys(DIALOG_DECLARATIONS));
});
