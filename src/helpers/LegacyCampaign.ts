import { LOCATIONS } from "../Constants";
import type { GameType, LegacyCampaignType, ScenarioType } from "../Types";
import {
  LEGACY_CAMPAIGN_ID,
  LEGACY_GENERATION_MONTHS,
  LEGACY_GENERATIONS,
  LEGACY_SCENARIOS,
  isLegacyCampaignScenario,
} from "../data/LegacyCampaign";
import {
  getCostTableDeflator,
  getRateInflationIndex,
  getInflationIndex,
} from "../data/Economy";
import { MINUTES_PER_MONTH } from "./DateTime";

export const legacyMonthOffset = (
  game: Partial<Pick<GameType, "campaign">>,
): number => game.campaign?.termStartMonth ?? 0;

export const legacyCompletedMonths = (
  game: Pick<GameType, "date"> & Partial<Pick<GameType, "campaign">>,
): number => Math.max(0, game.date.monthsElapsed - legacyMonthOffset(game));

/** Authored competition remains independent from the player's live price and bill memory. */
export const legacyMarketReferenceRate = (
  game: Partial<Pick<GameType, "campaign">>,
  scenario: ScenarioType,
): number => game.campaign?.referenceRate ?? scenario.dollarsPerkWh;

export function legacyGenerationContext(
  game: GameType,
  generationIndex: number,
  openingCustomers: number,
  openingFleet: LegacyCampaignType["openingFleet"],
): Omit<
  LegacyCampaignType,
  "version" | "completedTerms" | "pendingHandover" | "inheritedDemandMultiplier"
> {
  const scenario = LEGACY_SCENARIOS[generationIndex];
  const generation = LEGACY_GENERATIONS[generationIndex];
  const date = { year: generation.startYear, monthNumber: 1 };
  const rateDollars = getRateInflationIndex(date, game.startingYear, game.seed);
  const endDate = { year: generation.startYear + 19, monthNumber: 12 };
  // Freeze the real opening forecast before installing the incoming generation's effects.
  const peakW = Math.max(1, ...game.timeline.map((tick) => tick.demandW));
  const annualDemandMWh =
    ((game.timeline.reduce((sum, tick) => sum + Math.max(0, tick.demandW), 0) /
      Math.max(1, game.timeline.length)) *
      8760) /
    1e6;
  return {
    openingCash: game.timeline[0]?.cash ?? 0,
    openingFleet,
    generationIndex,
    termStartMonth: generationIndex * LEGACY_GENERATION_MONTHS,
    openingCustomers,
    referenceRate: scenario.dollarsPerkWh / rateDollars,
    goalRateIndex: getRateInflationIndex(endDate, game.startingYear, game.seed),
    goalCostIndex: getInflationIndex(endDate, game.startingYear, game.seed),
    peakMW: peakW / 1e6,
    northCapacityMW:
      (game.transmission?.lines.find(
        (line) => line.corridorId === "california-north",
      )?.capacityW ?? 0) / 1e6,
    debtAllowance:
      (peakW / 1e6) *
      generation.debtDollars2023PerMW *
      getCostTableDeflator(game.startingYear),
    emissionsBudgetTonnes: Math.max(1, annualDemandMWh * 20 * 0.25 * 1.3),
  };
}

export function initializeLegacyCampaign(
  game: GameType,
  customers: number,
  openingFleet: LegacyCampaignType["openingFleet"],
): void {
  if (game.scenarioId !== LEGACY_CAMPAIGN_ID) return;
  game.campaign = {
    version: 1,
    ...legacyGenerationContext(game, 0, customers, openingFleet),
    inheritedDemandMultiplier: 1,
    completedTerms: [],
    pendingHandover: false,
  };
  delete game.runIdentity;
  delete game.challenge;
}

const nonnegative = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0;
const integer = (value: unknown): value is number =>
  nonnegative(value) && Number.isSafeInteger(value);

