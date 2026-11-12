import cloneDeep from "lodash.clonedeep";
import { GAME_TO_REAL_YEARS, TICK_MINUTES } from "../Constants";
import type {
  GameType,
  PowerAgreementReceipt,
  TickPresentFutureType,
} from "../Types";
import { generateForecastTimeline } from "../reducers/Game";
import { currentTick } from "./GameSelectors";
import { projectionSignature } from "./Projection";
import {
  agreementIntervalMinutes,
  connectionAgreements,
  INHERITED_CONNECTIONS,
} from "./PowerAgreements";

export interface AgreementEnergy {
  availableMWh: number;
  usefulMWh: number;
  payment: number;
  unusedPayment: number;
}
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
  marketPurchases: AgreementService;
  remaining: AgreementEnergy;
  recorded: AgreementEnergy;
  recordingStartMinute: number;
  completeHistory: boolean;
  earlierHistoryUnavailable: boolean;
}
export interface AgreementForecastRequest {
  kind: "agreement";
  requestId: number;
  game: GameType;
  agreementId: string;
  offer?: PowerAgreementReceipt;
  cacheEpoch?: string;
}
export interface AgreementForecastReply {
  requestId: number;
  agreementForecast?: AgreementForecast;
  error?: boolean;
}

export function agreementForecastKey(
  game: GameType,
  agreementId: string,
  offer?: PowerAgreementReceipt,
): string {
  return `${projectionSignature(game)}|${agreementId}|${JSON.stringify(offer && { ...offer, acceptedMinute: 0 })}`;
}

const emptyEnergy = (): AgreementEnergy => ({
  availableMWh: 0,
  usefulMWh: 0,
  payment: 0,
  unusedPayment: 0,
});
const results = new Map<string, AgreementForecast>();
// A single rich baseline, shared by comparisons with the same full-term horizon.
let baseline: { key: string; timeline: TickPresentFutureType[] } | undefined;

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
  agreementId: string,
  offer?: PowerAgreementReceipt,
  cacheEpoch = "default",
): AgreementForecast {
  if (game.multiplayer || game.transmission?.buyingRule === "NONE")
    throw new Error("Comparison unavailable");
  const key = `${cacheEpoch}|${agreementForecastKey(game, agreementId, offer)}`;
  const cached = results.get(key);
  if (cached) return cached;
  const now = currentTick(game);
  if (!now || !game.transmission) throw new Error("No current frame");
  const assessed = offer
    ? {
        ...game,
        transmission: {
          ...game.transmission,
          acceptedAgreements: [
            ...(game.transmission.acceptedAgreements ?? []),
            offer,
          ],
        },
      }
    : game;
  const source = (
    Object.keys(INHERITED_CONNECTIONS) as import("../Types").UtilityId[]
  )
    .flatMap((utility) => connectionAgreements(assessed, utility))
    .find((entry) => entry.id === agreementId);
  if (!source || source.endMinute <= game.date.minute)
    throw new Error("Agreement expired");
  const cutoff = game.date.minute;
  const start = Math.max(cutoff, source.startMinute);
  const end = source.endMinute;
  const ticks = (end - cutoff) / TICK_MINUTES + 1;
  if (!Number.isSafeInteger(ticks) || ticks <= 1)
    throw new Error("Invalid delivery boundary");
  const baselineKey = `${cacheEpoch}|${projectionSignature(assessed)}|${cutoff}|${end}`;
  if (baseline?.key !== baselineKey)
    baseline = {
      key: baselineKey,
      timeline: generateForecastTimeline(
        assessed,
        now.cash,
        now.customers,
        ticks,
      ),
    };
  const withTimeline = baseline.timeline;
  const marketTimeline = generateForecastTimeline(
    assessed,
    now.cash,
    now.customers,
    ticks,
    TICK_MINUTES,
    undefined,
    agreementId,
  );
  const remaining = emptyEnergy();
  for (const tick of withTimeline) {
    if (tick.minute <= cutoff || tick.minute > end) continue;
    const available = tick.agreementAvailableMWh?.[agreementId] ?? 0;
    const useful = tick.agreementUsefulMWh?.[agreementId] ?? 0;
    const payment = tick.agreementPayments?.[agreementId] ?? 0;
    remaining.availableMWh += available;
    remaining.usefulMWh += useful;
    remaining.payment += payment;
    if (source.termsVersion === 2 && available > 0)
      remaining.unusedPayment += payment * Math.max(0, 1 - useful / available);
  }
  const account = game.transmission.agreementAccounts?.find(
    (entry) => entry.agreementId === agreementId,
  );
  const recorded = emptyEnergy();
  for (const row of account?.months ?? []) {
    recorded.availableMWh += row.availableMWh;
    recorded.usefulMWh += row.usefulMWh;
    recorded.payment += row.payment;
    if (source.termsVersion === 2 && row.availableMWh > 0)
      recorded.unusedPayment +=
        row.payment * Math.max(0, 1 - row.usefulMWh / row.availableMWh);
  }
  const ownership = source.inherited
    ? (game.utilityExpansion?.acquisitions.find((receipt) =>
        connectionAgreements(game, receipt.targetId).some(
          (entry) => entry.id === source.id,
        ),
      )?.minute ?? 0)
    : source.startMinute;
  const recordingStartMinute = account?.accountingStartMinute ?? start;
  const forecast: AgreementForecast = {
    cutoffMinute: cutoff,
    startMinute: start,
    endMinute: end,
    cashDifference: withTimeline.at(-1)!.cash - marketTimeline.at(-1)!.cash,
    withAgreement: service(withTimeline, start, end),
    marketPurchases: service(marketTimeline, start, end),
    remaining,
    recorded,
    recordingStartMinute,
    earlierHistoryUnavailable:
      recordingStartMinute > Math.max(source.startMinute, ownership),
    completeHistory:
      !source.inherited &&
      (account?.accountingStartMinute ?? start) <= source.startMinute,
  };
  // Freeze the actual-plus-remaining calculation at this exact cutoff. No live history is added.
  const result = cloneDeep(forecast);
  results.set(key, result);
  if (results.size > 6) results.delete(results.keys().next().value!);
  return result;
}
