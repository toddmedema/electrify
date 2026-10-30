import { isStorage } from "../Types";
import { isUtilityExpansionGame } from "./ExpansionContext";
import {
  transmissionRatingW,
  intertieContextForGame,
  importAvailabilityFraction,
  adjacentMarketPricePerMWh,
} from "./Transmission";
import { importEmissionsKgco2ePerMWh } from "../data/ImportEmissions";
import type {
  AcquireUtilityAction,
  AcquisitionLoan,
  FacilityOperatingType,
  GameType,
  OperatingAreaState,
  UtilityAreaId,
  UtilityTargetId,
} from "../Types";
import { DAYS_PER_YEAR, DIFFICULTIES, LOAN_MONTHS } from "../Constants";
import { getInflationIndex, hasEconomy } from "../data/Economy";
import {
  EXPANSION_SCENARIO_ID,
  INHERITED_COLD_PACKAGE_COST_2005,
  UTILITY_AREAS,
  UTILITY_TARGETS,
  utilityEntitlementsAt,
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
import { emptyPolicies } from "./Policies";

export function acquisitionTargetForCorridor(corridorId: string) {
  return UTILITY_TARGETS.find((target) => target.corridorId === corridorId);
}
export function ownedUtility(game: GameType, targetId: string): boolean {
  return !!game.utilityExpansion?.areas.some((area) => area.id === targetId);
}
export function initialOperatingArea(): OperatingAreaState {
  return {
    id: "champlain",
    customers: 90000,
    transferredCustomers: 90000,
    customerMarketSize: 180000,
    activatedMinute: 0,
    networkInitialValue: 0,
    retentionLowWatermark: 1,
  };
}
/** The pre-purchase seller advances from January 2005 exactly once. */
export function sellerCustomers(targetId: UtilityAreaId, minute: number) {
  return customerMarketSizeAt(UTILITY_AREAS[targetId].customers, minute);
}
export function operatingAreaPool(area: OperatingAreaState, minute: number) {
  return customerMarketSizeAt(
    area.customerMarketSize,
    Math.max(0, minute - area.activatedMinute),
  );
}
export function networkCarryingValue(
  area: OperatingAreaState,
  minute: number,
): number {
  const months = Math.max(
    0,
    (minute - area.activatedMinute) / MINUTES_PER_MONTH,
  );
  return (
    area.networkInitialValue *
    Math.max(0, 1 - months / 480) *
    area.retentionLowWatermark
  );
}
export function expansionNetWorth(
  game: Pick<GameType, "utilityExpansion">,
  minute: number,
): number {
  return (
    (game.utilityExpansion?.areas.reduce(
      (sum, area) => sum + networkCarryingValue(area, minute),
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
    operatingAreaId: undefined,
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
      operatingAreaId: targetId,
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
  facilities: { name: string; peakW: number; ageYears: number }[];
  contracts: {
    balancing?: boolean;
    name: string;
    nominalW: number;
    deliverableW: number;
    pricePerMWh: number;
  }[];
}
/** Every transaction boundary and execution path uses this bounded catalog lookup. */
export function acquisitionQuote(
  game: GameType,
  targetId: string,
): AcquisitionQuote | undefined {
  const target = UTILITY_TARGETS.find((entry) => entry.id === targetId);
  const expansion = game.utilityExpansion;
  if (
    !isUtilityExpansionGame(game) ||
    !target ||
    !expansion ||
    ownedUtility(game, targetId)
  )
    return undefined;
  const line = game.transmission?.lines.find(
    (entry) =>
      entry.corridorId === target.corridorId && entry.yearsToBuildLeft <= 0,
  );
  if (!line) return undefined;
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
  return {
    targetId: target.id,
    name: target.name,
    quoteKey: JSON.stringify([
      target.id,
      game.date.minute,
      line.id,
      game.interestRate,
      equityPrice,
      fee,
      assumedDebt,
    ]),
    customers: sellerCustomers(target.id, game.date.minute),
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
      (definition.annualNetworkOM *
        index *
        DIFFICULTIES[game.difficulty].expensesOM) /
      12,
    networkInitialValue: equityPrice + assumedDebt - generatorValue,
    facilities: assets.map((asset) => ({
      name: asset.name,
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
/** Mutates only after every eligibility, quote, asset and cash guard has passed. */
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
  const area: OperatingAreaState = {
    id: value.targetId,
    customers: quote.customers,
    transferredCustomers: quote.customers,
    customerMarketSize: quote.addressablePool,
    activatedMinute: game.date.minute,
    networkInitialValue: quote.networkInitialValue,
    retentionLowWatermark: 1,
    policies: emptyPolicies(game.date.monthsElapsed),
  };
  // Choices carry forward; installed hardware and historical incentives do not.
  if (game.policies && area.policies)
    for (const id of Object.keys(
      area.policies.programs,
    ) as (keyof typeof area.policies.programs)[]) {
      area.policies.programs[id].tier = game.policies.programs[id].tier;
      area.policies.programs[id].startHour =
        game.policies.programs[id].startHour;
      area.policies.programs[id].pending = game.policies.programs[id]
        .pending && { ...game.policies.programs[id].pending };
    }
  now.cash -= due;
  now.customers += quote.customers;
  game.utilityExpansion.areas.push(area);
  game.customerMarketSize = game.utilityExpansion.areas.reduce(
    (sum, entry) =>
      sum +
      entry.customerMarketSize / customerMarketSizeAt(1, entry.activatedMinute),
    0,
  );
  game.utilityExpansion.acquisitions.push({
    targetId: value.targetId,
    minute: game.date.minute,
    financed: value.financed,
  });
  game.utilityExpansion.loans.push(
    loan("assumed", quote.assumedDebt, 0.05, 240),
  );
  if (value.financed)
    game.utilityExpansion.loans.push(
      loan("purchase", quote.newLoan, game.interestRate, LOAN_MONTHS),
    );
  game.facilities.push(...assets);
  assets.forEach((asset) => {
    if (
      asset.hydroSiteId &&
      !game.commissionedHydroSiteIds.includes(asset.hydroSiteId)
    )
      game.commissionedHydroSiteIds.push(asset.hydroSiteId);
  });
  now.netWorth -= quote.fee;
  return true;
}

/** Finite source rights are separate from sellable generators and acquisition corridors. */
export function entitlementSources(
  game: GameType,
  now: import("../Types").TickPresentFutureType,
): { capacityW: number; pricePerMWh: number; emissionsKgPerMWh: number }[] {
  if (!game.operatingAreaId) return [];
  const definition = UTILITY_AREAS[game.operatingAreaId];
  const date = getDateFromMinute(now.minute, 2005);
  const index = hasEconomy() ? getInflationIndex(date, 2005, game.seed) : 1;
  let interfaceLeft = definition.sourceInterfaceW;
  return utilityEntitlementsAt(game.operatingAreaId, date.year).map(
    (source) => {
      const context = intertieContextForGame(game);
      const balancingCorridor = "vt-champlain-valley";
      const availability = source.balancing
        ? importAvailabilityFraction(
            balancingCorridor,
            context,
            now.minute,
            now,
          )
        : source.deliverability;
      const capacityW = Math.min(interfaceLeft, source.nominalW * availability);
      interfaceLeft -= capacityW;
      return {
        capacityW,
        pricePerMWh: source.balancing
          ? adjacentMarketPricePerMWh(
              balancingCorridor,
              context,
              now.minute,
              now,
            ) *
            (source.pricePerMWh / 60)
          : source.pricePerMWh * index,
        emissionsKgPerMWh:
          source.emissionsKgPerMWh ??
          (source.marketId
            ? importEmissionsKgco2ePerMWh(source.marketId, date.year)
            : 0),
      };
    },
  );
}

const operatingAreaTimelines = new WeakMap<
  GameType["timeline"],
  Map<UtilityAreaId, GameType["timeline"]>
>();
function operatingAreaTimeline(
  state: GameType,
  area: OperatingAreaState,
): GameType["timeline"] {
  let cached = operatingAreaTimelines.get(state.timeline);
  if (!cached) {
    cached = new Map();
    operatingAreaTimelines.set(state.timeline, cached);
  }
  let timeline = cached.get(area.id);
  if (!timeline) {
    timeline = state.timeline.map(
      (tick) =>
        tick.areaTicks?.[area.id] ?? {
          ...tick,
          areaTicks: undefined,
          customers: area.customers,
        },
    );
    cached.set(area.id, timeline);
  }
  return timeline;
}

/** Scope the existing engine to one owned area instead of inventing a second model. */
export function operatingAreaView(
  state: GameType,
  area: OperatingAreaState,
): GameType {
  const definition = UTILITY_AREAS[area.id];
  return {
    ...state,
    operatingAreaId: area.id,
    location: definition.location,
    startingDemandScale: definition.demandScale,
    demandShapeExponent: definition.demandShapeExponent,
    customerMarketSize:
      area.customerMarketSize / customerMarketSizeAt(1, area.activatedMinute),
    policies: area.id === "champlain" ? state.policies : area.policies,
    facilities: state.facilities.filter(
      (f) => (f.operatingAreaId ?? "champlain") === area.id,
    ),
    transmission: area.id === "champlain" ? state.transmission : undefined,
    timeline: operatingAreaTimeline(state, area),
  };
}
export function gameForOperatingArea(
  state: GameType,
  id: UtilityAreaId,
): GameType | undefined {
  const area = state.utilityExpansion?.areas.find((entry) => entry.id === id);
  return area ? operatingAreaView(state, area) : undefined;
}

/** Owned endpoints use the physical wire, replacing external market-access entitlements. */
export function ownedIntertieCapacityW(
  game: GameType,
  line: import("../Types").TransmissionLineOperatingType,
  tick: import("../Types").TickPresentFutureType,
): number {
  const target = acquisitionTargetForCorridor(line.corridorId);
  if (
    !target ||
    !ownedUtility(game, target.id) ||
    line.paused ||
    line.yearsToBuildLeft > 0
  )
    return 0;
  return Math.min(
    transmissionRatingW(line, tick.areaTicks?.champlain ?? tick),
    transmissionRatingW(line, tick.areaTicks?.[target.id] ?? tick),
  );
}
