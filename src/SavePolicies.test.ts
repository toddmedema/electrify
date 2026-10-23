import { parseSave, serializeSave } from "./SaveGame";
import { createGame } from "./testing/Simulator";
import { runMonths } from "./testing/SimulationTestHelpers";
import { achievementHooks } from "./achievements/Achievements";
import { installSimulationHooks } from "./achievements/SimulationHooks";
import { emptyPolicies } from "./helpers/Policies";

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));
beforeAll(() => installSimulationHooks(achievementHooks));

describe("current save policies", () => {
  it("current saves retain valid flexibility queues and storage through a round trip", () => {
    const game = createGame({ scenarioId: 100 });
    runMonths(game, 1);
    game.policies = emptyPolicies(game.date.monthsElapsed);
    game.policies.programs.battery.adoption = 0.5;
    game.policies.programs.battery.installs = [[1, 0.5]];
    const tick = game.timeline[0];
    tick.deferredThermal = [
      { energyWh: 10, recoveryStartMinute: 60, recoveryEndMinute: 240 },
    ];
    tick.deferredThermalStart = clone(tick.deferredThermal);
    tick.deferredCharging = [
      { energyWh: 20, recoveryStartMinute: 60, recoveryEndMinute: 420 },
    ];
    tick.deferredChargingStart = clone(tick.deferredCharging);
    tick.customerBatteryWh = 100;
    tick.customerBatteryWhStart = 90;
    const save = clone(serializeSave(game));
    const restored = parseSave(save)!;
    expect(restored.game.policies).toEqual(game.policies);
    expect(restored.game.timeline[0]).toEqual(clone(tick));
    expect(
      parseSave(clone(serializeSave(restored.game)))!.game.timeline[0],
    ).toEqual(clone(tick));
  });

  it.each(["thermal", "evCharging", "battery"] as const)(
    "accepts a completed %s rollout with a pending Off or window change in JSON saves",
    (id) => {
      const game = createGame({ scenarioId: 100 });
      runMonths(game, 1);
      game.policies = emptyPolicies(game.date.monthsElapsed);
      game.policies.programs[id] = {
        tier: "On",
        adoption: 1,
        spending: 0,
        spent: 1234,
        installs: [[1, 1]],
        completedMonth: 1,
      };
      for (const pending of [
        { tier: "Off" as const, month: 2 },
        { tier: "On" as const, month: 2, startHour: 8 },
      ]) {
        game.policies.programs[id].pending = pending;
        const raw = clone(serializeSave(game));
        const restored = parseSave(raw);
        expect(restored).not.toBeNull();
        expect(restored!.game.policies!.programs[id]).toEqual(
          game.policies.programs[id],
        );
      }
    },
  );

  it.each([
    [
      "deferredThermal",
      [{ energyWh: -1, recoveryStartMinute: 60, recoveryEndMinute: 240 }],
    ],
    [
      "deferredThermalStart",
      [{ energyWh: 1, recoveryStartMinute: 60, recoveryEndMinute: 420 }],
    ],
    [
      "deferredCharging",
      [{ energyWh: 1, recoveryStartMinute: 60, recoveryEndMinute: 240 }],
    ],
    [
      "deferredChargingStart",
      [{ energyWh: Infinity, recoveryStartMinute: 60, recoveryEndMinute: 420 }],
    ],
    ["customerBatteryWh", -1],
    ["customerBatteryWhStart", NaN],
    ["customerBatteryChargeW", Infinity],
    ["customerBatteryGridChargeW", -1],
    ["customerBatteryDischargeW", -1],
    ["customerBatteryLossWh", NaN],
  ])("rejects malformed current flexibility field %s", (field, value) => {
    const raw = clone(serializeSave(createGame({ scenarioId: 100 })));
    raw.game.timeline[0] = {
      ...raw.game.timeline[0],
      [field as string]: value,
    };
    expect(parseSave(raw)).toBeNull();
  });

  it("does not fill missing new offers in a corrupt current-schema policy record", () => {
    const game = createGame({ scenarioId: 100 });
    game.policies = emptyPolicies();
    const save = serializeSave(game);
    expect(
      parseSave({
        ...save,
        game: {
          ...game,
          policies: {
            ...game.policies,
            programs: { ...game.policies.programs, battery: undefined },
          },
        },
      }),
    ).toBeNull();
  });

  it("web imports retain valid shared achievement evidence and drop malformed evidence", () => {
    const desktopEdition = process.env.REACT_APP_DESKTOP;
    process.env.REACT_APP_DESKTOP = "false";
    try {
      const raw = clone(serializeSave(createGame({ scenarioId: 101 })));
      const original = JSON.stringify(raw);
      expect(raw.game.desktopAchievements).toBeDefined();
      expect(parseSave(raw)!.game.desktopAchievements).toEqual(
        raw.game.desktopAchievements,
      );
      expect(JSON.stringify(raw)).toBe(original);
      const malformed = parseSave({
        ...raw,
        game: { ...raw.game, desktopAchievements: { invalid: true } },
      });
      expect(malformed).not.toBeNull();
      expect(malformed!.game.desktopAchievements).toBeUndefined();
    } finally {
      process.env.REACT_APP_DESKTOP = desktopEdition;
    }
  });
});
