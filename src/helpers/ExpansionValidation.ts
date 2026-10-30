import type {
  GameType,
  OperatingAreaState,
  TickPresentFutureType,
  UtilityAreaId,
} from "../Types";
import { TICK_MINUTES, LOAN_MONTHS } from "../Constants";
import { getInflationIndex, hasEconomy } from "../data/Economy";
import { UTILITY_AREAS, UTILITY_TARGETS } from "../data/UtilityExpansion";
import {
  acquisitionAssets,
  operatingAreaPool,
  sellerCustomers,
  entitlementSources,
  operatingAreaView,
} from "./Expansion";
import {
  facilityCashBack,
  getMonthlyPayment,
  loanBalanceAfterTicks,
} from "./Financials";
import { getDateFromMinute, getTimeFromTimeline } from "./DateTime";
import { validPolicies } from "./Policies";
import { customerMarketSizeAt } from "./Customers";

const nonnegative = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0;
const close = (a: number, b: number) =>
  Math.abs(a - b) <= Math.max(1, Math.abs(b)) * 1e-8;
const minute = (value: unknown, current: number): value is number =>
  nonnegative(value) &&
  Number.isSafeInteger(value) &&
  value <= current &&
  value % TICK_MINUTES === 0;
const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);

/** Current-format ownership is one consistent ledger, never inferred from company totals. */
export function validUtilityExpansion(game: GameType): boolean {
  if (game.operatingAreaId !== undefined) return false;
  const state = game.utilityExpansion;
  if (game.scenarioId !== 116 || game.customScenario) {
    return (
      state === undefined &&
      game.facilities.every((f) => f.operatingAreaId === undefined) &&
      game.timeline.every((t) => t.areaTicks === undefined)
    );
  }
  if (
    !state ||
    !record(state) ||
    !Array.isArray(state.areas) ||
    state.areas.length < 1 ||
    state.areas.length > 3 ||
    !Array.isArray(state.acquisitions) ||
    state.acquisitions.length !== state.areas.length - 1 ||
    !Array.isArray(state.loans) ||
    state.loans.length > 4 ||
    state.areas[0]?.id !== "champlain"
  )
    return false;
  const ids = new Set<UtilityAreaId>();
  for (const area of state.areas) {
    if (
      !record(area) ||
      !Object.prototype.hasOwnProperty.call(UTILITY_AREAS, area.id) ||
      ids.has(area.id) ||
      !minute(area.activatedMinute, game.date.minute) ||
      !nonnegative(area.customers) ||
      !nonnegative(area.transferredCustomers) ||
      area.transferredCustomers === 0 ||
      !nonnegative(area.customerMarketSize) ||
      area.customerMarketSize <= 0 ||
      !nonnegative(area.networkInitialValue) ||
      !nonnegative(area.retentionLowWatermark) ||
      area.retentionLowWatermark >
        Math.min(1, area.customers / area.transferredCustomers) + 1e-9 ||
      area.customers > operatingAreaPool(area, game.date.minute) * (1 + 1e-9) ||
      (area.policies !== undefined &&
        !validPolicies(area.policies, game.date.monthsElapsed, true))
    )
      return false;
    ids.add(area.id);
    if (area.id === "champlain") {
      if (
        area.activatedMinute !== 0 ||
        area.transferredCustomers !== 90000 ||
        area.customerMarketSize !== 180000 ||
        area.networkInitialValue !== 0
      )
        return false;
    } else {
      const acquisitions = state.acquisitions.filter(
        (a) => a?.targetId === area.id,
      );
      if (
        acquisitions.length !== 1 ||
        acquisitions[0].minute !== area.activatedMinute ||
        typeof acquisitions[0].financed !== "boolean" ||
        !close(
          area.transferredCustomers,
          sellerCustomers(area.id, area.activatedMinute),
        ) ||
        !close(
          area.customerMarketSize,
          customerMarketSizeAt(
            UTILITY_AREAS[area.id].addressablePool,
            area.activatedMinute,
          ),
        )
      )
        return false;
      if (!validNetworkValue(game, area)) return false;
    }
  }
  for (const id of ["efficiency", "solar"] as const) {
    const programs = state.areas.map(
      (area) =>
        (area.id === "champlain" ? game.policies : area.policies)?.programs[id],
    );
    if (
      programs.every((program) => (program?.adoption ?? 0) >= 1) &&
      programs.some((program) => !!program?.pending)
    )
      return false;
  }
  if (
    !close(
      game.customerMarketSize,
      state.areas.reduce(
        (sum, area) =>
          sum +
          area.customerMarketSize /
            customerMarketSizeAt(1, area.activatedMinute),
        0,
      ),
    )
  )
    return false;
  if (
    state.acquisitions.some(
      (a) =>
        !record(a) ||
        !ids.has(a.targetId) ||
        !minute(a.minute, game.date.minute),
    )
  )
    return false;
  const loanIds = new Set<string>();
  for (const loan of state.loans) {
    const target = UTILITY_TARGETS.find((t) => t.id === loan?.targetId);
    const area = state.areas.find((a) => a.id === loan?.targetId);
    if (
      !record(loan) ||
      !target ||
      !area ||
      !["assumed", "purchase"].includes(loan.kind) ||
      loan.id !== `scenario-116-${target.id}-${loan.kind}` ||
      loanIds.has(loan.id) ||
      loan.minuteCreated !== area.activatedMinute ||
      ![
        loan.principal,
        loan.loanAmountLeft,
        loan.loanMonthlyPayment,
        loan.interestRate,
      ].every(nonnegative) ||
      loan.principal <= 0 ||
      loan.loanAmountLeft > loan.principal ||
      loan.interestRate > 1 ||
      loan.months !== (loan.kind === "assumed" ? 240 : LOAN_MONTHS) ||
      (loan.kind === "assumed" && loan.interestRate !== 0.05) ||
      !close(
        loan.loanMonthlyPayment,
        getMonthlyPayment(loan.principal, loan.interestRate, loan.months),
      )
    )
      return false;
    const reachable = loanBalanceAfterTicks(
      loan.principal,
      loan.loanMonthlyPayment,
      loan.interestRate,
      (game.date.minute - loan.minuteCreated) / TICK_MINUTES,
    );
    if (
      Math.abs(loan.loanAmountLeft - reachable) >
      Math.max(1, loan.principal) * 1e-7
    )
      return false;
    const index = hasEconomy()
      ? getInflationIndex(
          getDateFromMinute(area.activatedMinute, 2005),
          2005,
          game.seed,
        )
      : undefined;
    const expected =
      loan.kind === "assumed" ? target.assumedDebt : target.equityPrice * 0.8;
    if (index !== undefined && !close(loan.principal, expected * index))
      return false;
    loanIds.add(loan.id);
  }
  if (
    state.acquisitions.some(
      (a) => a.financed !== loanIds.has(`scenario-116-${a.targetId}-purchase`),
    )
  )
    return false;
  if (
    state.areas.some(
      (a) =>
        a.id !== "champlain" && !loanIds.has(`scenario-116-${a.id}-assumed`),
    )
  )
    return false;
  const expectedAssets = new Map<
    string,
    import("../Types").FacilityOperatingType
  >();
  for (const area of state.areas) {
    if (area.id === "champlain") continue;
    const inherited = acquisitionAssets(
      { ...game, date: getDateFromMinute(area.activatedMinute, 2005) },
      area.id,
    );
    if (!inherited) return false;
    inherited.forEach((asset) => {
      if (asset.startingAssetId)
        expectedAssets.set(asset.startingAssetId, asset);
    });
  }
  const assetIds = new Set<string>();
  if (
    game.facilities.some((f) => {
      if (!f.operatingAreaId || !ids.has(f.operatingAreaId)) return true;
      if (!f.startingAssetId) return false;
      const definition = Object.values(UTILITY_AREAS).find((a) =>
        a.facilities.some((original) => original.assetId === f.startingAssetId),
      );
      if (
        !definition ||
        definition.id !== f.operatingAreaId ||
        assetIds.has(f.startingAssetId)
      )
        return true;
      const expected = expectedAssets.get(f.startingAssetId);
      if (
        expected &&
        (f.name !== expected.name ||
          f.fuel !== expected.fuel ||
          f.gasCycle !== expected.gasCycle ||
          f.peakW !== expected.peakW ||
          !close(f.buildCost, expected.buildCost) ||
          f.minuteOperational !== expected.minuteOperational ||
          f.minuteCreated !== expected.minuteCreated ||
          f.loanAmountLeft !== 0 ||
          f.loanAmountTotal !== 0 ||
          f.loanMonthlyPayment !== 0 ||
          f.interestRate !== 0 ||
          (f.constructionKgco2eTotal ?? 0) !== 0 ||
          (f.constructionKgco2eEmitted ?? 0) !== 0)
      )
        return true;
      assetIds.add(f.startingAssetId);
      return false;
    })
  )
    return false;
  const current = getTimeFromTimeline(game.date.minute, game.timeline);
  if (
    !current ||
    !close(
      current.customers,
      state.areas.reduce((sum, area) => sum + area.customers, 0),
    ) ||
    state.areas.some(
      (area) =>
        !close(current.areaTicks?.[area.id]?.customers ?? NaN, area.customers),
    )
  )
    return false;
  return game.timeline.every((tick) => validAreaTicks(tick, state.areas, game));
}

