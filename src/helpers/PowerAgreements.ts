import { GAME_TO_REAL_YEARS, TICK_MINUTES } from "../Constants";
import type {
  AcceptPowerAgreementAction,
  GameType,
  PowerAgreementReceipt,
  PowerAgreementMonth,
  PowerAgreementSettlement,
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
import {
  adjacentMarketPricePerMWh,
  intertieContextForGame,
} from "./Transmission";
import { getTimeFromTimeline } from "./DateTime";

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
export const AGREEMENT_MINIMUM_FRACTION = 0.7;

type AgreementDispatchSource = {
  id: string;
  termsVersion: PowerAgreementTermsVersion;
  pricePerMWh: number;
};
const AGREEMENT_DISPATCH_PRIORITY: Record<PowerAgreementTermsVersion, number> =
  {
    1: 2,
    2: 0,
    3: 1,
  };
/** Assign scarce readiness and useful delivery to fully paid blocks before monthly minima. */
export function compareAgreementDispatchPriority(
  a: AgreementDispatchSource,
  b: AgreementDispatchSource,
): number {
  return (
    AGREEMENT_DISPATCH_PRIORITY[a.termsVersion] -
      AGREEMENT_DISPATCH_PRIORITY[b.termsVersion] ||
    a.pricePerMWh - b.pricePerMWh ||
    a.id.localeCompare(b.id)
  );
}

/** Calibrated game rule: one-year reward 1%, ten-year reward 20%. */
export function agreementDurationDiscount(years: number): number {
  return 0.01 + ((Math.min(10, Math.max(1, years)) - 1) * 0.19) / 9;
}
export function agreementMonthlyEnergy(
  deliverableW: number,
  termsVersion: PowerAgreementTermsVersion = 3,
) {
  const maximumMWhPerMonth =
    (deliverableW * (MINUTES_PER_MONTH / 60) * GAME_TO_REAL_YEARS) / 1e6;
  return {
    maximumMWhPerMonth,
    minimumMWhPerMonth:
      maximumMWhPerMonth *
      (termsVersion === 3
        ? AGREEMENT_MINIMUM_FRACTION
        : termsVersion === 2
          ? 1
          : 0),
  };
}
/** Supplier capacity and ordinary market pricing are independent of this commercial cap. */
export function agreementRate(
  game: GameType,
  base: number,
  durationYears: number,
  corridorId: string,
  minute = game.date.minute,
  conditions = getTimeFromTimeline(minute, game.timeline) ?? {
    temperatureC: 15,
  },
  marketMinute = minute,
): number {
  return (
    Math.min(
      agreementPrice(game, base, minute),
      adjacentMarketPricePerMWh(
        corridorId,
        intertieContextForGame(game),
        marketMinute,
        conditions,
      ),
    ) *
    (1 - agreementDurationDiscount(durationYears))
  );
}
// One-year renewals can start only before FINISH. Keep hostile save arrays bounded.
const MAX_RECEIPTS = POWER_AGREEMENT_BLOCKS.reduce(
  (sum, block) => sum + Math.max(0, 2025 - block.lossYear),
  0,
);
const MAX_ACCOUNTS =
  MAX_RECEIPTS +
  Object.values(UTILITY_AREAS).reduce(
    (sum, utility) =>
      sum + utility.entitlements.filter((entry) => !entry.balancing).length,
    0,
  );

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
  termsVersion: PowerAgreementTermsVersion = 3,
  selectedDurationYears?: number,
) {
  return quotePowerAgreement(
    game,
    blockId,
    termsVersion,
    selectedDurationYears,
  );
}
/** Only receipt validation may provide historical signing conditions. */
function quotePowerAgreement(
  game: GameType,
  blockId: string,
  termsVersion: PowerAgreementTermsVersion,
  selectedDurationYears?: number,
  signingTemperatureC = getTimeFromTimeline(game.date.minute, game.timeline)
    ?.temperatureC ?? 15,
) {
  if (game.scenarioId !== 116 || game.customScenario) return undefined;
  const block = POWER_AGREEMENT_BLOCKS.find((entry) => entry.id === blockId);
  if (!block || !utilityOwnedAt(game, block.utilityId, game.date.minute))
    return undefined;
  const durationYears =
    termsVersion === 3
      ? selectedDurationYears === undefined
        ? block.years
        : selectedDurationYears
      : block.years;
  if (
    termsVersion === 3 &&
    (!Number.isSafeInteger(durationYears) ||
      durationYears < 1 ||
      durationYears > 10 ||
      !Number.isFinite(signingTemperatureC) ||
      Math.abs(signingTemperatureC) > 100)
  )
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
  const dates = {
    blockId,
    cycle: receipts.length,
    acceptedMinute: game.date.minute,
    startMinute,
    endMinute: startMinute + durationYears * 12 * MINUTES_PER_MONTH,
  };
  const signingMarketPricePerMWh = adjacentMarketPricePerMWh(
    INHERITED_CONNECTIONS[block.utilityId],
    intertieContextForGame(game),
    game.date.minute,
    { temperatureC: signingTemperatureC },
  );
  const receipt: PowerAgreementReceipt =
    termsVersion === 3
      ? {
          termsVersion,
          ...dates,
          durationYears,
          signingMarketPricePerMWh,
          signingTemperatureC,
        }
      : { termsVersion, ...dates };
  // A review binds commercial terms; the acceptance timestamp is recorded on confirmation.
  const { acceptedMinute: _acceptedMinute, ...terms } = receipt;
  return {
    ...block,
    receipt,
    deliverableW: block.nominalW * 0.95,
    durationYears,
    durationDiscount:
      termsVersion === 3 ? agreementDurationDiscount(durationYears) : 0,
    ...agreementMonthlyEnergy(block.nominalW * 0.95, termsVersion),
    priceToday:
      termsVersion === 3
        ? signingMarketPricePerMWh *
          (1 - agreementDurationDiscount(durationYears))
        : agreementPrice(game, block.pricePerMWh),
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
      ? powerAgreementQuote(game, action.blockId, 3, action.durationYears)
      : undefined;
  return (
    !!quote &&
    (action.durationYears === undefined ||
      (Number.isSafeInteger(action.durationYears) &&
        action.durationYears >= 1 &&
        action.durationYears <= 10)) &&
    quote.quoteKey === action.quoteKey
  );
}
export function acceptAgreement(game: GameType, value: unknown): boolean {
  if (!validPowerAgreementAction(game, value) || !game.transmission)
    return false;
  const quote = powerAgreementQuote(
    game,
    value.blockId,
    3,
    value.durationYears,
  )!;
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
      termsVersion: game.transmission?.inheritedAgreementTerms ?? 3,
      durationYears:
        (source.reducedNominalW === 0 ? source.reductionYear! : 2025) - 2005,
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
          termsVersion: game.transmission?.inheritedAgreementTerms ?? 3,
          durationYears:
            (source.reducedNominalW === 0 ? source.reductionYear! : 2025) -
            2005,
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
              pricePerMWh:
                receipt.termsVersion === 3
                  ? receipt.signingMarketPricePerMWh /
                    agreementPrice(game, 1, receipt.acceptedMinute)
                  : block.pricePerMWh,
              marketId: "marketId" in block ? block.marketId : "vt-valley-pool",
              emissionsKgPerMWh: undefined as number | undefined,
              reductionYear: undefined as number | undefined,
              reducedNominalW: undefined as number | undefined,
              inherited: false,
              termsVersion: receipt.termsVersion,
              durationYears: receipt.durationYears ?? block.years,
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
    durationDiscount:
      source.termsVersion === 3
        ? agreementDurationDiscount(source.durationYears)
        : 0,
    ...agreementMonthlyEnergy(
      source.nominalW * source.deliverability,
      source.termsVersion,
    ),
    priceToday:
      source.termsVersion === 3
        ? agreementRate(
            game,
            source.pricePerMWh,
            source.durationYears,
            INHERITED_CONNECTIONS[utilityId],
            minute,
          )
        : agreementPrice(game, source.pricePerMWh, minute),
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
    (!Array.isArray(receipts) || receipts.length > MAX_RECEIPTS)
  )
    return false;
  if (receipts?.length && (game.scenarioId !== 116 || game.customScenario))
    return false;
  for (const [index, receipt] of (receipts ?? []).entries()) {
    if (
      !receipt ||
      ![1, 2, 3].includes(receipt.termsVersion) ||
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
    const quote = quotePowerAgreement(
      atAcceptance,
      receipt.blockId,
      receipt.termsVersion,
      receipt.durationYears,
      receipt.signingTemperatureC,
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
          ...(receipt.termsVersion === 3
            ? {
                durationYears: receipt.durationYears,
                signingMarketPricePerMWh: receipt.signingMarketPricePerMWh,
                signingTemperatureC: receipt.signingTemperatureC,
              }
            : {}),
        }) ||
      Object.keys(receipt).length !== (receipt.termsVersion === 3 ? 9 : 6)
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
  if (![1, 2, 3].includes(game.transmission?.inheritedAgreementTerms ?? 0))
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

/** Monthly energy, with a weighted availability rate for unused minimum energy. */
export function agreementMonthTopUp(row: PowerAgreementMonth): number {
  return row.availableMWh > 0
    ? Math.max(
        0,
        AGREEMENT_MINIMUM_FRACTION * row.availableMWh - row.usefulMWh,
      ) *
        (row.availableValue! / row.availableMWh)
    : 0;
}

/** Append completed intervals and return the new, cash-payable v3 month-closing top-up. */
export function recordAgreementSettlements(
  game: GameType,
  start: number,
  end: number,
  settlements: PowerAgreementSettlement[],
  closingExpenses?: Record<string, number>,
): number {
  if (!game.transmission || end <= start || !settlements.length) return 0;
  const accounts = (game.transmission.agreementAccounts ??= []);
  const sources = (Object.keys(INHERITED_CONNECTIONS) as UtilityId[]).flatMap(
    (id) => connectionAgreements(game, id, start),
  );
  let topUps = 0;
  for (const settlement of settlements) {
    const source = sources.find(
      (entry) => entry.id === settlement.agreementId,
    )!;
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
    // Hourly sampled horizons opened between hours can straddle a calendar boundary.
    let cursor = from;
    while (cursor < through) {
      const month = Math.floor(cursor / MINUTES_PER_MONTH);
      const boundary = Math.min(through, (month + 1) * MINUTES_PER_MONTH);
      const fraction = (boundary - cursor) / (through - from);
      let row = account.months.at(-1);
      if (!row || row.month !== month) {
        row = {
          month,
          availableMWh: 0,
          usefulMWh: 0,
          payment: 0,
          ...(source.termsVersion === 3
            ? { availableValue: 0, usefulValue: 0 }
            : {}),
        };
        account.months.push(row);
      }
      row.availableMWh += settlement.availableMWh * fraction;
      row.usefulMWh += settlement.usefulMWh * fraction;
      if (source.termsVersion === 3) {
        row.availableValue! += settlement.availableValue! * fraction;
        row.usefulValue! += settlement.usefulValue! * fraction;
        const topUp =
          boundary ===
          Math.min((month + 1) * MINUTES_PER_MONTH, source.endMinute)
            ? agreementMonthTopUp(row)
            : 0;
        row.payment = row.usefulValue! + topUp;
        settlement.payment += topUp;
        topUps += topUp;
        if (closingExpenses && topUp > 0)
          closingExpenses[month] = (closingExpenses[month] ?? 0) + topUp;
      } else row.payment += settlement.payment * fraction;
      cursor = boundary;
    }
    account.accountedThroughMinute = through;
  }
  return topUps;
}

function validAgreementAccounts(game: GameType): boolean {
  const accounts = game.transmission?.agreementAccounts;
  if (accounts === undefined) return true;
  if (
    !game.utilityExpansion ||
    !Array.isArray(accounts) ||
    accounts.length > MAX_ACCOUNTS
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
      end !== Math.min(game.date.minute, source.endMinute)
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
        Object.keys(row).length !== (source.termsVersion === 3 ? 6 : 4) ||
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
      if (source.termsVersion === 3) {
        const values = [row.availableValue, row.usefulValue];
        if (
          !values.every(
            (value) =>
              typeof value === "number" && Number.isFinite(value) && value >= 0,
          ) ||
          row.usefulValue! > row.availableValue! + 1e-5
        )
          return false;
        const closed =
          end >= Math.min(minute + MINUTES_PER_MONTH, source.endMinute);
        const payment =
          row.usefulValue! + (closed ? agreementMonthTopUp(row) : 0);
        const tolerance = Math.max(1e-5, payment * 1e-10);
        if (
          row.availableMWh > maximumMWh + 1e-6 ||
          Math.abs(row.payment - payment) > tolerance
        )
          return false;
        if (hasEconomy()) {
          // The bounded aggregate is not an invented replay of unrecorded hourly spot prices.
          const ceiling =
            Math.max(
              agreementPrice(game, monthlySource.pricePerMWh, minute),
              agreementPrice(
                game,
                monthlySource.pricePerMWh,
                minute + MINUTES_PER_MONTH,
              ),
            ) *
            (1 - monthlySource.durationDiscount);
          const floor =
            Math.min(
              5,
              agreementPrice(game, monthlySource.pricePerMWh, minute),
            ) *
            (1 - monthlySource.durationDiscount);
          for (const [energy, value] of [
            [row.availableMWh, row.availableValue!],
            [row.usefulMWh, row.usefulValue!],
            [
              row.availableMWh - row.usefulMWh,
              row.availableValue! - row.usefulValue!,
            ],
          ]) {
            if (
              value > energy * ceiling + tolerance ||
              value < energy * floor - tolerance
            )
              return false;
          }
        }
        continue;
      }
      const purchasedMWh =
        source.termsVersion === 2 ? row.availableMWh : row.usefulMWh;
      const payment = purchasedMWh * monthlySource.priceToday;
      if (
        row.availableMWh > maximumMWh + 1e-6 ||
        (purchasedMWh === 0 ? row.payment !== 0 : row.payment <= 0) ||
        // Import runs before economic data loads. Keep structural/energy checks then;
        // the exact inflation-adjusted price requires the same CSV as live settlement.
        (hasEconomy() &&
          Math.abs(row.payment - payment) > Math.max(1e-5, payment * 1e-10))
      )
        return false;
    }
  }
  return true;
}
