import "../Store";
import cloneDeep from "lodash.clonedeep";
import { parseSave } from "../SaveGame";
import { getScenarioLocation } from "../helpers/Locations";
import type { SaveGameType } from "../Types";
import schema3 from "./fixtures/saves/ordinary-custom-schema3.json";
import schema5 from "./fixtures/saves/ordinary-custom-schema5.json";
import { loadSimData } from "./SimData";

const load = (save: unknown) => cloneDeep(save) as unknown as SaveGameType;

test("an old ordinary custom save remains valid without accepting stored native rules", () => {
  const source = load(schema5);
  expect(source.schemaVersion).toBe(5);
  loadSimData(getScenarioLocation(source.game.customScenario)!);
  const parsed = parseSave(load(schema5));
  expect(parsed).not.toBeNull();
  expect(parsed!.game.customScenario).toEqual(source.game.customScenario);
  const forged = load(schema5);
  Object.assign(forged.game.customScenario!, { rules: {} });
  expect(parseSave(forged)).toBeNull();
  expect(parseSave(load(schema5))).not.toBeNull();
});

test("the wildfire retirement upgrades an earlier custom save without changing its authored fleet", () => {
  const source = load(schema3);
  expect(source.schemaVersion).toBe(3);
  expect(source.game.customScenario!.eventScenarioIds).toContain(111);
  loadSimData(getScenarioLocation(source.game.customScenario)!);
  const upgraded = parseSave(load(schema3));
  expect(upgraded).not.toBeNull();
  expect(upgraded!.game.customScenario!.mod).toBeUndefined();
  expect(upgraded!.game.customScenario!.eventScenarioIds).toEqual(
    source.game.customScenario!.eventScenarioIds!.filter((id) => id !== 111),
  );
  expect(upgraded!.game.customScenario!.facilities).toEqual(
    source.game.customScenario!.facilities,
  );
  expect(
    upgraded!.game.worldEvents.occurrences.some((event) =>
      event.key.startsWith("story:111:"),
    ),
  ).toBe(false);
});
