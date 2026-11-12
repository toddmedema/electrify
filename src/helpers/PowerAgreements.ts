import { GAME_TO_REAL_YEARS, TICK_MINUTES } from "../Constants";
import type {
  AcceptPowerAgreementAction,
  GameType,
  PowerAgreementReceipt,
  PowerAgreementTermsVersion,
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
export function powerAgreementQuote(
  game: GameType,
  blockId: string,
  termsVersion: PowerAgreementTermsVersion = 2,
) {
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
    termsVersion,
    blockId,
    cycle: receipts.length,
    acceptedMinute: game.date.minute,
    startMinute,
    endMinute: startMinute + block.years * 12 * MINUTES_PER_MONTH,
  };
  // A review binds commercial terms; the acceptance timestamp is recorded on confirmation.
  const { acceptedMinute: _acceptedMinute, ...terms } = receipt;
  return {
    ...block,
    receipt,
    deliverableW: block.nominalW * 0.95,
    priceToday: agreementPrice(game, block.pricePerMWh),
    quoteKey: JSON.stringify({
      ...terms,
      nominalW: block.nominalW,
      pricePerMWh: block.pricePerMWh,
      deliverability: 0.95,
    }),
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
      termsVersion: game.transmission?.inheritedAgreementTerms ?? 2,
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
          termsVersion: game.transmission?.inheritedAgreementTerms ?? 2,
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
              termsVersion: receipt.termsVersion,
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
      (receipt.termsVersion !== 1 && receipt.termsVersion !== 2) ||
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
    const quote = powerAgreementQuote(
      atAcceptance,
      receipt.blockId,
      receipt.termsVersion,
    );
    if (
      !quote ||
      JSON.stringify(quote.receipt) !==
        JSON.stringify({
          termsVersion: receipt.termsVersion,
          blockId: receipt.blockId,
          cycle: receipt.cycle,
          acceptedMinute: receipt.acceptedMinute,
          startMinute: receipt.startMinute,
          endMinute: receipt.endMinute,
        }) ||
      Object.keys(receipt).length !== 6
    )
      return false;
  }
  if (!validAgreementAccounts(game)) return false;
  if (!game.utilityExpansion)
    return (
      game.transmission?.inheritedAgreementTerms === undefined &&
      !game.transmission?.lines.some((line) =>
        inheritedUtilityForCorridor(line.corridorId),
      )
    );
  if (![1, 2].includes(game.transmission?.inheritedAgreementTerms ?? 0))
    return false;
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

/** A settled interval overlaps a half-open delivery term; calendar energy uses the engine scale. */
export function agreementIntervalMinutes(
  start: number,
  end: number,
  deliveryStart: number,
  deliveryEnd: number,
): number {
  return Math.max(
    0,
    Math.min(end, deliveryEnd) - Math.max(start, deliveryStart),
  );
}

/** Append only completed elapsed intervals. Forecasts use the same settlements privately. */
export function recordAgreementSettlements(
  game: GameType,
  start: number,
  end: number,
  settlements: import("../Types").PowerAgreementSettlement[],
): void {
  if (!game.transmission || end <= start || !settlements.length) return;
  const accounts = (game.transmission.agreementAccounts ??= []);
  for (const settlement of settlements) {
    const source = (Object.keys(INHERITED_CONNECTIONS) as UtilityId[])
      .flatMap((id) => connectionAgreements(game, id, start))
      .find((entry) => entry.id === settlement.agreementId)!;
    const from = Math.max(start, source.startMinute);
    const through = Math.min(end, source.endMinute);
    if (through <= from) continue;
    let account = accounts.find((entry) => entry.agreementId === source.id);
    if (!account) {
      account = {
        agreementId: source.id,
        termsVersion: source.termsVersion,
        accountingStartMinute: from,
        accountedThroughMinute: from,
        months: [],
      };
      accounts.push(account);
    }
    if (account.accountedThroughMinute !== from)
      throw new Error("Noncontiguous agreement settlement");
    const month = Math.floor(from / MINUTES_PER_MONTH);
    let row = account.months.at(-1);
    if (!row || row.month !== month) {
      row = { month, availableMWh: 0, usefulMWh: 0, payment: 0 };
      account.months.push(row);
    }
    row.availableMWh += settlement.availableMWh;
    row.usefulMWh += settlement.usefulMWh;
    row.payment += settlement.payment;
    account.accountedThroughMinute = through;
  }
}

function validAgreementAccounts(game: GameType): boolean {
  const accounts = game.transmission?.agreementAccounts;
  if (accounts === undefined) return true;
  if (
    !game.utilityExpansion ||
    !Array.isArray(accounts) ||
    accounts.length > 30
  )
    return false;
  const ids = new Set<string>();
  for (const account of accounts) {
    if (
      !account ||
      typeof account !== "object" ||
      ids.has(account.agreementId) ||
      Object.keys(account).length !== 5 ||
      !Array.isArray(account.months) ||
      account.months.length > 600
    )
      return false;
    ids.add(account.agreementId);
    const utility = (Object.keys(INHERITED_CONNECTIONS) as UtilityId[]).find(
      (id) =>
        utilityOwnedAt(game, id, game.date.minute) &&
        connectionAgreements(game, id).some(
          (source) => source.id === account.agreementId,
        ),
    );
    const source =
      utility &&
      connectionAgreements(game, utility).find(
        (entry) => entry.id === account.agreementId,
      );
    if (!source || source.termsVersion !== account.termsVersion) return false;
    const ownership =
      utility === "champlain"
        ? 0
        : game.utilityExpansion.acquisitions.find(
            (receipt) => receipt.targetId === utility,
          )!.minute;
    const { accountingStartMinute: start, accountedThroughMinute: end } =
      account;
    if (
      ![start, end].every(
        (value) => Number.isSafeInteger(value) && value % TICK_MINUTES === 0,
      ) ||
      start < Math.max(source.startMinute, ownership) ||
      end <= start ||
      end > Math.min(game.date.minute, source.endMinute)
    )
      return false;
    const firstMonth = Math.floor(start / MINUTES_PER_MONTH);
    if (
      account.months.length !==
      Math.floor((end - 1) / MINUTES_PER_MONTH) - firstMonth + 1
    )
      return false;
    for (const [index, row] of account.months.entries()) {
      if (
        !row ||
        typeof row !== "object" ||
        Object.keys(row).length !== 4 ||
        row.month !== firstMonth + index ||
        ![row.availableMWh, row.usefulMWh, row.payment].every(
          (value) => Number.isFinite(value) && value >= 0,
        ) ||
        row.usefulMWh > row.availableMWh + 1e-6
      )
        return false;
      const minute = row.month * MINUTES_PER_MONTH;
      const monthlySource = connectionAgreements(game, utility!, minute).find(
        (entry) => entry.id === source.id,
      )!;
      const overlap = agreementIntervalMinutes(
        start,
        end,
        minute,
        minute + MINUTES_PER_MONTH,
      );
      const maximumMWh =
        (((monthlySource.nominalW * monthlySource.deliverability * overlap) /
          60) *
          GAME_TO_REAL_YEARS) /
        1e6;
      const payment =
        (source.termsVersion === 2 ? row.availableMWh : row.usefulMWh) *
        monthlySource.priceToday;
      if (
        row.availableMWh > maximumMWh + 1e-6 ||
        Math.abs(row.payment - payment) > Math.max(1e-5, payment * 1e-10)
      )
        return false;
    }
  }
  return true;
}
