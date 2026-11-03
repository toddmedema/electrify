import {
  isStorage,
  type GameType,
  type UtilityNetworkAsset,
  type UtilityTargetId,
} from "../Types";
import { TICK_MINUTES, LOAN_MONTHS } from "../Constants";
import { getInflationIndex, hasEconomy } from "../data/Economy";
import {
  UTILITY_AREAS,
  UTILITY_TARGETS,
  INHERITED_COLD_PACKAGE_COST_2005,
} from "../data/UtilityExpansion";
import {
  acquisitionAssets,
  sellerCustomers,
  entitlementSources,
  expansionRetentionBaseline,
} from "./Expansion";
import {
  facilityCashBack,
  getMonthlyPayment,
  loanBalanceAfterTicks,
} from "./Financials";
import { getDateFromMinute, getTimeFromTimeline } from "./DateTime";
import { customerMarketSizeAt } from "./Customers";
import {
  isUtilityExpansionGame,
  validUtilityExpansionSetup,
  validUtilityExpansionHeader,
  ownedUtilityConnection,
} from "./ExpansionContext";

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
const obsoleteAreaState = (game: GameType) =>
  Object.prototype.hasOwnProperty.call(game, "operatingAreaId") ||
  game.facilities.some((f) =>
    Object.prototype.hasOwnProperty.call(f, "operatingAreaId"),
  ) ||
  game.timeline.some((t) =>
    Object.prototype.hasOwnProperty.call(t, "areaTicks"),
  );

