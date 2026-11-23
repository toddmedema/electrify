import {
  createTerritoryTileAdjacency,
  getFacilityTile,
  getTerritoryTile,
  hasTerritoryNetwork,
  ownedTerritoryTiles,
} from "./TerritoryTiles";
import {
  MUNICIPAL_UTILITIES,
  municipalUtility,
  type MunicipalPlant,
} from "../data/MunicipalUtilities";
import { pendingTileConnections } from "./TerritoryConnections";
import { municipalTerritoryOffer, transferTerritorySites } from "./Territories";
import { TERRITORY_TILES } from "../data/TerritoryTiles";
import {
  landTransferredCustomerTotal,
  landCustomerMarket,
  landCustomerReceipts,
} from "./TerritoryCustomers";
import {
  AGREEMENT_UTILITIES,
  agreementBasePrice,
  agreementPrice,
  agreementTermsAt,
  compareAgreementDispatchPriority,
  agreementRate,
  utilityOwnedAt,
  inheritedConnection,
  agreementCorridorId,
} from "./PowerAgreements";
import {
  allocateIntertieFlows,
  intertieOfferLimits,
  firmIntertieOfferLimits,
  transmissionRatingW,
  type IntertieReservation,
} from "./Transmission";
import {
  isStorage,
  type AcquireUtilityAction,
  type AcquisitionLoan,
  type FacilityOperatingType,
  type GameType,
  type LocationType,
  type TerritoryId,
  type TerritoryTileId,
  type FacilityShoppingType,
  type UtilityId,
  type UtilityTargetId,
  type UtilityNetworkAsset,
} from "../Types";
import { isUtilityExpansionGame } from "./ExpansionContext";
import { intertieContextForGame } from "./Transmission";
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
  facilityAgeYears,
  facilityCashBack,
  getMonthlyPayment,
  purchaseTerms,
} from "./Financials";
import {
  getDateFromMinute,
  getTimeFromTimeline,
  MINUTES_PER_MONTH,
} from "./DateTime";
import { cityCustomerCount } from "./CityProfiles";
import { customerMarketSizeAt } from "./Customers";
import { defaultDispatchIndex } from "./DispatchOrder";
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
  game: Pick<GameType, "utilityExpansion" | "territoryNetwork"> &
    Partial<Pick<GameType, "date">>,
  beforeMinute = Infinity,
): number {
  if (game.date) beforeMinute = Math.min(beforeMinute, game.date.minute + 1);
  return (
    UTILITY_AREAS.champlain.customers +
    landTransferredCustomerTotal(game, beforeMinute) +
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
function sellerOpening(game: GameType, location: LocationType): GameType {
  return {
    ...game,
    scenarioId: EXPANSION_SCENARIO_ID,
    customScenario: undefined,
    // Existing seller equipment keeps its authored protection even in an unscored sandbox.
    storyEffectsDisabled: false,
    weatherHazardsDisabled: false,
    utilityExpansion: undefined,
    location,
    commissionedHydroSiteIds: [],
    date: getDateFromMinute(0, 2005),
    facilities: [],
    timeline: [],
  };
}

function nextFacilityId(game: GameType): number {
  return (
    game.facilities.reduce((max, facility) => Math.max(max, facility.id), 0) + 1
  );
}

function inheritedFacility(
  game: GameType,
  quote: FacilityShoppingType,
  id: number,
  territoryId: TerritoryId,
  tileId: TerritoryTileId | undefined,
  age: number,
  startingAssetId?: string,
  hydroSiteId = quote.hydroSiteId,
): FacilityOperatingType {
  const { viableLocationsRemaining: _remaining, ...technology } = quote;
  const packageCost = INHERITED_COLD_PACKAGE_COST_2005[startingAssetId ?? ""];
  if (packageCost !== undefined && !isStorage(technology)) {
    technology.buildCost +=
      packageCost - (technology.resilienceExtraBuildCost ?? 0);
    technology.resilienceExtraBuildCost = packageCost;
  }
  return {
    ...technology,
    territoryId,
    tileId,
    startingAssetId,
    hydroSiteId,
    ...(quote.fuel === "Wind"
      ? { annualOutputDegradation: windAnnualOutputDegradation(2005 - age) }
      : {}),
    id,
    currentW: 0,
    currentWh: quote.peakWh === undefined ? undefined : 0,
    yearsToBuildLeft: 0,
    minuteCreated: game.date.minute,
    minuteOperational: age === 0 ? 0 : -age * DAYS_PER_YEAR * 24 * 60,
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
  } as FacilityOperatingType;
}

/** Inherited assets use their opening technology and age, not a newly built 2017 plant. */
export function acquisitionAssets(
  game: GameType,
  targetId: UtilityTargetId,
): FacilityOperatingType[] | undefined {
  const definition = UTILITY_AREAS[targetId];
  const opening = sellerOpening(game, definition.location);
  let nextId = nextFacilityId(game);
  const result: FacilityOperatingType[] = [];
  for (const search of definition.facilities) {
    if (game.date.monthsElapsed > 227 && search.fuel === "Oil") continue;
    const quote = startingFacilityQuote(opening, search);
    if (!quote) return undefined;
    result.push(
      inheritedFacility(
        game,
        quote,
        nextId++,
        targetId,
        getFacilityTile({ startingAssetId: search.assetId })?.id,
        search.initialAgeYears ?? 0,
        search.assetId,
        search.hydroSiteId,
      ),
    );
  }
  return result;
}
interface RegionalUtilityOffer {
  kind: "regional";
  targetId: UtilityTargetId;
  name: string;
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
function regionalUtilityOffer(
  game: GameType,
  targetId: string,
): RegionalUtilityOffer | undefined {
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
    ) - utilityNetworkAnnualOM(owned, currentCustomers);
  return {
    kind: "regional",
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
export function bordersUtility(game: GameType, targetId: string): boolean {
  if (!hasTerritoryNetwork(game)) return true;
  const pending = pendingTileConnections(game);
  const adjacent = createTerritoryTileAdjacency(
    ownedTerritoryTiles(game).filter(({ id }) => !pending.has(id)),
  );
  return TERRITORY_TILES.some(
    (tile) => tile.territoryId === targetId && adjacent(tile),
  );
}

/** Resolve the seller's original plant even after it has been sold or expanded by the buyer. */
export function municipalPlantAsset(
  game: GameType,
  { tileId, facility }: MunicipalPlant,
) {
  const tile = getTerritoryTile(tileId, game);
  const { name, fuel, peakW } = facility;
  const technology = startingFacilityQuote(
    sellerOpening(game, UTILITY_AREAS.champlain.location),
    { name, fuel, peakW },
  );
  return tile && technology
    ? inheritedFacility(
        game,
        technology,
        nextFacilityId(game),
        tile.territoryId,
        tileId,
        0,
      )
    : undefined;
}

function municipalOffer(game: GameType, id: string) {
  const territory = municipalTerritoryOffer(game, id);
  if (!territory) return undefined;
  const plant = territory.plant && municipalPlantAsset(game, territory.plant);
  if (territory.plant && !plant) return undefined;
  const plantPrice = plant ? facilityCashBack(plant, game.date.minute) : 0;
  const price = territory.price + plantPrice;
  const financed = purchaseTerms(price, true, game.interestRate);
  return {
    kind: "municipal" as const,
    territory,
    plant,
    plantPrice,
    targetId: territory.utility.id,
    name: territory.utility.name,
    customers: territory.customers,
    equityPrice: price,
    fee: 0,
    assumedDebt: 0,
    cashDue: price,
    financedCashDue: financed.amountDue,
    newLoan: financed.loanAmount,
    monthlyDebtService: financed.monthlyPayment,
    cashMonthlyDebtService: 0,
    networkOMPerMonth: 0,
    facilities: plant
      ? [
          {
            name: plant.name,
            peakW: plant.peakW,
            ageYears: facilityAgeYears(plant, game.date.minute),
          },
        ]
      : [],
    contracts: [],
  };
}

export function utilityOffer(game: GameType, targetId: string) {
  return municipalOffer(game, targetId) ?? regionalUtilityOffer(game, targetId);
}

/** A neighboring utility can be bought without a power agreement or a line. */
export function acquisitionQuote(game: GameType, targetId: string) {
  const offer = utilityOffer(game, targetId);
  if (!offer) return undefined;
  const reachable =
    offer.kind === "municipal"
      ? offer.territory.reachable
      : bordersUtility(game, targetId);
  if (!reachable) return undefined;
  return {
    ...offer,
    quoteKey: JSON.stringify([
      offer.targetId,
      game.date.minute,
      game.interestRate,
      offer.equityPrice,
      offer.fee,
      offer.assumedDebt,
      ...(offer.kind === "municipal"
        ? [offer.territory.purchases, offer.customers]
        : []),
    ]),
  };
}
export type AcquisitionQuote = NonNullable<ReturnType<typeof acquisitionQuote>>;

export function acquisitionPaymentDue(
  quote: AcquisitionQuote,
  financed: boolean,
): number {
  return financed ? quote.financedCashDue : quote.cashDue;
}

export function validAcquisitionAction(
  value: unknown,
): value is AcquireUtilityAction {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const action = value as Partial<AcquireUtilityAction>;
  return (
    Object.keys(value).length === 3 &&
    (UTILITY_TARGETS.some((target) => target.id === action.targetId) ||
      !!municipalUtility(action.targetId)) &&
    typeof action.financed === "boolean" &&
    typeof action.quoteKey === "string"
  );
}

/** Dated receipts for all competitors, including municipal customers transferred in older saves. */
export function utilityAcquisitions(
  game: Pick<GameType, "utilityExpansion" | "territoryNetwork"> &
    Partial<Pick<GameType, "date">>,
) {
  const receipts = landCustomerReceipts(game).filter(
    ({ minute }) => minute <= (game.date?.minute ?? Infinity),
  );
  return [
    ...(game.utilityExpansion?.acquisitions ?? []),
    ...MUNICIPAL_UTILITIES.flatMap(({ id }) => {
      const receipt = receipts.find(({ territoryId }) => territoryId === id);
      return receipt
        ? [
            {
              targetId: id,
              minute: receipt.minute,
              financed:
                game.utilityExpansion?.loans.some(
                  (loan) =>
                    loan.targetId === id &&
                    loan.minuteCreated === receipt.minute,
                ) ?? false,
              transferredCustomers: customerMarketSizeAt(
                cityCustomerCount(id),
                receipt.minute,
              ),
            },
          ]
        : [];
    }),
  ].sort((a, b) => a.minute - b.minute);
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
  const due = acquisitionPaymentDue(quote, value.financed);
  if (now.cash < due) return false;
  const loan = (
    kind: AcquisitionLoan["kind"],
    principal: number,
    rate: number,
    months: number,
  ): AcquisitionLoan => ({
    id: `scenario-116-${quote.targetId}-${kind}`,
    targetId: quote.targetId,
    kind,
    principal,
    loanAmountLeft: principal,
    loanMonthlyPayment: getMonthlyPayment(principal, rate, months),
    interestRate: rate,
    months,
    minuteCreated: game.date.minute,
  });
  if (quote.kind === "municipal") {
    if (!transferTerritorySites(game, quote.territory, due)) return false;
    if (quote.plant)
      game.facilities.splice(
        defaultDispatchIndex(game.facilities, quote.plant),
        0,
        quote.plant,
      );
    if (value.financed)
      game.utilityExpansion.loans.push(
        loan("purchase", quote.newLoan, game.interestRate, LOAN_MONTHS),
      );
    return true;
  }
  const assets = acquisitionAssets(game, quote.targetId);
  if (!assets) return false;
  const oldProgramCustomers = programCustomers(game);
  now.cash -= due;
  now.customers += quote.customers;
  game.utilityExpansion.acquisitions.push({
    targetId: quote.targetId,
    minute: game.date.minute,
    financed: value.financed,
    transferredCustomers: quote.customers,
  });
  game.customerMarketSize =
    UTILITY_AREAS.champlain.addressablePool +
    landCustomerMarket(game) +
    game.utilityExpansion.acquisitions.reduce(
      (sum, receipt) => sum + UTILITY_AREAS[receipt.targetId].addressablePool,
      0,
    );
  const network: UtilityNetworkAsset = {
    targetId: quote.targetId,
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
  now.netWorth +=
    networkCarryingValue(network, game.date.minute) -
    network.initialValue -
    quote.fee;
  return true;
}

/** Finite supplier commitments feed the company pool; no connection is purchased or required. */
export function entitlementSources(
  game: GameType,
  now: import("../Types").TickPresentFutureType,
  reserved: readonly IntertieReservation[] = [],
  supplierReady = false,
  legacyOnly = false,
  excludedAgreementId?: string,
  agreementMinute = now.minute,
) {
  if (!game.utilityExpansion) return [];
  let context: ReturnType<typeof intertieContextForGame> | undefined;
  const sources = AGREEMENT_UTILITIES.flatMap((utilityId, index) => {
    if (!utilityOwnedAt(game, utilityId, agreementMinute)) return [];
    const line = inheritedConnection(utilityId, index + 100000);
    return agreementTermsAt(game, utilityId, agreementMinute)
      .filter(
        (source) =>
          source.id !== excludedAgreementId &&
          agreementMinute >= source.startMinute &&
          agreementMinute < source.endMinute &&
          source.nominalW > 0 &&
          (!supplierReady || source.termsVersion >= 2) &&
          (!legacyOnly || source.termsVersion === 1),
      )
      .map((source) => {
        const availableLine = {
          ...line,
          corridorId: agreementCorridorId(source.id, utilityId),
          capacityW: UTILITY_AREAS[utilityId].sourceInterfaceW,
        };
        const limits = (
          source.termsVersion >= 2
            ? firmIntertieOfferLimits
            : intertieOfferLimits
        )(
          availableLine,
          (context ??= intertieContextForGame(game)),
          now.minute,
          now,
        );
        const basePrice = agreementBasePrice(game, source);
        const pricePerMWh =
          source.termsVersion === 3
            ? agreementRate(
                game,
                basePrice,
                source.durationYears,
                availableLine.corridorId,
                agreementMinute,
                now,
                now.minute,
              )
            : agreementPrice(game, basePrice, agreementMinute);
        return {
          id: source.id,
          termsVersion: source.termsVersion,
          startMinute: source.startMinute,
          endMinute: source.endMinute,
          paused: false,
          utilityId,
          lineId: line.id,
          capacityW: source.nominalW * source.deliverability,
          pricePerMWh,
          emissionsKgPerMWh: source.emissionsKgPerMWh,
          offer: {
            ...limits,
            lineId: `${game.multiplayer?.seat ?? "local"}:supplier:${availableLine.corridorId}`,
            lineImportLimitW: transmissionRatingW(availableLine, now),
            importLimitW: Math.min(
              limits.importLimitW,
              source.nominalW * source.deliverability,
            ),
            pricePerMWh,
          },
        };
      });
  }).sort(compareAgreementDispatchPriority);
  if (!sources.length) return [];
  const allocated = allocateIntertieFlows(
    sources.map((source) => source.offer),
    Infinity,
    0,
    reserved,
  ).importedW;
  return sources.map((source, index) => ({
    ...source,
    capacityW: allocated[index],
  }));
}
