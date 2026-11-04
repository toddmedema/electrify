import { createNextState, freeze } from "@reduxjs/toolkit";
import { createHash } from "crypto";
import cloneDeep from "lodash.clonedeep";
import { TICK_MINUTES, TICKS_PER_MONTH, TICKS_PER_YEAR } from "../../Constants";
import { SCENARIOS, DEFAULT_CUSTOM_SCENARIO } from "../../data/Scenarios";
import { LEGACY_CAMPAIGN_ID } from "../../data/LegacyCampaign";
import { getWeather } from "../../data/Weather";
import { serializeCommitmentMetadata } from "../../helpers/Commitment";
import { prepareCustomScenario } from "../../helpers/CustomScenarioEvents";
import { getDateFromMinute, MINUTES_PER_MONTH } from "../../helpers/DateTime";
import { getHydroConditions } from "../../helpers/Hydro";
import { createWeatherForecast } from "../../helpers/WeatherForecast";
import { modScenario } from "../../mods/ModScenario";
import { parseSave, serializeSave } from "../../SaveGame";
import reducer, {
  continueLegacyCampaign,
  tickState,
} from "../../reducers/Game";
import { schedulePolicy } from "../../reducers/GameActions";
import { fullBuildForecast } from "../../testing/BuildForecastComparison";
import { runMonths } from "../../testing/SimulationTestHelpers";
import { createGame } from "../../testing/Simulator";
import { loadSimData } from "../../testing/SimData";
import { closingCompany } from "../../testing/LegacyCampaignProtocolFixtures";
import type { GameType } from "../../Types";
import { computeOutlook } from "./OutlookForecast";

function expectUnchangedForecast(game: GameType, baseHash?: string) {
  // cloneDeep makes non-enumerable symbol metadata enumerable. Compare the ordinary game
  // fields separately from that metadata's owning serialization below.
  const before = cloneDeep({
    ...game,
    timeline: game.timeline.map((tick) => ({ ...tick })),
  });
  const metadata = cloneDeep(serializeCommitmentMetadata(game.timeline));
  freeze(game, true);
  const expected = fullBuildForecast(game);
  const actual = computeOutlook("build", game);
  expect(actual).toStrictEqual(expected);
  // Captured independently from f55235c5's unmodified Game.tsx. The full-engine control above
  // shares the extracted weather reader; these pins also protect that extraction itself.
  if (baseHash)
    expect(
      createHash("sha256")
        .update(
          JSON.stringify(actual, (_key, value) =>
            value === undefined ? "<undefined>" : value,
          ),
        )
        .digest("hex"),
    ).toBe(baseHash);
  expect(actual?.timeline).toHaveLength(TICKS_PER_YEAR * 3);
  expect(actual?.timeline[0]).toHaveProperty("windOffshoreKph");
  expect(actual?.timeline[0]).toHaveProperty(
    "renewableCapacityFactors",
    undefined,
  );
  expect(game).toStrictEqual(before);
  expect(serializeCommitmentMetadata(game.timeline)).toStrictEqual(metadata);
  return actual!;
}

it.each(SCENARIOS.map((scenario) => [scenario.id, scenario.name] as const))(
  "preserves every build resource reading in scenario %i (%s)",
  (scenarioId) => {
    expectUnchangedForecast(
      createGame({ scenarioId, seed: 12345 }),
      scenarioId === 103
        ? "1a3034bacd031ed912686036e36432edbaad5489925ad798eec1af23aa8d2782"
        : undefined,
    );
  },
);

