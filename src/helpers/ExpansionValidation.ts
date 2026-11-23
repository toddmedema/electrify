import { landCustomerMarket } from "./TerritoryCustomers";
import {
  MAX_FACILITY_EXPANSION_COST,
  validExpandedFacilityCapacity,
} from "./FacilityExpansion";
import {
  isStorage,
  type FacilityOperatingType,
  type GameType,
  type UtilityNetworkAsset,
  type UtilityTargetId,
} from "../Types";
import { TICK_MINUTES, LOAN_MONTHS } from "../Constants";
import { getInflationIndex, hasEconomy } from "../data/Economy";
import {
  MUNICIPAL_UTILITIES,
  municipalUtility,
} from "../data/MunicipalUtilities";
import {
  UTILITY_AREAS,
  UTILITY_TARGETS,
  INHERITED_COLD_PACKAGE_COST_2005,
} from "../data/UtilityExpansion";
import {
  acquisitionAssets,
  municipalPlantAsset,
  regionalAcquisitionValuation,
  sellerCustomers,
  expansionRetentionBaseline,
} from "./Expansion";
import {
  facilityCashBack,
  getMonthlyPayment,
  loanBalanceAfterTicks,
  maxLoanAmount,
} from "./Financials";
import { getDateFromMinute, getTimeFromTimeline } from "./DateTime";
import { customerMarketSizeAt } from "./Customers";
import {
  isUtilityExpansionGame,
  validUtilityExpansionSetup,
  validUtilityExpansionHeader,
} from "./ExpansionContext";
import {
  validTerritoryNetwork,
  type TerritoryPurchaseContext,
} from "./TerritoryValidation";

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

function validAcquiredFacilityExpansion(
  game: GameType,
  facility: FacilityOperatingType,
  inherited: FacilityOperatingType,
): boolean {
  const expansion = facility.acquiredExpansion;
  if (expansion === undefined)
    return (
      facility.peakW === inherited.peakW &&
      close(facility.buildCost, inherited.buildCost) &&
      (facility.constructionKgco2eTotal ?? 0) === 0 &&
      (facility.constructionKgco2eEmitted ?? 0) === 0
    );
  if (!record(expansion) || Object.keys(expansion).length !== 4) return false;
  const {
    addedCapacityW,
    investedCapital,
    constructionKgco2eTotal,
    constructionKgco2eEmitted,
  } = expansion;
  const sequence = facility.expansionSequence;
  if (!sequence || !Number.isSafeInteger(sequence)) return false;
  const settledProjects = sequence - (facility.expansionInProgress ? 1 : 0);
  const hasAddedCapacity = addedCapacityW > 0;
  const hasInvestedCapital = investedCapital > 0;
  return (
    settledProjects > 0 &&
    [
      addedCapacityW,
      investedCapital,
      constructionKgco2eTotal,
      constructionKgco2eEmitted,
    ].every(nonnegative) &&
    hasAddedCapacity === hasInvestedCapital &&
    (!hasAddedCapacity ||
      validExpandedFacilityCapacity(
        game,
        facility,
        facility.peakW,
        facility.peakWh,
      )) &&
    investedCapital / settledProjects <= MAX_FACILITY_EXPANSION_COST &&
    (hasAddedCapacity || constructionKgco2eTotal > 0) &&
    close(constructionKgco2eEmitted, constructionKgco2eTotal) &&
    close(facility.peakW, inherited.peakW + addedCapacityW) &&
    close(facility.buildCost, inherited.buildCost + investedCapital) &&
    facility.constructionKgco2eTotal === constructionKgco2eTotal &&
    facility.constructionKgco2eEmitted === constructionKgco2eEmitted
  );
}

