import { FacilityMotionClock, MOTION_CYCLE } from "./MotionClock";
import type { MapInstance, MapModel } from "./Types";

const model: MapModel = {
  key: "rotor",
  parts: [
    {
      mesh: {
        positions: new Float32Array(),
        normals: new Float32Array(),
        colors: new Float32Array(),
      },
      motion: "rotor",
    },
  ],
  terminals: [],
  footprint: 0.5,
  height: 1,
};
const instance = (id = "wind-1", active = true): MapInstance => ({
  id,
  motionKey: id,
  active,
  model,
  position: [0, 0, 0],
  fog: 0,
});
it("retains actual facility phase through all playback rates and rebuilt batches", () => {
  const clock = new FacilityMotionClock();
  clock.sync([instance()]);
  clock.tick(0, true, 0.25);
  let expected = 0,
    timestamp = 0;
  for (const rate of [0.25, 0.7, 1, 1.2, 1.5]) {
    clock.sync([
      { ...instance(), model: { ...model, key: `new-batch-${rate}` } },
    ]);
    timestamp += 1000;
    expected = (expected + (rate * MOTION_CYCLE) / 8) % MOTION_CYCLE;
    clock.tick(timestamp, true, rate);
    expect(clock.phase("wind-1")).toBeCloseTo(expected, 8);
  }
});
it("freezes inactive/reduced/hidden phases and resumes without hidden elapsed time", () => {
  const clock = new FacilityMotionClock();
  clock.sync([instance()]);
  clock.tick(0, true, 1);
  clock.tick(1000, true, 1);
  const phase = clock.phase("wind-1");
  clock.tick(2000, false, 1);
  clock.tick(500000, true, 1);
  expect(clock.phase("wind-1")).toBe(phase);
  clock.sync([instance("wind-1", false)]);
  clock.tick(501000, true, 1);
  expect(clock.phase("wind-1")).toBe(phase);
  expect(clock.moving).toBe(false);
  clock.resetTimestamp();
  clock.sync([instance()]);
  clock.tick(900000, true, 1);
  expect(clock.phase("wind-1")).toBe(phase);
  clock.tick(901000, true, 1);
  expect(clock.phase("wind-1")).toBeCloseTo(phase + MOTION_CYCLE / 8);
});
it("keeps phase across culling, resets replacement identities and bounds removed keys", () => {
  const clock = new FacilityMotionClock();
  clock.sync([instance()]);
  clock.tick(0, true, 1);
  clock.tick(1000, true, 1);
  const phase = clock.phase("wind-1");
  clock.sync([]);
  clock.sync([instance()]);
  expect(clock.phase("wind-1")).toBe(phase);
  clock.sync([instance("replacement")]);
  expect(clock.phase("replacement")).toBe(0);
  for (let i = 0; i < 600; i++) clock.sync([instance(`facility-${i}`)]);
  expect(Object.keys(clock.snapshot())).toHaveLength(257);
  expect(clock.snapshot()["wind-1"]).toBeUndefined();
  expect(Object.isFrozen(clock.snapshot())).toBe(true);
});