it("preserves modeled-past city and watershed resources in the historical campaign", () => {
  const game = createGame({ scenarioId: LEGACY_CAMPAIGN_ID, seed: 611 });
  expect(game.campaign?.generationIndex).toBe(0);
  expect(game.date.year).toBe(1882);
  expect(game.location.watershedId).not.toBe(game.location.id);
  const forecast = expectUnchangedForecast(game);
  const first = forecast.timeline[0];
  const observed = getWeather(game.date, game.seed, 0, game.location.id, true);
  expect(first.windKph).toBe(observed.WIND_KPH);
  expect(first.windKph).not.toBe(getWeather(game.date, game.seed).WIND_KPH);
  // The full control shares the weather reader. Independently pin its opt-in provenance
  // through the owning weather/hydrology APIs so omitting modeledPast cannot pass both paths.
  const watershedId = game.location.watershedId!;
  const basinWeather = createWeatherForecast(
    game.date,
    game.seed,
    watershedId,
    true,
  );
  const monthReadings = forecast.timeline.filter(
    (_tick, index) => index % TICKS_PER_MONTH === 0,
  );
  const basinRunoff = monthReadings.map(
    (tick) =>
      getHydroConditions(
        getDateFromMinute(tick.minute, game.startingYear),
        game.seed,
        0,
        watershedId,
        basinWeather,
      ).runoffMm,
  );
  expect(monthReadings.map((tick) => tick.hydroRunoffMm)).toStrictEqual(
    basinRunoff,
  );
  expect(basinRunoff.some((runoff) => runoff > 0)).toBe(true);
});

it("preserves resource forecasts before and after a historical campaign handover", () => {
  // Reuse the native handover fixture; economic feasibility is covered by the campaign sims.
  const closing = closingCompany();
  expect(closing.campaign?.pendingHandover).toBe(true);
  expectUnchangedForecast(closing);
  const inherited = reducer(closing, continueLegacyCampaign());
  expect(inherited.scenarioId).toBe(LEGACY_CAMPAIGN_ID + 1);
  expect(inherited.startingYear).toBe(1882);
  expect(inherited.date.year).toBe(1902);
  expect(inherited.date.minute).toBe(closing.date.minute);
  const forecast = expectUnchangedForecast(inherited);
  expect(forecast.timeline[0].minute).toBe(inherited.date.minute);
  expect(forecast.timeline[0].windKph).toBe(
    getWeather(inherited.date, inherited.seed, 0, inherited.location.id, true)
      .WIND_KPH,
  );
});

it("keeps legacy and modern forecasts isolated while sharing the same loaded city data", () => {
  const legacy = createGame({ scenarioId: LEGACY_CAMPAIGN_ID, seed: 611 });
  const modern = createGame({
    scenarioId: 999,
    scenario: prepareCustomScenario(DEFAULT_CUSTOM_SCENARIO),
    seed: 613,
  });
  expect(modern.location.id).toBe(legacy.location.id);
  // Deliberately alternate without reloading: the normals and recorded rows are shared,
  // while issue-time observations retain each run's era and seed.
  const past = expectUnchangedForecast(legacy);
  const present = expectUnchangedForecast(modern);
  expect(expectUnchangedForecast({ ...legacy })).toStrictEqual(past);
  expect(expectUnchangedForecast({ ...modern })).toStrictEqual(present);
  expect(past.timeline[0].windKph).toBe(
    getWeather(legacy.date, legacy.seed, 0, legacy.location.id, true).WIND_KPH,
  );
  expect(present.timeline[0].windKph).toBe(
    getWeather(modern.date, modern.seed, 0, modern.location.id).WIND_KPH,
  );
});

it("preserves inherited historical resources through the normal save import", () => {
  const inherited = reducer(closingCompany(), continueLegacyCampaign());
  const expected = expectUnchangedForecast(inherited);
  const restored = parseSave(
    JSON.parse(JSON.stringify(serializeSave(inherited))),
  );
  expect(restored).not.toBeNull();
  expect(restored!.game.campaign?.generationIndex).toBe(1);
  expect(restored!.game.startingYear).toBe(1882);
  expect(restored!.game.date.year).toBe(1902);
  expect(expectUnchangedForecast(restored!.game)).toStrictEqual(expected);
});