/** Current saves contain one company and one bounded, receipt-owned acquisition ledger. */
export function validUtilityExpansion(
  game: GameType,
  peers?: TerritoryPurchaseContext,
): boolean {
  if (obsoleteAreaState(game)) return false;
  const state = game.utilityExpansion;
  if (!isUtilityExpansionGame(game))
    return (
      state === undefined &&
      game.facilities.every(
        (facility) => facility.acquiredExpansion === undefined,
      ) &&
      validTerritoryNetwork(game, peers)
    );
  if (
    !state ||
    !record(state) ||
    Object.keys(state).some(
      (key) =>
        !["sellerFleet", "networkAssets", "loans", "acquisitions"].includes(
          key,
        ),
    ) ||
    (state.sellerFleet !== "authored" && state.sellerFleet !== "seeded") ||
    !Array.isArray(state.networkAssets) ||
    !Array.isArray(state.acquisitions) ||
    !Array.isArray(state.loans) ||
    state.acquisitions.length > 2 ||
    state.networkAssets.length !== state.acquisitions.length ||
    state.loans.length >
      UTILITY_TARGETS.length * 2 + MUNICIPAL_UTILITIES.length ||
    !validUtilityExpansionHeader(game) ||
    (game.customScenario && !validUtilityExpansionSetup(game.customScenario))
  )
    return false;
  if (!validTerritoryNetwork(game, peers)) return false;
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
    landCustomerMarket(game) +
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
    if (
      !record(loan) ||
      typeof loan.targetId !== "string" ||
      !["assumed", "purchase"].includes(loan.kind) ||
      loan.id !== `scenario-116-${loan.targetId}-${loan.kind}` ||
      loanIds.has(loan.id) ||
      !minute(loan.minuteCreated, game.date.minute) ||
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
    const municipal = municipalUtility(loan.targetId);
    if (municipal) {
      const purchases =
        game.territoryNetwork?.tilePurchases?.filter(
          ({ tileId, minute, legacy }) =>
            !legacy &&
            minute === loan.minuteCreated &&
            (tileId === municipal.city.id ||
              tileId === municipal.plant?.tileId),
        ) ?? [];
      const totalPrice = purchases.reduce((sum, site) => sum + site.price, 0);
      // A retained save can already own one of the sites at the same tick.
      const last = purchases.at(-1);
      const prices = [totalPrice, last?.price ?? 0];
      if (
        municipal.plant &&
        purchases.some(({ tileId }) => tileId === municipal.plant?.tileId)
      ) {
        const atPurchase = {
          ...game,
          date: getDateFromMinute(loan.minuteCreated, game.startingYear),
        };
        const asset = municipalPlantAsset(atPurchase, municipal.plant);
        if (asset) {
          const plantPrice = facilityCashBack(asset, loan.minuteCreated);
          prices.push(totalPrice + plantPrice);
          if (last?.tileId === municipal.plant.tileId)
            prices.push(last.price + plantPrice);
        }
      }
      if (
        loan.kind !== "purchase" ||
        !purchases.length ||
        !prices.some((price) => close(loan.principal, maxLoanAmount(price)))
      )
        return false;
    } else {
      const target = UTILITY_TARGETS.find(({ id }) => id === loan.targetId);
      const receipt = state.acquisitions.find(
        ({ targetId }) => targetId === loan.targetId,
      );
      if (!target || receipt?.minute !== loan.minuteCreated) return false;
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
    if (!id) {
      if (facility.acquiredExpansion !== undefined) return false;
      continue;
    }
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
    if (facility.acquiredExpansion !== undefined && !expected) return false;
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
        isStorage(facility) !== isStorage(expected) ||
        !validAcquiredFacilityExpansion(game, facility, expected) ||
        facility.minuteOperational !== expected.minuteOperational ||
        facility.minuteCreated !== expected.minuteCreated ||
        facility.loanAmountLeft !== 0 ||
        facility.loanAmountTotal !== 0 ||
        facility.loanMonthlyPayment !== 0 ||
        facility.interestRate !== 0)
    )
      return false;
  }
  return game.timeline.every((tick) => {
    if (
      tick.entitlementImportedW === undefined ||
      tick.entitlementImportCapacityW === undefined
    )
      return false;
    // Readings before a player decision retain their recorded delivery. Today's pause and
    // signed receipts cannot retroactively change it; canonical owned interfaces bound history.
    const capacity = [
      "champlain",
      ...state.acquisitions
        .filter((receipt) => receipt.minute <= tick.minute)
        .map((receipt) => receipt.targetId),
    ].reduce(
      (sum, id) =>
        sum +
        UTILITY_AREAS[id as import("../Types").UtilityId].sourceInterfaceW,
      0,
    );
    return (
      nonnegative(tick.entitlementImportedW) &&
      nonnegative(tick.entitlementImportCapacityW) &&
      tick.entitlementImportCapacityW <= capacity + 0.01 &&
      tick.entitlementImportedW <= tick.entitlementImportCapacityW + 0.01 &&
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
  const assumed = game.utilityExpansion?.loans.find(
    (loan) => loan.targetId === network.targetId && loan.kind === "assumed",
  );
  if (!assumed || !nonnegative(assumed.principal) || assumed.principal <= 0)
    return false;
  const index = assumed.principal / target.assumedDebt;
  if (hasEconomy() && !close(index, getInflationIndex(date, 2005, game.seed)))
    return false;
  const purchase = game.utilityExpansion?.loans.find(
    (loan) => loan.targetId === network.targetId && loan.kind === "purchase",
  );
  const valuation = regionalAcquisitionValuation(
    { ...game, date },
    target,
    index,
  );
  return (
    !!valuation &&
    close(network.initialValue, valuation.networkInitialValue) &&
    (!purchase ||
      close(purchase.principal, maxLoanAmount(valuation.equityPrice)))
  );
}
