import catalog from "./AchievementCatalog.json";
import type {
  AchievementMonth,
  AchievementProgress,
  SimulationHooks,
} from "./SimulationHooks";
import { GAME_TO_REAL_YEARS, TICKS_PER_HOUR } from "../Constants";
import { SCENARIOS } from "../data/Scenarios";
import { MINUTES_PER_MONTH, summarizeHistory } from "../helpers/DateTime";
import { startingDollarRevenue } from "../helpers/Scoring";
import { GameType, isStorage, MonthlyHistoryType } from "../Types";

export const TUTORIAL_IDS = [0, 1, 2, 4, 3, 5, 112];
export const OFFICIAL_IDS = catalog.flatMap((entry) =>
  entry.scenarioId !== undefined && entry.scenarioId >= 100
    ? [entry.scenarioId]
    : [],
);
const achievementIds = new Set(catalog.map(({ id }) => id));
const assetKey = (asset: {
  id: number;
  minuteCreated: number;
  costIndexAtBuild?: number;
}) =>
  `${asset.id}:${asset.minuteCreated}:${asset.costIndexAtBuild ?? "inherited"}`;
const emptyMonth = (): AchievementMonth => ({
  nightServedWh: 0,
  nightStorageWh: 0,
  importedWh: 0,
  exportedWh: 0,
  eligibleWh: 0,
  efficiencyWh: 0,
});
const eligible = (game: GameType) =>
  !game.replayPlayback &&
  !game.customScenario &&
  !game.storyEffectsDisabled &&
  !game.weatherHazardsDisabled &&
  !game.wildfireHazardDisabled &&
  !game.meaningfulDecisionGateWaived &&
  OFFICIAL_IDS.includes(game.scenarioId);
export const reliable = (month: MonthlyHistoryType) =>
  month.demandWh > 0 && month.supplyWh / month.demandWh >= 0.999;
const intensity = (months: MonthlyHistoryType[]) => {
  const summary = summarizeHistory(months);
  return summary.supplyWh > 0
    ? summary.kgco2e / (summary.supplyWh / 1e6)
    : Infinity;
};
function award(progress: AchievementProgress, id: string): void {
  if (!progress.earned.includes(id)) progress.earned.push(id);
}

function initialize(game: GameType): void {
  if (game.replayPlayback || game.customScenario) return;
  game.desktopAchievements = {
    version: 1,
    startedWithCoal:
      game.date.minute === 0
        ? game.facilities.some(
            (facility) =>
              facility.fuel === "Coal" && facility.yearsToBuildLeft === 0,
          )
        : !!game.runIdentity?.inputs.facilities.some(
            (facility) => facility.fuel === "Coal",
          ),
    startingFacilityKeys: game.facilities.map(assetKey),
    startingLineKeys: game.transmission?.lines.map(assetKey) ?? [],
    commissionedIntertie: false,
    lastMinute: game.date.minute,
    counterStartMonth: Math.ceil(game.date.minute / MINUTES_PER_MONTH),
    reliableMonths: 0,
    recoveryMonths: -1,
    convertedWh: {},
    month: emptyMonth(),
    earned: [],
  };
}

/** Clone the small telemetry block because the live tick optimizer shares frozen inputs. */
function progressFor(game: GameType): AchievementProgress {
  if (!game.desktopAchievements) initialize(game);
  const previous = game.desktopAchievements!;
  return (game.desktopAchievements = {
    ...previous,
    month: { ...previous.month },
    convertedWh: { ...previous.convertedWh },
    earned: [...previous.earned],
  });
}

