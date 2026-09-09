import cloneDeep from "lodash.clonedeep";
import { GAME_TO_REAL_YEARS, TICK_MINUTES, TICKS_PER_YEAR } from "../Constants";
import { GENERATORS, STORAGE } from "../data/Facilities";
import gameReducer, {
  buildFacility,
  generateNewTimeline,
} from "../reducers/Game";
import { GameType, TickPresentFutureType } from "../Types";
import { getTimeFromTimeline } from "./DateTime";

export interface InvestmentPurchase {
  kind: "generator" | "storage";
  name: string;
  capacity: number;
  financed: boolean;
}

export function investmentCatalog(
  game: GameType,
  kind: InvestmentPurchase["kind"],
  capacity: number,
) {
  if (!Number.isFinite(capacity) || capacity < 1 || capacity > 10000) return [];
  const timeline = game.timeline;
  return kind === "storage"
    ? STORAGE(game, capacity * 1e6)
    : GENERATORS(
        game,
        capacity * 1e6,
        timeline.map((t) => t.windKph),
        timeline.map((t) => t.solarIrradianceWM2),
        timeline.flatMap((t) =>
          t.windOffshoreKph === undefined ? [] : [t.windOffshoreKph],
        ),
        timeline.map((t) => t.windAirborneKph),
      );
}

export function stageInvestments(
  game: GameType,
  purchases: InvestmentPurchase[],
): GameType {
  if (purchases.length > 8) throw new Error("Test up to 8 purchases at once.");
  let draft = cloneDeep(game);
  for (const purchase of purchases) {
    const facility = investmentCatalog(
      draft,
      purchase.kind,
      purchase.capacity,
    ).find((f) => f.name === purchase.name);
    if (
      !facility ||
      !facility.available ||
      facility.viableLocationsRemaining === 0 ||
      ("maxPeakWh" in facility
        ? facility.peakWh! > facility.maxPeakWh
        : facility.peakW > facility.maxPeakW)
    ) {
      throw new Error(
        `${purchase.name} is unavailable at this capacity or has no sites left.`,
      );
    }
    const next = gameReducer(
      draft,
      buildFacility({ facility, financed: purchase.financed }),
    );
    if (next.facilities.length !== draft.facilities.length + 1) {
      throw new Error(
        `Not enough cash for ${purchase.name}. Reduce the plan or choose a loan.`,
      );
    }
    draft = next;
  }
  return draft;
}

function summarize(timeline: TickPresentFutureType[], startingCash: number) {
  const last = timeline[timeline.length - 1];
  return {
    cash: last.cash,
    netWorth: last.netWorth,
    minimumCash: Math.min(startingCash, ...timeline.map((t) => t.cash)),
    firstShortage:
      timeline.find((t) => t.demandW - t.supplyW > 1)?.minute ?? null,
    shortageWh: timeline.reduce(
      (total, t) =>
        total +
        ((Math.max(0, t.demandW - t.supplyW) * TICK_MINUTES) / 60) *
          GAME_TO_REAL_YEARS,
      0,
    ),
    kgco2e: timeline.reduce((total, t) => total + t.kgco2e, 0),
  };
}

/** Shared simulation forecast: construction, dispatch, storage, debt and story effects. */
export function previewInvestments(
  game: GameType,
  purchases: InvestmentPurchase[],
  years: number,
) {
  if (![1, 3, 5].includes(years))
    throw new Error("Choose a 1, 3 or 5 year horizon.");
  const draft = stageInvestments(game, purchases);
  const project = (state: GameType) => {
    const now = getTimeFromTimeline(state.date.minute, state.timeline);
    if (!now) throw new Error("No current simulation tick.");
    return summarize(
      generateNewTimeline(
        state,
        now.cash,
        now.customers,
        years * TICKS_PER_YEAR + 1,
      ).slice(1),
      now.cash,
    );
  };
  return { before: project(game), after: project(draft) };
}
export type InvestmentPreviewResult = ReturnType<typeof previewInvestments>;