function validNetworkValue(game: GameType, area: OperatingAreaState): boolean {
  if (area.id === "champlain") return true;
  const target = UTILITY_TARGETS.find((t) => t.id === area.id)!;
  const date = getDateFromMinute(area.activatedMinute, 2005);
  const assets = acquisitionAssets(
    { ...game, date, commissionedHydroSiteIds: [] },
    area.id,
  );
  if (!assets) return false;
  const assumed = game.utilityExpansion?.loans.find(
    (loan) => loan.targetId === area.id && loan.kind === "assumed",
  );
  if (!assumed || !nonnegative(assumed.principal) || assumed.principal <= 0)
    return false;
  const transactionIndex = assumed.principal / target.assumedDebt;
  if (
    hasEconomy() &&
    !close(transactionIndex, getInflationIndex(date, 2005, game.seed))
  )
    return false;
  const purchase = game.utilityExpansion?.loans.find(
    (loan) => loan.targetId === area.id && loan.kind === "purchase",
  );
  if (
    purchase &&
    !close(purchase.principal, target.equityPrice * 0.8 * transactionIndex)
  )
    return false;
  const enterprise =
    (target.equityPrice + target.assumedDebt) * transactionIndex;
  const generators = assets.reduce(
    (sum, asset) => sum + facilityCashBack(asset, date.minute),
    0,
  );
  return (
    generators <= enterprise &&
    close(area.networkInitialValue, enterprise - generators)
  );
}

