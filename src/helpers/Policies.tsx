import type {
  GameType,
  PoliciesType,
  PolicyChangeType,
  PolicyId,
  PolicyTier,
  TickPresentFutureType,
} from "../Types";
import {
  POLICIES,
  POLICY_IDS,
  POLICY_TIERS,
  POLICY_SCENARIOS,
  POLICY_FUNDING,
} from "../data/Policies";
import { getInflationIndex } from "../data/Economy";
import { EQUATOR_RADIANCE, TICK_MINUTES } from "../Constants";
import { getDateFromMinute, MINUTES_PER_MONTH } from "./DateTime";

export function emptyPolicies(month = 0): PoliciesType {
  return {
    month,
    programs: {
      efficiency: { tier: "Off", adoption: 0, spending: 0 },
      solar: { tier: "Off", adoption: 0, spending: 0 },
      timeOfUse: { tier: "Off", adoption: 0, spending: 0 },
      curtailment: { tier: "Off", adoption: 0, spending: 0 },
    },
  };
}
export function policyAvailable(game: GameType): boolean {
  return (
    POLICY_SCENARIOS.includes(game.scenarioId) &&
    !game.customScenario?.tutorialSteps &&
    (game.customScenario?.durationMonths ?? 240) >= 6
  );
}
export function validPolicyChange(value: unknown): value is PolicyChangeType {
  const p = value as PolicyChangeType | undefined;
  return (
    !!p &&
    POLICY_IDS.includes(p.id) &&
    POLICY_TIERS.includes(p.tier) &&
    Number.isInteger(p.month) &&
    p.month > 0
  );
}
export function validPolicies(
  value: unknown,
  currentMonth: number,
): value is PoliciesType {
  const p = value as PoliciesType | undefined;
  return (
    !!p &&
    Number.isInteger(p.month) &&
    p.month >= 0 &&
    p.month === currentMonth &&
    !!p.programs &&
    POLICY_IDS.every((id) => {
      const s = p.programs[id];
      return (
        !!s &&
        POLICY_TIERS.includes(s.tier) &&
        Number.isFinite(s.adoption) &&
        s.adoption >= 0 &&
        s.adoption <= 1 &&
        Number.isFinite(s.spending) &&
        s.spending >= 0 &&
        (!s.pending ||
          (validPolicyChange({ id, ...s.pending }) &&
            s.pending.month === currentMonth + 1))
      );
    })
  );
}
export function policyBudget(
  game: GameType,
  id: PolicyId,
  tier: PolicyTier,
  month: number,
): number {
  if (tier === "Off") return 0;
  return (
    game.customerMarketSize *
    game.startingDemandScale *
    POLICIES[id].costPerCustomer *
    POLICY_FUNDING[tier].cost *
    getInflationIndex(
      getDateFromMinute(month * MINUTES_PER_MONTH, game.startingYear),
      game.startingYear,
      game.seed,
    )
  );
}
/** Activation, then funded installations, then their spending. Idempotent per month.
 * Forecast callers own a private copy. Installed measures never retire during this run. */
export function advancePolicies(game: GameType, month: number): PolicyId[] {
  if (!game.policies) return [];
  const activated: PolicyId[] = [];
  const p = game.policies;
  for (let m = p.month + 1; m <= month; m++) {
    POLICY_IDS.forEach((id) => {
      const s = p.programs[id];
      if (s.pending && s.pending.month <= m) {
        s.tier = s.pending.tier;
        delete s.pending;
        activated.push(id);
      }
      if (isOperatingPolicy(id)) {
        s.adoption = participation(s.tier);
        s.spending = 0;
        return;
      }
      const increment = Math.min(
        1 - s.adoption,
        POLICY_FUNDING[s.tier].adoption,
      );
      s.spending =
        increment > 0
          ? (policyBudget(game, id, s.tier, m) * increment) /
            POLICY_FUNDING[s.tier].adoption
          : 0;
      s.adoption = Math.min(1, s.adoption + increment);
    });
    p.month = m;
  }
  return activated;
}
export const isOperatingPolicy = (id: PolicyId) =>
  id === "timeOfUse" || id === "curtailment";
export const participation = (tier: PolicyTier) =>
  tier === "Large" ? 0.5 : tier === "Small" ? 0.25 : 0;

