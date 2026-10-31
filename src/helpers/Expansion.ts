import {
  isStorage,
  type AcquireUtilityAction,
  type AcquisitionLoan,
  type FacilityOperatingType,
  type GameType,
  type UtilityId,
  type UtilityTargetId,
  type UtilityNetworkAsset,
} from "../Types";
import { isUtilityExpansionGame } from "./ExpansionContext";
import {
  intertieContextForGame,
  importAvailabilityFraction,
  adjacentMarketPricePerMWh,
} from "./Transmission";
import { importEmissionsKgco2ePerMWh } from "../data/ImportEmissions";
import { DAYS_PER_YEAR, DIFFICULTIES, LOAN_MONTHS } from "../Constants";
import { getInflationIndex, hasEconomy } from "../data/Economy";
import {
  EXPANSION_SCENARIO_ID,
  INHERITED_COLD_PACKAGE_COST_2005,
  UTILITY_AREAS,
  UTILITY_TARGETS,
  utilityEntitlementsAt,
  utilityNetworkAnnualOM,
} from "../data/UtilityExpansion";
import {
  facilityCashBack,
  getMonthlyPayment,
  purchaseTerms,
} from "./Financials";
import {
  getDateFromMinute,
  getTimeFromTimeline,
  MINUTES_PER_MONTH,
} from "./DateTime";
import { customerMarketSizeAt } from "./Customers";
import { startingFacilityQuote } from "./StartingFacilities";
import { startingFacilityStarts } from "./StartingFacilityStarts";
import { windAnnualOutputDegradation } from "../data/Facilities";
import {
  buildoutComplete,
  isOperatingPolicy,
  programCustomers,
} from "./Policies";

