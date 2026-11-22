const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  createCouchNativeFixture,
} = require("../scripts/ci/couch-native-fixture");

const seats = [
  { id: "local-p1", name: "One" },
  { id: "local-p2", name: "Two" },
];
const xbox = "9223372036854775809";
const dualSense = "9223372036854775810";
const replacement = "9223372036854775811";
const frame = (id, connected = true) => ({
  id,
  connected,
  actions: [],
  glyphs: {},
});

test("only the live seat port can vibrate its assigned controller after a mixed-device replacement", async (t) => {
  const played = [];
  const stopped = [];
  const input = {
    initialized: true,
    setDeviceMode() {},
    setContext() {},
    setDeviceContext() {},
    releaseDevice() {},
    deviceContexts: new Map(),
    supportsVibration: () => true,
    vibrate: (handle, cue) => played.push([handle, cue]),
    stopVibration: (handle) => stopped.push(handle),
  };
  const { manager, ports, views, events, size } = createCouchNativeFixture({
    input: () => input,
  });
  t.after(() => manager.close());
  manager.inputFrame([frame(dualSense), frame(xbox), frame(replacement)]);
  manager.bind("local-p1", xbox);
  manager.bind("local-p2", dualSense);
  assert.equal((await manager.open({ seats })).haptics.supported, true);
  const preference = (index, enabled) => {
    const { seatId, generation } = views[index].identity;
    assert.equal(
      manager.send({
        seatId,
        generation,
        message: {
          kind: "presentation",
          generation,
          settings: { controllerVibrationEnabled: enabled },
        },
      }),
      true,
    );
  };
  const cue = (port, fields = {}) =>
    port.emit("message", {
      data: { kind: "haptic", cue: "confirm", ...fields },
    });

  cue(ports[0]); // The seat has no preference yet.
  preference(0, true);
  preference(1, true);
  cue(ports[0], { controllerId: dualSense });
  cue(ports[0], { cue: "arbitrary" });
  assert.deepEqual(played, []);
  cue(ports[0]);
  cue(ports[1], { cue: "milestone" });
  assert.deepEqual(played.splice(0), [
    [xbox, "confirm"],
    [dualSense, "milestone"],
  ]);
  assert.equal(
    events.some((event) => event.kind === "seat-message"),
    false,
  );

  manager.overlay("local-p1", true);
  cue(ports[0]);
  cue(ports[1]);
  manager.overlay(null);
  size[0] = 800;
  manager.relayout();
  cue(ports[0]);
  size[0] = 1920;
  manager.relayout();
  manager.inputFrame([
    frame(xbox, false),
    frame(dualSense),
    frame(replacement),
  ]);
  cue(ports[0]);
  assert.deepEqual(played, []);

  manager.bind("local-p1", replacement);
  cue(ports[0]);
  cue(ports.at(-1)); // A replacement starts with a fresh preference baseline.
  assert.deepEqual(played, []);
  preference(0, true);
  cue(ports[0]); // Even after the new generation is ready, old cues stay revoked.
  cue(ports.at(-1));
  cue(ports[1]);
  assert.deepEqual(played.splice(0), [
    [replacement, "confirm"],
    [dualSense, "confirm"],
  ]);

  preference(1, false);
  cue(ports[1]);
  assert.equal(stopped.at(-1), dualSense);
  assert.deepEqual(played, []);
});