function validAreaTicks(
  tick: TickPresentFutureType,
  areas: OperatingAreaState[],
  game: GameType,
): boolean {
  if (!record(tick.areaTicks)) return false;
  for (const [id, local] of Object.entries(tick.areaTicks)) {
    const area = areas.find((a) => a.id === id);
    if (
      !area ||
      !record(local) ||
      local.areaTicks !== undefined ||
      local.minute !== tick.minute
    )
      return false;
    const sourceCapacity = entitlementSources(
      operatingAreaView(game, area),
      local,
    ).reduce((sum, source) => sum + source.capacityW, 0);
    if (
      !nonnegative(local.entitlementImportedW) ||
      !nonnegative(local.entitlementImportCapacityW) ||
      !close(local.entitlementImportCapacityW, sourceCapacity) ||
      local.entitlementImportedW > sourceCapacity + 0.01 ||
      local.entitlementImportedW > (local.importedW ?? 0) + 0.01 ||
      sourceCapacity > UTILITY_AREAS[area.id].sourceInterfaceW + 0.01
    )
      return false;
    if (
      ![
        local.customers,
        local.demandW,
        local.supplyW,
        local.storedWh,
        local.kgco2e,
        local.importedW,
        local.exportedW,
      ].every(nonnegative) ||
      !record(local.demandByType) ||
      !Object.values(local.demandByType).every(nonnegative)
    )
      return false;
  }
  return areas.every(
    (area) => tick.minute < area.activatedMinute || !!tick.areaTicks?.[area.id],
  );
}
