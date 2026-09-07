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
import { EQUATOR_RADIANCE } from "../Constants";
import { getDateFromMinute, MINUTES_PER_MONTH } from "./DateTime";

export function emptyPolicies(month = 0): PoliciesType {
  return {
    month,
    programs: {
      efficiency: { tier: "Off", adoption: 0, spending: 0 },
      solar: { tier: "Off", adoption: 0, spending: 0 },
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
