import cloneDeep from "lodash.clonedeep";
import { parseSave, serializeSave } from "../SaveGame";
import { modScenario } from "../mods/ModScenario";
import type { ModPackage } from "../mods/ModSchema";
import { createGame } from "../testing/Simulator";
import { runMonths } from "../testing/SimulationTestHelpers";
import { validScenarioRuleState } from "../helpers/ScenarioRuleValidation";

const input: ModPackage = {
  schemaVersion: 1,
  gameApi: 1,
  id: "affected-report",
  title: "Affected report",
  creator: "Fixture",
  version: "1",
  description: "Review the recorded targets after an outage ends.",
  seed: 42,
  baseScenarioId: 999,
  officialArcs: [],
  objectives: { mode: "none" },
  scenario: { durationMonths: 6, cash: 1e9 },
  debriefReports: [
    {
      id: "closing-capacity",
      kind: "firmCoverage",
      fromMonth: 1,
      throughMonth: 1,
    },
  ],
  events: [
    {
      id: "outage",
      title: "Generator outage",
      message: "One generator loses output.",
      preview: "One generator will lose output.",
      startMonth: 1,
      durationMonths: 1,
      effects: {
        outputMultipliersBySelector: [
          { target: { selector: "largestOperating" }, outputMultiplier: 0.5 },
        ],
      },
      report: {
        id: "outage-target",
        kind: "affectedFacilities",
        eventId: "outage",
      },
    },
    {
      id: "review",
      title: "Outage ends",
      message: "Generator output returns to normal.",
      preview: "Generator output will return to normal.",
      startMonth: 2,
      report: {
        id: "original-target",
        kind: "affectedFacilities",
        eventId: "outage",
      },
    },
  ],
};

test("a reached review reports its referenced onset while retaining its own empty target identity", () => {
  const scenario = modScenario(input);
  const game = createGame({ scenarioId: 999, scenario, seed: 42 });
  runMonths(game, 1);
  const onset = game.worldEvents.occurrences.find(
    (event) => event.key === "mod:affected-report:outage",
  )!;
  const review = game.worldEvents.occurrences.find(
    (event) => event.key === "mod:affected-report:review",
  )!;
  expect(onset).toBeDefined();
  expect(onset.attributes.selectedFacilityNames).toHaveLength(1);
  expect(review.attributes).toMatchObject({
    ruleTargets: "[]",
    selectedFacilityIds: [],
    selectedFacilityNames: onset.attributes.selectedFacilityNames,
    affectedFacilityCount: 1,
  });
  expect(validScenarioRuleState(game)).toBe(true);
  const restored = parseSave(serializeSave(game));
  expect(restored).not.toBeNull();
  expect(restored!.game.worldEvents).toEqual(game.worldEvents);

  for (const patch of [
    { selectedFacilityNames: ["A replacement generator"] },
    { affectedFacilityCount: 2 },
    { selectedFacilityIds: onset.attributes.selectedFacilityIds },
    { ruleTargets: onset.attributes.ruleTargets },
  ]) {
    const changed = cloneDeep(game);
    const receipt = changed.worldEvents.occurrences.find(
      (event) => event.key === review.key,
    )!;
    Object.assign(receipt.attributes, patch);
    expect(validScenarioRuleState(changed)).toBe(false);
    expect(parseSave(serializeSave(changed))).toBeNull();
    expect(parseSave(serializeSave(game))).not.toBeNull();
  }

  // Closing capacity facts are recorded only for a declared capacity report.
  const observation = game.worldEvents.occurrences.find(
    (event) => event.key === "mod:affected-report:observation:0",
  )!;
  expect(observation).toBeDefined();
  for (const change of [
    "unknown-month",
    "future",
    "extra-fact",
    "duplicate",
  ] as const) {
    const changed = cloneDeep(game);
    const receipt = changed.worldEvents.occurrences.find(
      (event) => event.key === observation.key,
    )!;
    if (change === "unknown-month") receipt.attributes.month = 1;
    if (change === "future") receipt.startsMinute++;
    if (change === "extra-fact") receipt.attributes.unexpected = 1;
    if (change === "duplicate")
      changed.worldEvents.occurrences.push(cloneDeep(receipt));
    expect(parseSave(serializeSave(changed))).toBeNull();
    expect(parseSave(serializeSave(game))).not.toBeNull();
  }
});
