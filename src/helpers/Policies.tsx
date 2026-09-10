import type {
  GameType,
  DeferredResidentialLoad,
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
    validStartHour(p.startHour) &&
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
        validStartHour(s.startHour) &&
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
        if (isOperatingPolicy(id)) {
          if (s.pending.startHour === undefined) delete s.startHour;
          else s.startHour = s.pending.startHour;
        }
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

const validStartHour = (hour: unknown) =>
  hour === undefined ||
  (typeof hour === "number" &&
    Number.isInteger(hour) &&
    hour >= 0 &&
    hour < 24);
export const policyStartHour = (program?: { startHour?: number }) =>
  program?.startHour ?? 17;
const windowOffset = (minute: number, startHour: number) =>
  (((minute - startHour * 60) % MINUTES_PER_MONTH) + MINUTES_PER_MONTH) %
  MINUTES_PER_MONTH;
export const policyPeakHour = (minute: number, startHour = 17) =>
  windowOffset(minute, startHour) < 240;
export const samePolicyChoice = (
  id: PolicyId,
  a: { tier: PolicyTier; startHour?: number },
  b: { tier: PolicyTier; startHour?: number },
) =>
  a.tier === b.tier &&
  (!isOperatingPolicy(id) || policyStartHour(a) === policyStartHour(b));

export function validDeferredResidential(value: unknown): boolean {
  if (value === undefined) return true;
  if (!Array.isArray(value)) return false;
  return value.every(
    (entry: DeferredResidentialLoad) =>
      entry &&
      Number.isFinite(entry.energyWh) &&
      entry.energyWh >= 0 &&
      Number.isInteger(entry.recoveryStartMinute) &&
      entry.recoveryStartMinute >= 0 &&
      entry.recoveryEndMinute === entry.recoveryStartMinute + 180,
  );
}

/** Each batch keeps its original three-hour recovery window, including when
 * a new month changes or disables the tariff. Industry never enters the queue. */
export function applyPeakDemand(
  game: GameType,
  tick: TickPresentFutureType,
  deferred: readonly DeferredResidentialLoad[] = [],
  stepMinutes = TICK_MINUTES,
) {
  tick.deferredResidentialStart = deferred.map((entry) => ({ ...entry }));
  tick.deferredResidentialWhStart = deferred.reduce(
    (sum, entry) => sum + entry.energyWh,
    0,
  );
  const queue = deferred.map((entry) => ({ ...entry }));
  tick.shiftedResidentialW = 0;
  const p = game.policies?.programs;
  const tariff =
    participation(p?.timeOfUse?.tier ?? "Off") * POLICIES.timeOfUse.cap;
  const contract =
    participation(p?.curtailment?.tier ?? "Off") * POLICIES.curtailment.cap;
  if (policyPeakHour(tick.minute, policyStartHour(p?.timeOfUse))) {
    const removedW = tick.demandByType.Residential * tariff;
    tick.demandByType.Residential -= removedW;
    const recoveryStartMinute =
      tick.minute -
      windowOffset(tick.minute, policyStartHour(p?.timeOfUse)) +
      240;
    if (removedW > 0) {
      let batch = queue.find(
        (entry) => entry.recoveryStartMinute === recoveryStartMinute,
      );
      if (!batch) {
        batch = {
          energyWh: 0,
          recoveryStartMinute,
          recoveryEndMinute: recoveryStartMinute + 180,
        };
        queue.push(batch);
      }
      batch.energyWh += (removedW * stepMinutes) / 60;
    }
  }
  if (policyPeakHour(tick.minute, policyStartHour(p?.curtailment))) {
    tick.demandByType.Industrial *= 1 - contract;
    tick.demandByType["Data centers"] *= 1 - contract;
  }
  for (const batch of queue) {
    const start = Math.max(tick.minute, batch.recoveryStartMinute);
    const duration = Math.max(
      0,
      Math.min(tick.minute + stepMinutes, batch.recoveryEndMinute) - start,
    );
    if (duration === 0) continue;
    const returnedWh =
      (batch.energyWh * duration) / (batch.recoveryEndMinute - start);
    tick.shiftedResidentialW += (returnedWh * 60) / stepMinutes;
    batch.energyWh = Math.max(0, batch.energyWh - returnedWh);
  }
  tick.demandByType.Residential += tick.shiftedResidentialW;
  tick.deferredResidential = queue.filter((entry) => entry.energyWh > 0);
  tick.deferredResidentialWh = tick.deferredResidential.reduce(
    (sum, entry) => sum + entry.energyWh,
    0,
  );
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
  const tariffOffset = windowOffset(tick.minute, policyStartHour(p?.timeOfUse));
  const tariffPeak = tariffOffset < 240;
  const contractPeak = policyPeakHour(
    tick.minute,
    policyStartHour(p?.curtailment),
  );
  const fraction = (enrolled: number, peak: boolean) =>
    peak ? (enrolled * 0.8) / (1 - enrolled * 0.2) : enrolled;
  const tariffDelta = tariffPeak
    ? 0.3
    : tariffOffset >= 240 && tariffOffset < 420
      ? -0.1
      : 0;
  const returnedW = tick.shiftedResidentialW ?? 0;
  const enrolledResidentialW =
    (tick.demandByType.Residential - returnedW) *
    fraction(enrolledTariff, tariffPeak);
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
          returnedW * 0.1 -
          industrial * fraction(enrolledContract, contractPeak) * 0.1) /
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