export const achievementHooks: SimulationHooks = {
  initialize,
  tick(game, tick) {
    if (!eligible(game)) return;
    const progress = progressFor(game);
    if (game.date.minute <= progress.lastMinute) return;
    progress.lastMinute = game.date.minute;
    const servedW = Math.max(0, Math.min(tick.demandW, tick.supplyW));
    // The same gross-source allocation used by monthly deliveredWhByFuel; excludes
    // charging, exports and curtailed output from each source's customer share.
    const grossW =
      Object.values(tick.supplyByFuel).reduce<number>(
        (sum, watts) => sum + (watts ?? 0),
        0,
      ) +
      (tick.storageDischargeW ?? 0) +
      (tick.importedW ?? 0);
    const customerShare = grossW > 0 ? servedW / grossW : 0;
    const weight = GAME_TO_REAL_YEARS / TICKS_PER_HOUR;
    const month = progress.month;
    const evening = game.date.minute % MINUTES_PER_MONTH >= 18 * 60;
    if (evening) month.nightServedWh += servedW * weight;
    for (const facility of game.facilities) {
      if (facility.yearsToBuildLeft > 0 || facility.paused) continue;
      const customerWh =
        Math.max(0, facility.currentW) * customerShare * weight;
      const key = assetKey(facility);
      if (
        evening &&
        isStorage(facility) &&
        !progress.startingFacilityKeys.includes(key)
      )
        month.nightStorageWh += customerWh;
      if (progress.convertedWh[key] !== undefined) {
        progress.convertedWh[key] += customerWh;
        if (progress.convertedWh[key] >= 1e9) award(progress, "WASTE_NOT");
      }
    }
    progress.commissionedIntertie ||= !!game.transmission?.lines.some(
      (line) =>
        line.yearsToBuildLeft === 0 &&
        !progress.startingLineKeys.includes(assetKey(line)),
    );
    if (progress.commissionedIntertie)
      month.importedWh += (tick.importedW ?? 0) * customerShare * weight;
    month.exportedWh += (tick.exportedW ?? 0) * weight;
    month.eligibleWh += (tick.rebateEligibleW ?? 0) * weight;
    month.efficiencyWh += (tick.efficiencySavedW ?? 0) * weight;
  },
  month(game, continuing) {
    if (!eligible(game)) return;
    const progress = progressFor(game);
    const latest = game.monthlyHistory[0];
    if (!latest) return;
    const isReliable = reliable(latest);
    progress.reliableMonths = isReliable ? progress.reliableMonths + 1 : 0;
    if (progress.reliableMonths >= 12) award(progress, "LIGHTS_ON");
    if (latest.demandWh > 0 && latest.supplyWh / latest.demandWh < 0.99)
      progress.recoveryMonths = 0;
    else if (progress.recoveryMonths >= 0) {
      progress.recoveryMonths = isReliable ? progress.recoveryMonths + 1 : -1;
      if (progress.recoveryMonths >= 3) {
        // This milestone requires the run to remain alive past the recovery month.
        if (continuing) award(progress, "BACK_ON_THE_GRID");
        progress.recoveryMonths = -1;
      }
    }
    const counters = progress.month;
    if (isReliable && game.date.monthsElapsed > progress.counterStartMonth) {
      if (
        counters.nightServedWh > 0 &&
        counters.nightStorageWh / counters.nightServedWh >= 0.25
      )
        award(progress, "NIGHT_SHIFT");
      if (counters.importedWh / latest.demandWh >= 0.1)
        award(progress, "GRID_CONNECTED");
      if (counters.exportedWh / latest.demandWh >= 0.1)
        award(progress, "GOOD_NEIGHBOR");
      if (
        counters.eligibleWh > 0 &&
        counters.efficiencyWh / counters.eligibleWh >= 0.1
      )
        award(progress, "A_WATT_SAVED");
    }
    progress.month = emptyMonth();
  },
  finish(game, outcome) {
    if (!eligible(game)) return;
    if (outcome === "bankrupt") {
      award(progressFor(game), "OUT_OF_JUICE");
      return;
    }
    if (outcome !== "completed") return;
    const scenario = SCENARIOS.find(({ id }) => id === game.scenarioId)!;
    if (game.monthlyHistory.length < scenario.durationMonths!) return;
    const progress = progressFor(game);
    progress.completion = {
      scenarioId: game.scenarioId,
      difficulty: game.difficulty,
    };
    award(progress, "STAYING_POWER");
    if (game.difficulty === "CEO") award(progress, "CHIEF_ELECTRICITY_OFFICER");
    const entry = catalog.find(
      (item) => "scenarioId" in item && item.scenarioId === game.scenarioId,
    );
    if (entry) award(progress, entry.id);
    const lifetime = summarizeHistory(game.monthlyHistory);
    if (
      lifetime.demandWh > 0 &&
      lifetime.supplyWh / lifetime.demandWh >= 0.9999
    )
      award(progress, "FOUR_NINES");
    const final = game.monthlyHistory.slice(0, 12);
    if (final.length !== 12 || !final.every(reliable)) return;
    const summary = summarizeHistory(final);
    if (intensity(final) <= 100) award(progress, "CLEAN_FINISH");
    if (game.monthlyHistory.length >= 24) {
      const initial = intensity(game.monthlyHistory.slice(-12));
      if (
        Number.isFinite(initial) &&
        initial > 0 &&
        intensity(final) <= initial / 2
      )
        award(progress, "HALF_THE_CARBON");
    }
    if (progress.startedWithCoal && (summary.deliveredWhByFuel.Coal ?? 0) === 0)
      award(progress, "COALS_LAST_SHIFT");
    if ((summary.deliveredWhByFuel.Sun ?? 0) / summary.supplyWh >= 0.5)
      award(progress, "HERE_COMES_THE_SUN");
    const wind = ["Wind", "Offshore Wind", "Airborne Wind"] as const;
    if (
      wind.reduce(
        (sum, fuel) => sum + (summary.deliveredWhByFuel[fuel] ?? 0),
        0,
      ) /
        summary.supplyWh >=
      0.5
    )
      award(progress, "WINDS_OF_CHANGE");
    if (
      Object.values(summary.deliveredWhByFuel).filter(
        (wh) => (wh ?? 0) / summary.supplyWh >= 0.1,
      ).length >= 4
    )
      award(progress, "STRENGTH_IN_DIVERSITY");
    if (
      scenario.ownership === "Public" &&
      startingDollarRevenue(game.monthlyHistory, game.startingYear, game.seed) /
        (lifetime.supplyWh / 1000) <=
        scenario.dollarsPerkWh
    )
      award(progress, "POWER_TO_THE_PEOPLE");
  },
  converted(game, facilityId) {
    if (!eligible(game)) return;
    const facility = game.facilities.find(({ id }) => id === facilityId);
    if (facility) progressFor(game).convertedWh[assetKey(facility)] = 0;
  },
  tutorial(game) {
    const scenario = SCENARIOS.find(({ id }) => id === game.scenarioId);
    if (
      game.replayPlayback ||
      game.customScenario ||
      !TUTORIAL_IDS.includes(game.scenarioId) ||
      !scenario?.tutorialSteps ||
      game.tutorialStep < scenario.tutorialSteps.length
    )
      return;
    const progress = progressFor(game);
    progress.completion = {
      scenarioId: game.scenarioId,
      difficulty: game.difficulty,
    };
    if (game.scenarioId === 0) award(progress, "FIRST_SPARK");
  },
  validate: validAchievementProgress,
};