export function acquisitionTargetForCorridor(corridorId: string) {
  return UTILITY_TARGETS.find((target) => target.corridorId === corridorId);
}
export function ownedUtility(
  game: Pick<GameType, "utilityExpansion">,
  targetId: string,
): boolean {
  return (
    !!game.utilityExpansion &&
    (targetId === "champlain" ||
      game.utilityExpansion.acquisitions.some(
        (receipt) => receipt.targetId === targetId,
      ))
  );
}
/** Immutable transfer receipts extend the one company's retention benchmark. */
export function expansionRetentionBaseline(
  game: Pick<GameType, "utilityExpansion">,
  beforeMinute = Infinity,
): number {
  return (
    UTILITY_AREAS.champlain.customers +
    (game.utilityExpansion?.acquisitions.reduce(
      (sum, receipt) =>
        sum +
        (receipt.minute < beforeMinute ? receipt.transferredCustomers : 0),
      0,
    ) ?? 0)
  );
}
/** Sellers grow neutrally until the dated transfer; they are never separately simulated. */
export function sellerCustomers(targetId: UtilityId, minute: number) {
  return customerMarketSizeAt(UTILITY_AREAS[targetId].customers, minute);
}
export function networkCarryingValue(
  asset: UtilityNetworkAsset,
  minute: number,
): number {
  if (minute < asset.activatedMinute) return 0;
  const months = (minute - asset.activatedMinute) / MINUTES_PER_MONTH;
  return (
    asset.initialValue *
    Math.max(0, 1 - months / 480) *
    asset.retentionLowWatermark
  );
}
export function expansionNetWorth(
  game: Pick<GameType, "utilityExpansion">,
  minute: number,
): number {
  return (
    (game.utilityExpansion?.networkAssets.reduce(
      (sum, asset) => sum + networkCarryingValue(asset, minute),
      0,
    ) ?? 0) -
    (game.utilityExpansion?.loans.reduce(
      (sum, loan) => sum + loan.loanAmountLeft,
      0,
    ) ?? 0)
  );
}
/** Inherited assets use their opening technology and age, not a newly built 2017 plant. */
export function acquisitionAssets(
  game: GameType,
  targetId: UtilityTargetId,
): FacilityOperatingType[] | undefined {
  const definition = UTILITY_AREAS[targetId];
  const opening = {
    ...game,
    scenarioId: EXPANSION_SCENARIO_ID,
    customScenario: undefined,
    // Existing seller equipment keeps its authored protection even in an unscored sandbox.
    storyEffectsDisabled: false,
    weatherHazardsDisabled: false,
    utilityExpansion: undefined,
    location: definition.location,
    commissionedHydroSiteIds: [],
    date: getDateFromMinute(0, 2005),
    facilities: [],
    timeline: [],
  };
  let nextId = game.facilities.reduce((max, f) => Math.max(max, f.id), 0) + 1;
  const result: FacilityOperatingType[] = [];
  for (const search of definition.facilities) {
    if (game.date.monthsElapsed > 227 && search.fuel === "Oil") continue;
    const quote = startingFacilityQuote(opening, search);
    if (!quote) return undefined;
    const { viableLocationsRemaining: _remaining, ...technology } = quote;
    const packageCost = INHERITED_COLD_PACKAGE_COST_2005[search.assetId ?? ""];
    if (packageCost !== undefined && !isStorage(technology)) {
      technology.buildCost +=
        packageCost - (technology.resilienceExtraBuildCost ?? 0);
      technology.resilienceExtraBuildCost = packageCost;
    }

    const age = search.initialAgeYears ?? 0;
    result.push({
      ...technology,
      startingAssetId: search.assetId,
      hydroSiteId: search.hydroSiteId ?? quote.hydroSiteId,
      ...(quote.fuel === "Wind"
        ? { annualOutputDegradation: windAnnualOutputDegradation(2005 - age) }
        : {}),
      id: nextId++,
      currentW: 0,
      currentWh: quote.peakWh === undefined ? undefined : 0,
      yearsToBuildLeft: 0,
      minuteCreated: game.date.minute,
      minuteOperational: -age * DAYS_PER_YEAR * 24 * 60,
      loanAmountTotal: 0,
      loanAmountLeft: 0,
      loanMonthlyPayment: 0,
      interestRate: 0,
      lifetimeWh: 0,
      lifetimePotentialWh: 0,
      lifetimeRevenue: 0,
      lifetimeExpenses: 0,
      lifetimeStarts: startingFacilityStarts(
        quote,
        age + game.date.monthsElapsed / 12,
      ),
      constructionKgco2eTotal: 0,
      ...(quote.reservoirCapacityWh
        ? { reservoirWh: quote.reservoirCapacityWh * 0.5 }
        : {}),
    } as FacilityOperatingType);
  }
  return result;
}
export interface AcquisitionQuote {
  targetId: UtilityTargetId;
  name: string;
  quoteKey: string;
  customers: number;
  addressablePool: number;
  equityPrice: number;
  fee: number;
  assumedDebt: number;
  cashDue: number;
  financedCashDue: number;
  newLoan: number;
  monthlyDebtService: number;
  cashMonthlyDebtService: number;
  networkOMPerMonth: number;
  networkInitialValue: number;
  facilities: {
    name: FacilityOperatingType["name"];
    startingAssetId?: string;
    peakW: number;
    ageYears: number;
  }[];
  contracts: {
    balancing?: boolean;
    name: string;
    nominalW: number;
    deliverableW: number;
    pricePerMWh: number;
  }[];
}
/** Read-only dated terms are visible before the player commits to a connection. */
export function utilityOffer(
  game: GameType,
  targetId: string,
): Omit<AcquisitionQuote, "quoteKey"> | undefined {
  const target = UTILITY_TARGETS.find((entry) => entry.id === targetId);
  const expansion = game.utilityExpansion;
  if (
    !isUtilityExpansionGame(game) ||
    !target ||
    !expansion ||
    ownedUtility(game, targetId)
  )
    return undefined;
  const assets = acquisitionAssets(game, target.id);
  if (!assets) return undefined;
  const index = hasEconomy()
    ? getInflationIndex(game.date, 2005, game.seed)
    : 1;
  const equityPrice = target.equityPrice * index;
  const fee = target.fee * index;
  const assumedDebt = target.assumedDebt * index;
  const generatorValue = assets.reduce(
    (sum, asset) => sum + facilityCashBack(asset, game.date.minute),
    0,
  );
  if (generatorValue > equityPrice + assumedDebt) return undefined;
  const financed = purchaseTerms(
    equityPrice,
    true,
    game.interestRate,
    0,
    LOAN_MONTHS,
  );
  const assumedPayment = getMonthlyPayment(assumedDebt, 0.05, 240);
  const definition = UTILITY_AREAS[target.id];
  const currentCustomers = getTimeFromTimeline(
    game.date.minute,
    game.timeline,
  )?.customers;
  if (currentCustomers === undefined) return undefined;
  const acquiredCustomers = sellerCustomers(target.id, game.date.minute);
  const owned: UtilityId[] = [
    "champlain",
    ...expansion.acquisitions
      .filter((receipt) => receipt.minute <= game.date.minute)
      .map((receipt) => receipt.targetId),
  ];
  const addedNetworkOM =
    utilityNetworkAnnualOM(
      [...owned, target.id],
      currentCustomers + acquiredCustomers,
      game.date.year,
    ) - utilityNetworkAnnualOM(owned, currentCustomers, game.date.year);
  return {
    targetId: target.id,
    name: target.name,
    customers: acquiredCustomers,
    addressablePool: customerMarketSizeAt(
      definition.addressablePool,
      game.date.minute,
    ),
    equityPrice,
    fee,
    assumedDebt,
    cashDue: equityPrice + fee,
    financedCashDue: financed.amountDue + fee,
    newLoan: financed.loanAmount,
    monthlyDebtService: financed.monthlyPayment + assumedPayment,
    cashMonthlyDebtService: assumedPayment,
    networkOMPerMonth:
      (addedNetworkOM * index * DIFFICULTIES[game.difficulty].expensesOM) / 12,
    networkInitialValue: equityPrice + assumedDebt - generatorValue,
    facilities: assets.map((asset) => ({
      name: asset.name,
      startingAssetId: asset.startingAssetId,
      peakW: asset.peakW,
      ageYears:
        game.date.monthsElapsed / 12 -
        (asset.minuteOperational ?? 0) / (DAYS_PER_YEAR * 24 * 60),
    })),
    contracts: utilityEntitlementsAt(target.id, game.date.year).map(
      (source) => ({
        name: source.name,
        ...(source.balancing ? { balancing: true } : {}),
        nominalW: source.nominalW,
        deliverableW: source.nominalW * source.deliverability,
        pricePerMWh: source.pricePerMWh * index,
      }),
    ),
  };
}
/** Only a completed connection can turn public terms into an executable quote. */
export function acquisitionQuote(
  game: GameType,
  targetId: string,
): AcquisitionQuote | undefined {
  const target = UTILITY_TARGETS.find((entry) => entry.id === targetId);
  const line = game.transmission?.lines.find(
    (entry) =>
      entry.corridorId === target?.corridorId && entry.yearsToBuildLeft <= 0,
  );
  if (!line) return undefined;
  const offer = utilityOffer(game, targetId);
  if (!offer) return undefined;
  return {
    ...offer,
    quoteKey: JSON.stringify([
      offer.targetId,
      game.date.minute,
      line.id,
      game.interestRate,
      offer.equityPrice,
      offer.fee,
      offer.assumedDebt,
    ]),
  };
}
export function validAcquisitionAction(
  value: unknown,
): value is AcquireUtilityAction {
  const action = value as Partial<AcquireUtilityAction> | null;
  return (
    !!action &&
    UTILITY_TARGETS.some((target) => target.id === action.targetId) &&
    typeof action.financed === "boolean" &&
    typeof action.quoteKey === "string"
  );
}
/** Every guard passes before ownership, money, equipment or the shared customer pool changes. */
export function transferUtility(game: GameType, value: unknown): boolean {
  if (!validAcquisitionAction(value)) return false;
  const quote = acquisitionQuote(game, value.targetId);
  const now = getTimeFromTimeline(game.date.minute, game.timeline);
  if (
    !quote ||
    quote.quoteKey !== value.quoteKey ||
    !now ||
    !game.utilityExpansion
  )
    return false;
  const due = value.financed ? quote.financedCashDue : quote.cashDue;
  if (now.cash < due) return false;
  const assets = acquisitionAssets(game, value.targetId);
  if (!assets) return false;
  const oldProgramCustomers = programCustomers(game);
  const loan = (
    kind: AcquisitionLoan["kind"],
    principal: number,
    rate: number,
    months: number,
  ): AcquisitionLoan => ({
    id: `scenario-116-${value.targetId}-${kind}`,
    targetId: value.targetId,
    kind,
    principal,
    loanAmountLeft: principal,
    loanMonthlyPayment: getMonthlyPayment(principal, rate, months),
    interestRate: rate,
    months,
    minuteCreated: game.date.minute,
  });
  now.cash -= due;
  now.customers += quote.customers;
  game.utilityExpansion.acquisitions.push({
    targetId: value.targetId,
    minute: game.date.minute,
    financed: value.financed,
    transferredCustomers: quote.customers,
  });
  game.customerMarketSize =
    UTILITY_AREAS.champlain.addressablePool +
    game.utilityExpansion.acquisitions.reduce(
      (sum, receipt) => sum + UTILITY_AREAS[receipt.targetId].addressablePool,
      0,
    );
  const network: UtilityNetworkAsset = {
    targetId: value.targetId,
    activatedMinute: game.date.minute,
    initialValue: quote.networkInitialValue,
    retentionLowWatermark: Math.min(
      1,
      now.customers / expansionRetentionBaseline(game),
    ),
  };
  game.utilityExpansion.networkAssets.push(network);
  game.utilityExpansion.loans.push(
    loan("assumed", quote.assumedDebt, 0.05, 240),
  );
  if (value.financed)
    game.utilityExpansion.loans.push(
      loan("purchase", quote.newLoan, game.interestRate, LOAN_MONTHS),
    );
  game.facilities.push(...assets);
  for (const asset of assets)
    if (
      asset.hydroSiteId &&
      !game.commissionedHydroSiteIds.includes(asset.hydroSiteId)
    )
      game.commissionedHydroSiteIds.push(asset.hydroSiteId);
  const ratio = oldProgramCustomers / programCustomers(game);
  for (const [id, program] of Object.entries(game.policies?.programs ?? {})) {
    if (isOperatingPolicy(id as import("../Types").PolicyId)) continue;
    program.adoption *= ratio;
    if (program.installs)
      program.installs = program.installs.map(([month, share]) => [
        month,
        share * ratio,
      ]);
    if (!buildoutComplete(program.adoption)) delete program.completedMonth;
  }
  const target = UTILITY_TARGETS.find(
    (target) => target.id === value.targetId,
  )!;
  const line = game.transmission?.lines.find(
    (line) => line.corridorId === target.corridorId,
  );
  if (line) {
    line.paused = false;
    line.currentFlowW = 0;
  }
  now.netWorth +=
    networkCarryingValue(network, game.date.minute) -
    network.initialValue -
    quote.fee;
  return true;
}