/** Shape and clock checks precede interpretation of any untrusted campaign evidence. */
export function validLegacyCampaign(game: GameType): boolean {
  const campaign = game.campaign;
  if (!campaign) return !isLegacyCampaignScenario(game.scenarioId);
  if (
    !isLegacyCampaignScenario(game.scenarioId) ||
    game.customScenario ||
    game.multiplayer ||
    game.runIdentity ||
    game.challenge ||
    game.startingYear !== LEGACY_GENERATIONS[0].startYear ||
    !game.location ||
    (
      [
        "id",
        "lat",
        "long",
        "watershedId",
        "timeZone",
        "region",
        "country",
        "admin",
      ] as const
    ).some((field) => game.location[field] !== LOCATIONS.SF[field]) ||
    !campaign ||
    campaign.version !== 1 ||
    !integer(campaign.generationIndex) ||
    campaign.generationIndex >= LEGACY_GENERATIONS.length ||
    campaign.termStartMonth !==
      campaign.generationIndex * LEGACY_GENERATION_MONTHS ||
    game.scenarioId !==
      LEGACY_GENERATIONS[campaign.generationIndex].scenarioId ||
    typeof campaign.pendingHandover !== "boolean" ||
    !nonnegative(campaign.inheritedDemandMultiplier) ||
    campaign.inheritedDemandMultiplier < 1 ||
    campaign.inheritedDemandMultiplier > 1e8 ||
    !nonnegative(campaign.openingCash) ||
    !Array.isArray(campaign.openingFleet) ||
    campaign.openingFleet.length > 20 ||
    campaign.openingFleet.some(
      (asset) =>
        !asset || typeof asset.fuel !== "string" || !nonnegative(asset.watts),
    ) ||
    !Array.isArray(campaign.completedTerms) ||
    campaign.completedTerms.length > LEGACY_GENERATIONS.length ||
    campaign.completedTerms.some(
      (term, index) =>
        !term ||
        typeof term !== "object" ||
        term.generationIndex !== index ||
        term.scenarioId !== LEGACY_GENERATIONS[index]?.scenarioId,
    )
  )
    return false;
  const elapsed =
    game.date.minute / MINUTES_PER_MONTH - campaign.termStartMonth;
  if (
    elapsed < 0 ||
    (elapsed > LEGACY_GENERATION_MONTHS &&
      !(
        campaign.generationIndex === LEGACY_GENERATIONS.length - 1 &&
        campaign.completedTerms.length === LEGACY_GENERATIONS.length
      )) ||
    game.date.monthsElapsed !==
      Math.floor(game.date.minute / MINUTES_PER_MONTH) ||
    game.date.year !==
      game.startingYear + Math.floor(game.date.monthsElapsed / 12) ||
    game.date.monthNumber !== (game.date.monthsElapsed % 12) + 1 ||
    (campaign.pendingHandover &&
      (elapsed !== LEGACY_GENERATION_MONTHS ||
        campaign.generationIndex === LEGACY_GENERATIONS.length - 1 ||
        game.speed !== "PAUSED"))
  )
    return false;
  const closedCurrent =
    campaign.completedTerms.length === campaign.generationIndex + 1;
  if (
    campaign.completedTerms.length !==
    campaign.generationIndex +
      (campaign.pendingHandover ||
      (elapsed >= LEGACY_GENERATION_MONTHS && closedCurrent)
        ? 1
        : 0)
  )
    return false;
  const expectedCustomers =
    campaign.generationIndex === 0
      ? LEGACY_SCENARIOS[0].startingCustomers
      : campaign.completedTerms[campaign.generationIndex - 1]?.closingCustomers;
  if (campaign.openingCustomers !== expectedCustomers) return false;
  const authoredDebtAllowance = (
    context: Pick<
      LegacyCampaignType,
      "generationIndex" | "debtAllowance" | "peakMW"
    >,
  ) => {
    const generation = LEGACY_GENERATIONS[context.generationIndex];
    return (
      context.debtAllowance ===
      context.peakMW *
        generation.debtDollars2023PerMW *
        getCostTableDeflator(game.startingYear)
    );
  };
  // Cold Continue parses before Loading initializes economy data. The objective-context
  // digest binds the saved rate; only live context creation converts its authored dollars.
  if (
    !authoredDebtAllowance(campaign) ||
    campaign.completedTerms.some(
      (term, index) =>
        !authoredDebtAllowance(term) ||
        term.openingCustomers !==
          (index === 0
            ? LEGACY_SCENARIOS[0].startingCustomers
            : campaign.completedTerms[index - 1].closingCustomers),
    )
  )
    return false;
  const contexts = [...campaign.completedTerms, campaign];
  if (
    contexts.some(
      (context) =>
        !nonnegative(context.openingCustomers) ||
        context.openingCustomers <= 0 ||
        !nonnegative(context.referenceRate) ||
        context.referenceRate > 100 ||
        !nonnegative(context.peakMW) ||
        context.peakMW > 1e9 ||
        !nonnegative(context.northCapacityMW) ||
        context.northCapacityMW > 1e9 ||
        !nonnegative(context.debtAllowance) ||
        context.debtAllowance > 1e15 ||
        !nonnegative(context.goalRateIndex) ||
        context.goalRateIndex <= 0 ||
        context.goalRateIndex > 1e12 ||
        !nonnegative(context.goalCostIndex) ||
        context.goalCostIndex <= 0 ||
        context.goalCostIndex > 1e12 ||
        !nonnegative(context.emissionsBudgetTonnes) ||
        context.emissionsBudgetTonnes > 1e12 ||
        !nonnegative(context.inheritedDemandMultiplier) ||
        context.inheritedDemandMultiplier < 1 ||
        context.inheritedDemandMultiplier > 1e8,
    )
  )
    return false;
  return campaign.completedTerms.every(
    (term, index) =>
      term.generationIndex === index &&
      term.scenarioId === LEGACY_GENERATIONS[index].scenarioId &&
      nonnegative(term.closingCash) &&
      nonnegative(term.closingCustomers) &&
      nonnegative(term.closingDebt) &&
      term.objectiveProgress?.completedMonths === LEGACY_GENERATION_MONTHS &&
      Array.isArray(term.objectiveResults) &&
      term.objectiveResults.length <= 16 &&
      !!term.debrief &&
      typeof term.debrief === "object" &&
      !term.objectiveResults.some(
        (result) => result.required && result.status !== "completed",
      ),
  );
}
