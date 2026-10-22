import cloneDeep from "lodash.clonedeep";
import { deserialize, serialize } from "v8";
import { modScenario, modResolvedSetup } from "../mods/ModScenario";
import { getScenarioLocation } from "../helpers/Locations";
import { pendingScenarioChoice } from "../helpers/ScenarioChoices";
import { loadSimData } from "../testing/SimData";
import { maximumRulePackage } from "../testing/ModPerfFixtures";
import { coopSeats } from "../testing/MultiplayerFixtures";
import { checkpointWorld, createWorld, restoreWorld } from "./World";

const codec = require("../../electron/coop-codec.cjs");

test("native compact snapshots restore exact frozen rules before strict World validation", () => {
  const pack = maximumRulePackage();
  // This guard needs one pending decision and differing frozen setup; the explicit performance
  // workload owns all100/32/16 limits and the full1200-month/four-company route.
  pack.events = pack.events!.slice(0, 2);
  pack.choices = pack.choices!.slice(0, 1).map((choice) => ({
    ...choice,
    options: choice.options.slice(0, 2),
  }));
  if (pack.objectives.mode === "replace")
    pack.objectives.items = pack.objectives.items.slice(0, 2);
  loadSimData(getScenarioLocation(modResolvedSetup(pack))!);
  const scenario = modScenario(pack, undefined, "Employee");
  const world = createWorld(
    { scenarioId: 999, difficulty: "Employee", customScenario: scenario },
    coopSeats(2),
    "snapshot-codec",
    "first-epoch",
  );
  const saved = checkpointWorld(world);
  // Native transport excludes the private nonenumerable forecast cache; checkpoint.commitments
  // carries its durable representation. V8 cloning retains numbers without exposing symbols.
  const unchanged = deserialize(serialize(saved));
  const json = codec.stringify(saved);
  expect(Buffer.byteLength(json)).toBeLessThan(
    Buffer.byteLength(JSON.stringify(saved)),
  );
  expect(saved).toEqual(unchanged);
  const decoded = codec.parse(json);
  expect(decoded).toEqual(saved);
  const restored = restoreWorld(decoded, "next-epoch");
  for (const game of restored.grids) {
    expect(game.customScenario).toEqual(scenario);
    expect(pendingScenarioChoice(game)?.id).toBe(
      "mod:maximum-rule-benchmark:choice-0",
    );
    expect(game.runIdentity).toBeUndefined();
  }
  // A claimed matching digest never repairs edited physical setup or runtime data.
  const forged = cloneDeep(saved);
  const plant = forged.grids[0].customScenario!.facilities[0];
  if (!plant.peakW) throw new Error("Expected the inherited gas plant");
  plant.peakW *= 2;
  const forgedDecoded = codec.parse(codec.stringify(forged));
  expect(forgedDecoded.grids[0].customScenario).toEqual(
    forged.grids[0].customScenario,
  );
  expect(() => restoreWorld(forgedDecoded, "forged-epoch")).toThrow();
  expect(() => restoreWorld(codec.parse(json), "valid-neighbor")).not.toThrow();
});