/** Owned source rights serve one company load, with each package's own finite interface. */
export function entitlementSources(
  game: GameType,
  now: import("../Types").TickPresentFutureType,
): {
  id: string;
  utilityId: UtilityId;
  capacityW: number;
  pricePerMWh: number;
  emissionsKgPerMWh: number;
}[] {
  if (!game.utilityExpansion) return [];
  const date = getDateFromMinute(now.minute, 2005);
  const index = hasEconomy() ? getInflationIndex(date, 2005, game.seed) : 1;
  const active = new Set(
    game.utilityExpansion.acquisitions
      .filter((receipt) => receipt.minute <= now.minute)
      .map((receipt) => receipt.targetId),
  );
  const ids: UtilityId[] = [
    "champlain",
    ...UTILITY_TARGETS.filter((target) => active.has(target.id)).map(
      (target) => target.id,
    ),
  ];
  return ids
    .flatMap((id) => {
      let interfaceLeft = UTILITY_AREAS[id].sourceInterfaceW;
      return utilityEntitlementsAt(id, date.year).map((source) => {
        const context = intertieContextForGame(game);
        const corridor = "vt-champlain-valley";
        const availability = source.balancing
          ? importAvailabilityFraction(corridor, context, now.minute, now)
          : source.deliverability;
        const capacityW = Math.min(
          interfaceLeft,
          source.nominalW * availability,
        );
        interfaceLeft -= capacityW;
        return {
          id: source.id,
          utilityId: id,
          capacityW,
          pricePerMWh: source.balancing
            ? adjacentMarketPricePerMWh(corridor, context, now.minute, now) *
              (source.pricePerMWh / 60)
            : source.pricePerMWh * index,
          emissionsKgPerMWh:
            source.emissionsKgPerMWh ??
            (source.marketId
              ? importEmissionsKgco2ePerMWh(source.marketId, date.year)
              : 0),
        };
      });
    })
    .sort(
      (a, b) =>
        a.pricePerMWh - b.pricePerMWh ||
        (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    );
}