/** Current saves contain one company and one bounded, receipt-owned acquisition ledger. */
export function validUtilityExpansion(game: GameType): boolean {
  if (obsoleteAreaState(game)) return false;
  const state = game.utilityExpansion;
  if (!isUtilityExpansionGame(game)) return state === undefined;
  if (
    !state ||
    !record(state) ||
    Object.keys(state).some(
      (key) => !["networkAssets", "loans", "acquisitions"].includes(key),
    ) ||
    !Array.isArray(state.networkAssets) ||
    !Array.isArray(state.acquisitions) ||
    !Array.isArray(state.loans) ||
    state.acquisitions.length > 2 ||
    state.networkAssets.length !== state.acquisitions.length ||
    state.loans.length > 4 ||
    !validUtilityExpansionHeader(game) ||
    (game.customScenario && !validUtilityExpansionSetup(game.customScenario))
  )
    return false;
  const targets = new Set<UtilityTargetId>();
  for (const receipt of state.acquisitions) {
    if (
      !record(receipt) ||
      !UTILITY_TARGETS.some((target) => target.id === receipt.targetId) ||
      targets.has(receipt.targetId) ||
      !minute(receipt.minute, game.date.minute) ||
      typeof receipt.financed !== "boolean" ||
      !nonnegative(receipt.transferredCustomers) ||
      !close(
        receipt.transferredCustomers,
        sellerCustomers(receipt.targetId, receipt.minute),
      )
    )
      return false;
    targets.add(receipt.targetId);
  }
  const pool =
    UTILITY_AREAS.champlain.addressablePool +
    state.acquisitions.reduce(
      (sum, receipt) => sum + UTILITY_AREAS[receipt.targetId].addressablePool,
      0,
    );
  const current = getTimeFromTimeline(game.date.minute, game.timeline);
  if (
    !close(game.customerMarketSize, pool) ||
    !current ||
    !nonnegative(current.customers) ||
    current.customers >
      customerMarketSizeAt(pool, game.date.minute) * (1 + 1e-9)
  )
    return false;
  if (
    game.transmission?.lines.some(
      (line) =>
        ownedUtilityConnection(game, line.corridorId) &&
        (line.paused || line.currentFlowW !== 0),
    )
  )
    return false;
  const networks = new Set<UtilityTargetId>();
  const retained = Math.min(
    1,
    current.customers / expansionRetentionBaseline(game),
  );
  for (const network of state.networkAssets) {
    const receipt = state.acquisitions.find(
      (receipt) => receipt.targetId === network?.targetId,
    );
    if (
      !record(network) ||
      !receipt ||
      networks.has(network.targetId) ||
      network.activatedMinute !== receipt.minute ||
      !nonnegative(network.initialValue) ||
      !nonnegative(network.retentionLowWatermark) ||
      network.retentionLowWatermark > retained + 1e-9 ||
      !validNetworkValue(game, network)
    )
      return false;
    networks.add(network.targetId);
  }
  const loanIds = new Set<string>();
  for (const loan of state.loans) {
    const target = UTILITY_TARGETS.find(
      (target) => target.id === loan?.targetId,
    );
    const receipt = state.acquisitions.find(
      (receipt) => receipt.targetId === loan?.targetId,
    );
    if (
      !record(loan) ||
      !target ||
      !receipt ||
      !["assumed", "purchase"].includes(loan.kind) ||
      loan.id !== `scenario-116-${target.id}-${loan.kind}` ||
      loanIds.has(loan.id) ||
      loan.minuteCreated !== receipt.minute ||
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
    if (hasEconomy()) {
      const index = getInflationIndex(
        getDateFromMinute(receipt.minute, 2005),
        2005,
        game.seed,
      );
      const expected =
        loan.kind === "assumed" ? target.assumedDebt : target.equityPrice * 0.8;
      if (!close(loan.principal, expected * index)) return false;
    }
    loanIds.add(loan.id);
  }
  if (
    state.acquisitions.some(
      (receipt) =>
        receipt.financed !==
          loanIds.has(`scenario-116-${receipt.targetId}-purchase`) ||
        !loanIds.has(`scenario-116-${receipt.targetId}-assumed`),
    )
  )
    return false;
  const expectedAssets = new Map<
    string,
    import("../Types").FacilityOperatingType
  >();
  for (const receipt of state.acquisitions) {
    const inherited = acquisitionAssets(
      { ...game, date: getDateFromMinute(receipt.minute, 2005) },
      receipt.targetId,
    );
    if (!inherited) return false;
    inherited.forEach((asset) => {
      if (asset.startingAssetId)
        expectedAssets.set(asset.startingAssetId, asset);
    });
  }
  const assetIds = new Set<string>();
  for (const facility of game.facilities) {
    const id = facility.startingAssetId;
    if (!id) continue;
    const definition = Object.values(UTILITY_AREAS).find((portfolio) =>
      portfolio.facilities.some((asset) => asset.assetId === id),
    );
    if (
      !definition ||
      (definition.id !== "champlain" && !targets.has(definition.id)) ||
      assetIds.has(id)
    )
      return false;
    assetIds.add(id);
    const expected = expectedAssets.get(id);
    const packageCost = INHERITED_COLD_PACKAGE_COST_2005[id];
    if (
      packageCost !== undefined &&
      (isStorage(facility) ||
        facility.resilienceExtraBuildCost !== packageCost ||
        !facility.resilience?.coldWeatherPackage)
    )
      return false;
    if (
      expected &&
      (facility.name !== expected.name ||
        facility.fuel !== expected.fuel ||
        facility.gasCycle !== expected.gasCycle ||
        facility.peakW !== expected.peakW ||
        !close(facility.buildCost, expected.buildCost) ||
        facility.minuteOperational !== expected.minuteOperational ||
        facility.minuteCreated !== expected.minuteCreated ||
        facility.loanAmountLeft !== 0 ||
        facility.loanAmountTotal !== 0 ||
        facility.loanMonthlyPayment !== 0 ||
        facility.interestRate !== 0 ||
        (facility.constructionKgco2eTotal ?? 0) !== 0 ||
        (facility.constructionKgco2eEmitted ?? 0) !== 0)
    )
      return false;
  }
  return game.timeline.every((tick) => {
    if (
      tick.entitlementImportedW === undefined ||
      tick.entitlementImportCapacityW === undefined
    )
      return false;
    const capacity = entitlementSources(game, tick).reduce(
      (sum, source) => sum + source.capacityW,
      0,
    );
    return (
      nonnegative(tick.entitlementImportedW) &&
      nonnegative(tick.entitlementImportCapacityW) &&
      close(tick.entitlementImportCapacityW, capacity) &&
      tick.entitlementImportedW <= capacity + 0.01 &&
      tick.entitlementImportedW <= (tick.importedW ?? 0) + 0.01
    );
  });
}

function validNetworkValue(
  game: GameType,
  network: UtilityNetworkAsset,
): boolean {
  const target = UTILITY_TARGETS.find(
    (target) => target.id === network.targetId,
  );
  if (!target) return false;
  const date = getDateFromMinute(network.activatedMinute, 2005);
  const assets = acquisitionAssets(
    { ...game, date, commissionedHydroSiteIds: [] },
    network.targetId,
  );
  const assumed = game.utilityExpansion?.loans.find(
    (loan) => loan.targetId === network.targetId && loan.kind === "assumed",
  );
  if (
    !assets ||
    !assumed ||
    !nonnegative(assumed.principal) ||
    assumed.principal <= 0
  )
    return false;
  const index = assumed.principal / target.assumedDebt;
  if (hasEconomy() && !close(index, getInflationIndex(date, 2005, game.seed)))
    return false;
  const purchase = game.utilityExpansion?.loans.find(
    (loan) => loan.targetId === network.targetId && loan.kind === "purchase",
  );
  if (purchase && !close(purchase.principal, target.equityPrice * 0.8 * index))
    return false;
  const enterprise = (target.equityPrice + target.assumedDebt) * index;
  const generators = assets.reduce(
    (sum, asset) => sum + facilityCashBack(asset, date.minute),
    0,
  );
  return (
    generators <= enterprise &&
    close(network.initialValue, enterprise - generators)
  );
}