it.each([
  [LEGACY_CAMPAIGN_ID + 4, (1965 - 1962) * 12 * MINUTES_PER_MONTH, 1964, 1967],
  [LEGACY_CAMPAIGN_ID + 4, (1980 - 1962) * 12 * MINUTES_PER_MONTH, 1979, 1982],
  [LEGACY_CAMPAIGN_ID + 8, TICK_MINUTES, 2042, 2044],
])(
  "preserves term %i resources at minute %i across years %i–%i",
  (scenarioId, boundaryMinute, firstYear, lastYear) => {
    // The simulator supports standalone later-term balance fixtures through the native setup.
    const game = createGame({ scenarioId, seed: 617 });
    game.date = getDateFromMinute(
      boundaryMinute - TICK_MINUTES,
      game.startingYear,
    );
    const forecast = expectUnchangedForecast(game);
    expect(game.date.year).toBe(firstYear);
    expect(
      getDateFromMinute(forecast.timeline.at(-1)!.minute, game.startingYear)
        .year,
    ).toBe(lastYear);
    expect(forecast.timeline[0].windKph).toBe(
      getWeather(game.date, game.seed, 0, game.location.id, true).WIND_KPH,
    );
  },
);

it("preserves a developed mid-month hydro forecast with pending policy and separate historical observations", () => {
  let game = createGame({ scenarioId: 108, seed: 7, difficulty: "Intern" });
  runMonths(game, 13);
  for (let index = 0; index < 7; index++) tickState(game);
  game = reducer(
    game,
    schedulePolicy({ id: "efficiency", tier: "On", month: 14 }),
  );
  expect(game.monthlyHistory).toHaveLength(13);
  expect(game.date.minute % 1440).toBeGreaterThan(0);
  expectUnchangedForecast(
    game,
    "20b104a67c7985d28bc060c692140f9949ed0bae04e12ccd8832d77af44457f1",
  );
  const occurrence = {
    key: "resource-parity-drought",
    definitionId: "resource-parity-drought",
    startsMinute: game.date.minute + 30,
    endsMinute: game.date.minute + 75,
    attributes: {},
    effects: { hydroRunoffMultiplier: 0, temperatureOffsetC: 5 },
  };
  expectUnchangedForecast(
    {
      ...game,
      worldEvents: {
        ...game.worldEvents,
        active: [occurrence],
        occurrences: [occurrence],
      },
    },
    "698d88e6a4705891fcc06fa594f8c9aa2906c1b49560a89118fa33e51c22b31b",
  );
});

it("preserves custom offshore and separate-basin readings with composed story arcs", () => {
  const scenario = prepareCustomScenario({
    ...DEFAULT_CUSTOM_SCENARIO,
    startingYear: 2030,
    eventScenarioIds: [108, 107, 111],
  });
  const game = createGame({ scenarioId: 999, scenario, seed: 29 });
  expect(game.location.watershedId).not.toBe(game.location.id);
  const actual = expectUnchangedForecast(
    game,
    "285b77fd64780501708384268f82b83c20b1d4d53a82c97a60c4bcafd8825a54",
  );
  expect(actual.offshoreWindSpeeds.length).toBeGreaterThan(0);
});

it("preserves exact inflow multipliers and expiry within a month, including zero and disabled stories", () => {
  const game = createGame({ scenarioId: 108, seed: 19 });
  game.date = getDateFromMinute(5 * 1440 + 15, game.startingYear);
  const baseline = computeOutlook("build", { ...game })!;
  const startsMinute = game.date.minute + 30;
  const endsMinute = startsMinute + 45;
  const occurrence = {
    key: "resource-parity-drought",
    definitionId: "resource-parity-drought",
    startsMinute,
    endsMinute,
    attributes: {},
    effects: { hydroRunoffMultiplier: 0, temperatureOffsetC: 5 },
  };
  game.worldEvents.active = [occurrence];
  game.worldEvents.occurrences = [occurrence];
  const actual = expectUnchangedForecast(game);
  const inflow = (minute: number) =>
    actual.timeline.find((tick) => tick.minute === minute)!.hydroRunoffMm;
  expect(inflow(startsMinute)).toBe(0);
  expect(inflow(endsMinute)).toBe(
    baseline.timeline.find((tick) => tick.minute === endsMinute)!.hydroRunoffMm,
  );
  expectUnchangedForecast({ ...game, storyEffectsDisabled: true });
});

