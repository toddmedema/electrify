import cloneDeep from "lodash.clonedeep";
import { LOCATIONS } from "../Constants";
import { DEFAULT_CUSTOM_SCENARIO } from "../data/Scenarios";
import { GENERATORS } from "../data/Facilities";
import { getHydroAvailability } from "../data/HydroSites";
import { createGame, createGameFromReplay } from "../testing/Simulator";
import { parseSave, serializeSave } from "../SaveGame";
import { decodeReplay, encodeReplay, serializeReplay } from "../Replay";
import { GameType } from "../Types";
import gameReducer, { buildFacility, sellFacility, tickState } from "./Game";
const options = { scenarioId: 103, seed: 123 };
function dispatch(state: GameType, action: Parameters<typeof gameReducer>[1]) {
  return cloneDeep(gameReducer(state, action));
}
function quote(state: GameType, yearsToBuild: number) {
  return {
    ...GENERATORS(state, 1000000, [], []).find((g) => g.name === "Hydro")!,
    buildCost: 1000,
    yearsToBuild,
  };
}
it("round trips historical and reserved claims through real save validation after sale", () => {
  let state = createGame(options);
  state = dispatch(
    state,
    buildFacility({ facility: quote(state, 0), financed: false }),
  );
  const id = state.facilities[0].hydroSiteId!;
  state = dispatch(state, sellFacility(state.facilities[0].id));
  state = dispatch(
    state,
    buildFacility({ facility: quote(state, 1), financed: false }),
  );
  const saved = JSON.parse(JSON.stringify(serializeSave(state)));
  const parsed = parseSave(saved)!;
  expect(parsed).not.toBeNull();
  expect(parsed.game.commissionedHydroSiteIds).toEqual([id]);
  expect(parsed.game.facilities).toEqual(state.facilities);
  const malformed = [
    undefined,
    [id, id],
    ["invented"],
    [state.facilities[0].hydroSiteId],
  ];
  for (const claims of malformed) {
    const bad = cloneDeep(saved);
    bad.game.commissionedHydroSiteIds = claims;
    expect(parseSave(bad)).toBeNull();
  }
  const bad = cloneDeep(saved);
  bad.game.hydroInventoryKey = "scenario:114";
  expect(parseSave(bad)).toBeNull();
  const spoof = cloneDeep(saved);
  spoof.game.location.lat += 1;
  expect(parseSave(spoof)).toBeNull();
});
it("live and replay agree through build, completion, sale and cancellation", () => {
  let live = createGame(options);
  tickState(live);
  live = dispatch(
    live,
    buildFacility({ facility: quote(live, 0.00000001), financed: false }),
  );
  tickState(live);
  expect(live.commissionedHydroSiteIds).toHaveLength(1);
  live = dispatch(live, sellFacility(live.facilities[0].id));
  tickState(live);
  live = dispatch(
    live,
    buildFacility({ facility: quote(live, 1), financed: false }),
  );
  tickState(live);
  live = dispatch(live, sellFacility(live.facilities[0].id));
  tickState(live);
  const replay = decodeReplay(
    JSON.parse(JSON.stringify(encodeReplay(serializeReplay(live)!))),
  )!;
  const watched = createGameFromReplay(replay);
  while (watched.date.minute < live.date.minute) tickState(watched);
  expect(watched.commissionedHydroSiteIds).toEqual(
    live.commissionedHydroSiteIds,
  );
  expect(watched.facilities).toEqual(live.facilities);
  expect(JSON.parse(JSON.stringify(watched.timeline))).toEqual(
    JSON.parse(JSON.stringify(live.timeline)),
  );
});
it("rejects invalid starting Hydro through initialization without silently dropping plants", () => {
  for (const facilities of [
    [{ name: "Coal", fuel: "Hydro" as const, peakW: 1000000 }],
    [{ name: "Hydro", peakW: 1e12 }],
    [{ name: "Hydro", peakW: 1000000, peakWh: 1000000 }],
    [{ fuel: "Hydro" as const, peakW: 1000000, peakWh: 1000000 }],
  ]) {
    expect(() =>
      createGame({
        scenarioId: DEFAULT_CUSTOM_SCENARIO.id,
        scenario: {
          ...DEFAULT_CUSTOM_SCENARIO,
          location: LOCATIONS.PIT,
          facilities,
        },
      }),
    ).toThrow("Hydro");
  }
  expect(() =>
    createGame({
      scenarioId: DEFAULT_CUSTOM_SCENARIO.id,
      scenario: {
        ...DEFAULT_CUSTOM_SCENARIO,
        location: LOCATIONS.PIT,
        startingYear: 1880,
        facilities: [{ name: "Hydro", peakW: 1000000 }],
      },
    }),
  ).toThrow("unavailable");
});
it("keeps authored order and exact integer watts while reserving explicit starts first", () => {
  const s = createGame(options);
  const site = getHydroAvailability(s, 1000000).largest!;
  const game = createGame({
    scenarioId: DEFAULT_CUSTOM_SCENARIO.id,
    scenario: {
      ...DEFAULT_CUSTOM_SCENARIO,
      location: { ...LOCATIONS.PIT, resources: { hydro: false } },
      facilities: [
        { name: "Hydro", peakW: 1000001, label: "First dam" },
        { name: "Coal", peakW: 10000000 },
        {
          name: "Hydro",
          peakW: site.maxPeakW,
          hydroSiteId: site.id,
          label: "Big dam",
        },
      ],
    },
  });
  expect(game.facilities.map((f) => f.name)).toEqual([
    "First dam",
    "Coal",
    "Big dam",
  ]);
  expect(game.facilities.map((f) => f.id)).toEqual([1, 2, 3]);
  expect(game.facilities[0].peakW).toBe(1000001);
  expect(game.facilities[2].hydroSiteId).toBe(site.id);
  expect(game.commissionedHydroSiteIds).toHaveLength(2);
});
