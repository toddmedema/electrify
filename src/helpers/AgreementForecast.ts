import { GAME_TO_REAL_YEARS, TICK_MINUTES } from "../Constants";
import type {
  GameType,
  PowerAgreementReceipt,
  TickPresentFutureType,
} from "../Types";
import { generateForecastTimeline } from "../reducers/Game";
import { currentTick } from "./GameSelectors";
import { isUtilityExpansionGame } from "./ExpansionContext";
import { projectionSignature } from "./Projection";
import { agreementIntervalMinutes } from "./PowerAgreements";

export interface AgreementService {
  demandMWh: number;
  servedMWh: number;
}
export interface AgreementForecast {
  cutoffMinute: number;
  startMinute: number;
  endMinute: number;
  cashDifference: number;
  withAgreement: AgreementService;
  withoutAgreement: AgreementService;
}
export interface AgreementForecastRequest {
  kind: "agreement";
  requestId: number;
  game: GameType;
  offer: PowerAgreementReceipt;
  cacheEpoch?: string;
}
export interface AgreementForecastReply {
  requestId: number;
  agreementForecast?: AgreementForecast;
  error?: boolean;
}

export function agreementForecastKey(
  game: GameType,
  offer: PowerAgreementReceipt,
): string {
  const hasMonthlyMinimum =
    game.transmission?.inheritedAgreementTerms === 3 ||
    game.transmission?.acceptedAgreements?.some(
      (receipt) => receipt.termsVersion === 3,
    ) ||
    offer.termsVersion === 3;
  const meter = hasMonthlyMinimum
    ? JSON.stringify([
        game.date.minute,
        game.transmission?.agreementAccounts
          ?.filter((account) => account.termsVersion === 3)
          .map((account) => [
            account.agreementId,
            account.accountingStartMinute,
            account.accountedThroughMinute,
            account.months.at(-1),
          ]),
      ])
    : "";
  return `${projectionSignature(game)}|${meter}|${JSON.stringify({ ...offer, acceptedMinute: 0 })}`;
}

const results = new Map<string, AgreementForecast>();

function service(
  timeline: TickPresentFutureType[],
  start: number,
  end: number,
): AgreementService {
  const result: AgreementService = { demandMWh: 0, servedMWh: 0 };
  for (const tick of timeline) {
    const hours =
      ((agreementIntervalMinutes(
        tick.minute - TICK_MINUTES,
        tick.minute,
        start,
        end,
      ) /
        60) *
        GAME_TO_REAL_YEARS) /
      1e6;
    result.demandMWh += Math.max(0, tick.demandW) * hours;
    result.servedMWh +=
      Math.max(0, Math.min(tick.supplyW, tick.demandW)) * hours;
  }
  return result;
}

/** The real engine, twice, through the exact exclusive delivery end. Worker callers only. */
export function computeAgreementForecast(
  game: GameType,
  offer: PowerAgreementReceipt,
  cacheEpoch = "default",
): AgreementForecast {
  if (
    game.multiplayer ||
    (!isUtilityExpansionGame(game) && game.transmission?.buyingRule === "NONE")
  )
    throw new Error("Comparison unavailable");
  const key = `${cacheEpoch}|${agreementForecastKey(game, offer)}`;
  const cached = results.get(key);
  if (cached) return cached;
  const now = currentTick(game);
  if (!now || !game.transmission) throw new Error("No current frame");
  const assessed = {
    ...game,
    transmission: {
      ...game.transmission,
      acceptedAgreements: [
        ...(game.transmission.acceptedAgreements ?? []),
        offer,
      ],
    },
  };
  const agreementId = `${offer.blockId}:${offer.cycle}`;
  const cutoff = game.date.minute;
  const start = Math.max(cutoff, offer.startMinute);
  const end = offer.endMinute;
  const ticks = (end - cutoff) / TICK_MINUTES + 1;
  if (!Number.isSafeInteger(ticks) || ticks <= 1)
    throw new Error("Invalid delivery boundary");
  const withTimeline = generateForecastTimeline(
    assessed,
    now.cash,
    now.customers,
    ticks,
  );
  const withoutTimeline = generateForecastTimeline(
    assessed,
    now.cash,
    now.customers,
    ticks,
    TICK_MINUTES,
    undefined,
    agreementId,
  );
  const result: AgreementForecast = {
    cutoffMinute: cutoff,
    startMinute: start,
    endMinute: end,
    cashDifference: withTimeline.at(-1)!.cash - withoutTimeline.at(-1)!.cash,
    withAgreement: service(withTimeline, start, end),
    withoutAgreement: service(withoutTimeline, start, end),
  };
  results.set(key, result);
  if (results.size > 6) results.delete(results.keys().next().value!);
  return result;
}