/** Bounded optional telemetry is validated before any imported save reaches the hooks. */
export function validAchievementProgress(value: unknown): boolean {
  if (value === undefined) return true;
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const p = value as AchievementProgress;
  const nonnegative = (n: unknown) =>
    typeof n === "number" && Number.isFinite(n) && n >= 0;
  const validKey = (key: unknown) =>
    typeof key === "string" &&
    key.length <= 100 &&
    /^\d+:-?\d+(?:\.\d+)?:(?:inherited|\d+(?:\.\d+)?)$/.test(key);
  const keys = (v: unknown) =>
    Array.isArray(v) &&
    v.length <= 10000 &&
    new Set(v).size === v.length &&
    v.every(validKey);
  return (
    p.version === 1 &&
    typeof p.startedWithCoal === "boolean" &&
    keys(p.startingFacilityKeys) &&
    keys(p.startingLineKeys) &&
    typeof p.commissionedIntertie === "boolean" &&
    Number.isSafeInteger(p.lastMinute) &&
    p.lastMinute >= 0 &&
    [p.counterStartMonth, p.reliableMonths].every(
      (n) => Number.isSafeInteger(n) && n >= 0,
    ) &&
    Number.isSafeInteger(p.recoveryMonths) &&
    p.recoveryMonths >= -1 &&
    p.recoveryMonths <= 3 &&
    !!p.month &&
    Object.keys(p.month).length === 6 &&
    Object.keys(emptyMonth()).every((key) =>
      nonnegative(p.month[key as keyof AchievementMonth]),
    ) &&
    !!p.convertedWh &&
    typeof p.convertedWh === "object" &&
    !Array.isArray(p.convertedWh) &&
    Object.keys(p.convertedWh).length <= 10000 &&
    Object.entries(p.convertedWh).every(
      ([key, wh]) => validKey(key) && nonnegative(wh),
    ) &&
    Array.isArray(p.earned) &&
    p.earned.length <= catalog.length &&
    new Set(p.earned).size === p.earned.length &&
    p.earned.every((id) => achievementIds.has(id)) &&
    (p.completion === undefined ||
      (!!p.completion &&
        [...TUTORIAL_IDS, ...OFFICIAL_IDS].includes(p.completion.scenarioId) &&
        ["Intern", "Employee", "Manager", "VP", "CEO"].includes(
          p.completion.difficulty,
        )))
  );
}
