import { acquisitionAssets } from "../../helpers/Expansion";
import { utilityPlanning } from "../../helpers/UtilityPlanning";
import { createGame } from "../../testing/Simulator";
import { facilityDisplayName } from "./FacilityLabels";

it("keeps original seller oil plants distinct in fleet labels and retirement planning", () => {
  const game = createGame({
    scenarioId: 116,
    difficulty: "Employee",
    seed: 12345,
  });
  game.facilities.push(
    ...acquisitionAssets(game, "valley-electric")!,
    ...acquisitionAssets(game, "ridge-electric")!,
  );
  expect(utilityPlanning(game)!.retirements.map(facilityDisplayName)).toEqual([
    "Oil A",
    "Valley Oil",
    "Ridge Oil",
  ]);
  const originals = game.facilities.filter((facility) =>
    facility.startingAssetId?.endsWith("-oil"),
  );
  expect(originals.map(facilityDisplayName)).toEqual([
    "Valley Oil",
    "Ridge Oil",
  ]);
  const replacement = {
    ...originals[0],
    id: 9999,
    startingAssetId: undefined,
  };
  game.facilities.push(replacement);
  expect(facilityDisplayName(replacement)).toBe("Oil");
  expect(
    utilityPlanning(game)!.retirements.map((facility) => facility.id),
  ).not.toContain(replacement.id);
});