const peakHour = (minute: number) => {
  const localMinute =
    ((minute % MINUTES_PER_MONTH) + MINUTES_PER_MONTH) % MINUTES_PER_MONTH;
  return localMinute >= 17 * 60 && localMinute < 21 * 60;
};

/** Defer actual residential energy until later in the same representative day.
 * Industrial curtailment is eliminated consumption and never enters the queue. */
export function applyPeakDemand(
  game: GameType,
  tick: TickPresentFutureType,
  deferredWh = 0,
  stepMinutes = TICK_MINUTES,
) {
  const localMinute = tick.minute % MINUTES_PER_MONTH;
  tick.deferredResidentialWh = localMinute === 0 ? 0 : deferredWh;
  tick.deferredResidentialWhStart = tick.deferredResidentialWh;
  tick.shiftedResidentialW = 0;
  const p = game.policies?.programs;
  const tariff =
    participation(p?.timeOfUse?.tier ?? "Off") * POLICIES.timeOfUse.cap;
  const contract =
    participation(p?.curtailment?.tier ?? "Off") * POLICIES.curtailment.cap;
  if (peakHour(tick.minute)) {
    const removedW = tick.demandByType.Residential * tariff;
    tick.demandByType.Residential -= removedW;
    tick.deferredResidentialWh += (removedW * stepMinutes) / 60;
    tick.demandByType.Industrial *= 1 - contract;
    tick.demandByType["Data centers"] *= 1 - contract;
  } else if (localMinute >= 21 * 60) {
    const remainingMinutes = MINUTES_PER_MONTH - localMinute;
    const returnedW = (tick.deferredResidentialWh * 60) / remainingMinutes;
    tick.shiftedResidentialW = returnedW;
    tick.demandByType.Residential += returnedW;
    tick.deferredResidentialWh = Math.max(
      0,
      tick.deferredResidentialWh - (returnedW * stepMinutes) / 60,
    );
  }
}

/** Bill only delivered energy. After curtailment, enrolled users form a smaller
 * fraction of each sector's remaining load, so discounting the original fraction
 * would over-credit them. The two offers apply to disjoint sectors. */
export function customerBillingRate(
  game: GameType,
  tick: Pick<
    TickPresentFutureType,
    "minute" | "demandByType" | "shiftedResidentialW"
  >,
) {
  const p = game.policies?.programs;
  const enrolledTariff = participation(p?.timeOfUse?.tier ?? "Off");
  const enrolledContract = participation(p?.curtailment?.tier ?? "Off");
  const peak = peakHour(tick.minute);
  const fraction = (enrolled: number) =>
    peak ? (enrolled * 0.8) / (1 - enrolled * 0.2) : enrolled;
  const tariffDelta = peak
    ? 0.3
    : tick.minute % MINUTES_PER_MONTH >= 21 * 60
      ? -0.1
      : 0;
  const returnedW = tick.shiftedResidentialW ?? 0;
  const enrolledResidentialW =
    (tick.demandByType.Residential - returnedW) * fraction(enrolledTariff) +
    returnedW;
  const industrial =
    tick.demandByType.Industrial + tick.demandByType["Data centers"];
  const total = Object.values(tick.demandByType).reduce(
    (sum, watts) => sum + watts,
    0,
  );
  return (
    game.dollarsPerkWh *
    (total > 0
      ? 1 +
        (enrolledResidentialW * tariffDelta -
          industrial * fraction(enrolledContract) * 0.1) /
          total
      : 1)
  );
}
export function applyPolicyDemand(game: GameType, tick: TickPresentFutureType) {
  const p = game.policies?.programs;
  if (!p || (!p.efficiency.adoption && !p.solar.adoption)) return;
  const reduction = 1 - p.efficiency.adoption * POLICIES.efficiency.cap;
  const residential = tick.demandByType.Residential * reduction;
  const commercial = tick.demandByType.Commercial * reduction;
  const load = residential + commercial;
  const solar =
    (p.solar.adoption *
      POLICIES.solar.cap *
      game.customerMarketSize *
      game.startingDemandScale *
      Math.max(0, tick.solarIrradianceWM2)) /
    EQUATOR_RADIANCE;
  const remaining = load > 0 ? Math.max(0, load - solar) / load : 0;
  tick.demandByType = {
    ...tick.demandByType,
    Residential: residential * remaining,
    Commercial: commercial * remaining,
  };
}
