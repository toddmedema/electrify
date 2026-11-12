import { TICK_MINUTES } from "../Constants";
import type {
  AcceptPowerAgreementAction,
  GameType,
  PowerAgreementReceipt,
  TransmissionLineOperatingType,
  UtilityId,
} from "../Types";
import {
  POWER_AGREEMENT_BLOCKS,
  UTILITY_AREAS,
  utilityEntitlementsAt,
} from "../data/UtilityExpansion";
import { getDateFromMinute, MINUTES_PER_MONTH } from "./DateTime";
import { getInflationIndex, hasEconomy } from "../data/Economy";
import { importEmissionsKgco2ePerMWh } from "../data/ImportEmissions";

export const INHERITED_CONNECTIONS: Readonly<Record<UtilityId, string>> = {
  champlain: "vt-champlain-regional",
  "valley-electric": "vt-valley-regional",
  "ridge-electric": "vt-ridge-regional",
};
export const inheritedUtilityForCorridor = (id: string) =>
  (Object.keys(INHERITED_CONNECTIONS) as UtilityId[]).find(
    (utility) => INHERITED_CONNECTIONS[utility] === id,
  );
export function utilityOwnedAt(
  game: Pick<GameType, "utilityExpansion">,
  id: UtilityId,
  minute: number,
): boolean {
  return (
    !!game.utilityExpansion &&
    (id === "champlain" ||
      game.utilityExpansion.acquisitions.some(
        (receipt) => receipt.targetId === id && receipt.minute <= minute,
      ))
  );
}
export function inheritedConnection(
  id: UtilityId,
  lineId: number,
  minute = 0,
): TransmissionLineOperatingType {
  return {
    id: lineId,
    corridorId: INHERITED_CONNECTIONS[id],
    name: `${id === "champlain" ? "Champlain" : id === "valley-electric" ? "Valley" : "Ridge"} regional connection`,
    capacityW: UTILITY_AREAS[id].sourceInterfaceW,
    buildCost: 0,
    annualOperatingCost: 0,
    yearsToBuildLeft: 0,
    minuteCreated: minute,
    financed: false,
    loanAmountLeft: 0,
    loanMonthlyPayment: 0,
    interestRate: 0,
    currentFlowW: 0,
  };
}
export { POWER_AGREEMENT_BLOCKS } from "../data/UtilityExpansion";

/** The game clock compresses one calendar month to one simulated day. */
export function agreementDate(minute: number, lastDay = false): string {
  const date = getDateFromMinute(lastDay ? minute - 1 : minute, 2005);
  const day = lastDay
    ? new Date(Date.UTC(date.year, date.monthNumber, 0)).getUTCDate()
    : 1;
  return `${day} ${date.month} ${date.year}`;
}
export const agreementYearMinute = (year: number) =>
  (year - 2005) * 12 * MINUTES_PER_MONTH;
const FINISH = agreementYearMinute(2025);

