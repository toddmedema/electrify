import "../Store";
import { COOP_TEST_SPEC, coopSeats } from "../testing/MultiplayerFixtures";
import { createGame } from "../testing/Simulator";
import { createWorld } from "./World";
import { newMatchSpec } from "./WorkerProtocol";

type ScenarioMod = NonNullable<
  NonNullable<typeof COOP_TEST_SPEC.customScenario>["mod"]
>;

test("new custom launches use territorial rules", () => {
  expect(newMatchSpec(COOP_TEST_SPEC).territorialVersion).toBe(1);
});

test("authored and modded launches keep their own maps", () => {
  const modded = newMatchSpec({
    ...COOP_TEST_SPEC,
    customScenario: {
      ...COOP_TEST_SPEC.customScenario!,
      mod: {} as ScenarioMod,
    },
  });
  expect(modded.territorialVersion).toBeUndefined();

  // Restarting a resumed authored campaign launches its saved spec again.
  createGame({ scenarioId: 104 });
  const authored = newMatchSpec({ scenarioId: 104, difficulty: "Employee" });
  expect(authored.territorialVersion).toBeUndefined();
  expect(() =>
    createWorld(authored, coopSeats(2), "authored-restart", "opening"),
  ).not.toThrow();
});