it("keeps the existing cache and missing-current-frame behavior", () => {
  const game = createGame({ scenarioId: 103, seed: 3 });
  expect(computeOutlook("build", game)).toBe(computeOutlook("build", game));
  expect(computeOutlook("build", { ...game, timeline: [] })).toBeUndefined();
});

it("preserves forecasts and commitment state after an imported save round trip", () => {
  const game = createGame({ scenarioId: 108, seed: 41, difficulty: "Intern" });
  runMonths(game, 13);
  for (let index = 0; index < 7; index++) tickState(game);
  const before = expectUnchangedForecast(game);
  const restored = parseSave(JSON.parse(JSON.stringify(serializeSave(game))));
  expect(restored).not.toBeNull();
  expect(restored!.game).not.toBe(game);
  expect(expectUnchangedForecast(restored!.game)).toStrictEqual(before);
});

it("reads modified draft inputs rather than the original frozen state", () => {
  const game = createGame({ scenarioId: 108, seed: 43 });
  const minute = 12 * 1440 + 135;
  const next = createNextState(game, (draft) => {
    draft.date = getDateFromMinute(minute, draft.startingYear);
    draft.facilities[0].paused = true;
    const occurrence = {
      key: "draft-resource-drought",
      definitionId: "draft-resource-drought",
      startsMinute: minute,
      endsMinute: minute + 45,
      attributes: {},
      effects: { hydroRunoffMultiplier: 0 },
    };
    draft.worldEvents.active = [occurrence];
    draft.worldEvents.occurrences = [occurrence];
    const forecast = computeOutlook("build", draft)!;
    expect(forecast).toStrictEqual(fullBuildForecast(draft));
    expect(forecast.timeline[0].minute).toBe(minute);
    expect(forecast.timeline[0].hydroRunoffMm).toBe(0);
  });
  expect(next.date.minute).toBe(minute);
  expect(game.date.minute).toBe(0);
});

it("rebuilds exact readings after another run replaces the loaded location and seed", () => {
  const game = createGame({ scenarioId: 108, seed: 0 });
  const original = expectUnchangedForecast(game);
  const other = createGame({
    scenarioId: 999,
    scenario: prepareCustomScenario(DEFAULT_CUSTOM_SCENARIO),
    seed: 4294967295,
  });
  expect(other.location.id).not.toBe(game.location.id);
  expectUnchangedForecast(other);
  loadSimData(game.location);
  expect(expectUnchangedForecast({ ...game })).toStrictEqual(original);
});

it.each([11 * 1440 + 1425, 12 * 1440, 24 * 1440 + 15])(
  "preserves the complete horizon across January from minute %i",
  (minute) => {
    const game = createGame({ scenarioId: 108, seed: 47 });
    game.date = getDateFromMinute(minute, game.startingYear);
    const forecast = expectUnchangedForecast(game);
    expect(forecast.timeline[0].minute).toBe(minute);
    expect(forecast.timeline.at(-1)!.minute).toBe(
      minute + (TICKS_PER_YEAR * 3 - 1) * TICK_MINUTES,
    );
  },
);

it("preserves compiled mod resource effects across an authored year boundary", () => {
  const scenario = modScenario({
    schemaVersion: 1,
    gameApi: 1,
    id: "resource-parity-grid",
    title: "Resource parity grid",
    creator: "Electrify tests",
    version: "1",
    description: "A deterministic resource forecast boundary fixture.",
    baseScenarioId: 999,
    seed: 53,
    events: [
      {
        id: "winter-inflow",
        startMonth: 12,
        durationMonths: 3,
        title: "Reservoir inflow stops",
        message: "Reservoir inflow stops.",
        effects: { hydroInflowMultiplier: 0 },
      },
    ],
  });
  const game = createGame({ scenarioId: 999, scenario, seed: 53 });
  game.date = getDateFromMinute(11 * 1440 + 15, game.startingYear);
  game.facilities[0].paused = true;
  const forecast = expectUnchangedForecast(game);
  expect(forecast.timeline[0].hydroRunoffMm).toBe(0);
  expect(forecast.timeline.some((tick) => tick.hydroRunoffMm > 0)).toBe(true);
});