export function agreementPrice(
  game: GameType,
  base: number,
  minute = game.date.minute,
) {
  return (
    base *
    (hasEconomy()
      ? getInflationIndex(getDateFromMinute(minute, 2005), 2005, game.seed)
      : 1)
  );
}
/** Quotes resolve dates once; the reducer verifies exactly what the player reviewed. */
export function powerAgreementQuote(game: GameType, blockId: string) {
  if (game.scenarioId !== 116 || game.customScenario) return undefined;
  const block = POWER_AGREEMENT_BLOCKS.find((entry) => entry.id === blockId);
  if (!block || !utilityOwnedAt(game, block.utilityId, game.date.minute))
    return undefined;
  const line = game.transmission?.lines.find(
    (entry) =>
      entry.corridorId === INHERITED_CONNECTIONS[block.utilityId] &&
      entry.yearsToBuildLeft === 0,
  );
  if (!line) return undefined;
  const receipts =
    game.transmission?.acceptedAgreements?.filter(
      (receipt) => receipt.blockId === blockId,
    ) ?? [];
  const last = receipts[receipts.length - 1];
  const boundary = last?.endMinute ?? agreementYearMinute(block.lossYear);
  if (game.date.minute < boundary - 24 * MINUTES_PER_MONTH) return undefined;
  const startMinute =
    game.date.minute <= boundary
      ? boundary
      : (Math.floor(game.date.minute / MINUTES_PER_MONTH) + 1) *
        MINUTES_PER_MONTH;
  if (startMinute >= FINISH) return undefined;
  const receipt: PowerAgreementReceipt = {
    blockId,
    cycle: receipts.length,
    acceptedMinute: game.date.minute,
    startMinute,
    endMinute: startMinute + block.years * 12 * MINUTES_PER_MONTH,
  };
  return {
    ...block,
    receipt,
    deliverableW: block.nominalW * 0.95,
    priceToday: agreementPrice(game, block.pricePerMWh),
    quoteKey: JSON.stringify(receipt),
  };
}
export function validPowerAgreementAction(
  game: GameType,
  value: unknown,
): value is AcceptPowerAgreementAction {
  if (!value || typeof value !== "object") return false;
  const action = value as Partial<AcceptPowerAgreementAction>;
  const quote =
    typeof action.blockId === "string"
      ? powerAgreementQuote(game, action.blockId)
      : undefined;
  return !!quote && quote.quoteKey === action.quoteKey;
}
export function acceptAgreement(game: GameType, value: unknown): boolean {
  if (!validPowerAgreementAction(game, value) || !game.transmission)
    return false;
  const quote = powerAgreementQuote(game, value.blockId)!;
  (game.transmission.acceptedAgreements ??= []).push(quote.receipt);
  return true;
}
/** Coverage is nominal; delivery and physical/source limits are applied by transmission clearing. */
export function connectionAgreements(
  game: GameType,
  utilityId: UtilityId,
  minute = game.date.minute,
) {
  const date = getDateFromMinute(minute, 2005);
  const inherited = utilityEntitlementsAt(utilityId, date.year).map(
    (source) => ({
      ...source,
      inherited: true,
      startMinute: 0,
      endMinute: agreementYearMinute(
        source.reducedNominalW === 0 ? source.reductionYear! : 2025,
      ),
    }),
  );
  // Retain expired inherited records for honest compact history in the connection disclosure.
  const records = UTILITY_AREAS[utilityId].entitlements
    .filter((source) => !source.balancing)
    .map(
      (source) =>
        inherited.find((entry) => entry.id === source.id) ?? {
          ...source,
          nominalW: 0,
          inherited: true,
          startMinute: 0,
          endMinute: agreementYearMinute(
            source.reducedNominalW === 0 ? source.reductionYear! : 2025,
          ),
        },
    );
  const replacements = (game.transmission?.acceptedAgreements ?? []).flatMap(
    (receipt) => {
      const block = POWER_AGREEMENT_BLOCKS.find(
        (entry) =>
          entry.id === receipt.blockId && entry.utilityId === utilityId,
      );
      return block
        ? [
            {
              id: `${receipt.blockId}:${receipt.cycle}`,
              name: block.name,
              nominalW: block.nominalW,
              deliverability: 0.95,
              pricePerMWh: block.pricePerMWh,
              marketId: "marketId" in block ? block.marketId : "vt-valley-pool",
              emissionsKgPerMWh: undefined as number | undefined,
              reductionYear: undefined as number | undefined,
              reducedNominalW: undefined as number | undefined,
              inherited: false,
              startMinute: receipt.startMinute,
              endMinute: receipt.endMinute,
            },
          ]
        : [];
    },
  );
  return [...records, ...replacements].map((source) => ({
    ...source,
    active: minute >= source.startMinute && minute < source.endMinute,
    priceToday: agreementPrice(game, source.pricePerMWh, minute),
    emissionsKgPerMWh:
      source.emissionsKgPerMWh ??
      importEmissionsKgco2ePerMWh(
        source.marketId ?? "vt-valley-pool",
        date.year,
      ),
  }));
}
export function validPowerAgreements(game: GameType): boolean {
  const receipts = game.transmission?.acceptedAgreements;
  if (
    receipts !== undefined &&
    (!Array.isArray(receipts) || receipts.length > 6)
  )
    return false;
  if (receipts?.length && (game.scenarioId !== 116 || game.customScenario))
    return false;
  for (const [index, receipt] of (receipts ?? []).entries()) {
    if (
      !receipt ||
      typeof receipt !== "object" ||
      ![
        receipt.cycle,
        receipt.acceptedMinute,
        receipt.startMinute,
        receipt.endMinute,
      ].every((value) => Number.isSafeInteger(value) && value >= 0) ||
      receipt.acceptedMinute > game.date.minute ||
      receipt.acceptedMinute % TICK_MINUTES !== 0 ||
      (index > 0 &&
        receipt.acceptedMinute < receipts![index - 1].acceptedMinute)
    )
      return false;
    const atAcceptance = {
      ...game,
      date: getDateFromMinute(receipt.acceptedMinute, game.startingYear),
      transmission: {
        ...game.transmission!,
        acceptedAgreements: receipts!.slice(0, index),
      },
    };
    const quote = powerAgreementQuote(atAcceptance, receipt.blockId);
    if (
      !quote ||
      JSON.stringify(quote.receipt) !==
        JSON.stringify({
          blockId: receipt.blockId,
          cycle: receipt.cycle,
          acceptedMinute: receipt.acceptedMinute,
          startMinute: receipt.startMinute,
          endMinute: receipt.endMinute,
        }) ||
      Object.keys(receipt).length !== 5
    )
      return false;
  }
  if (!game.utilityExpansion)
    return !game.transmission?.lines.some((line) =>
      inheritedUtilityForCorridor(line.corridorId),
    );
  for (const utility of Object.keys(INHERITED_CONNECTIONS) as UtilityId[]) {
    const line = game.transmission?.lines.find(
      (entry) => entry.corridorId === INHERITED_CONNECTIONS[utility],
    );
    const owned = utilityOwnedAt(game, utility, game.date.minute);
    if (!!line !== owned) return false;
    if (
      line &&
      (line.capacityW !== UTILITY_AREAS[utility].sourceInterfaceW ||
        line.buildCost !== 0 ||
        line.annualOperatingCost !== 0 ||
        line.yearsToBuildLeft !== 0 ||
        line.upgrade ||
        line.financed ||
        line.loanAmountLeft !== 0 ||
        line.loanMonthlyPayment !== 0 ||
        line.interestRate !== 0 ||
        line.minuteCreated !==
          (utility === "champlain"
            ? 0
            : game.utilityExpansion!.acquisitions.find(
                (receipt) => receipt.targetId === utility,
              )!.minute))
    )
      return false;
  }
  return true;
}
