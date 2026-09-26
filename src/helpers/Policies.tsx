import type {
  GameType,
  DeferredResidentialLoad,
  PoliciesType,
  PolicyProgramType,
  PolicyChangeType,
  PolicyId,
  PolicyTier,
  TickPresentFutureType,
} from "../Types";
import {
  POLICIES,
  residentialSolarCostPerW,
  POLICY_IDS,
  POLICY_TIERS,
  POLICY_SCENARIOS,
} from "../data/Policies";
import { getInflationIndex } from "../data/Economy";
import { TICK_MINUTES } from "../Constants";
import { getSolarOutputFactor } from "./Energy";
import { CUSTOMER_MARKET_MULTIPLIER } from "./Customers";
import { getDateFromMinute, MINUTES_PER_MONTH } from "./DateTime";

export function emptyPolicies(month = 0): PoliciesType {
  return {
    month,
    programs: {
      efficiency: {
        tier: "Off",
        adoption: 0,
        spending: 0,
        spent: 0,
        installs: [],
      },
      solar: { tier: "Off", adoption: 0, spending: 0, spent: 0, installs: [] },
      timeOfUse: { tier: "Off", adoption: 0, spending: 0, spent: 0 },
      curtailment: { tier: "Off", adoption: 0, spending: 0, spent: 0 },
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
/** Build-out cohorts are installed in processed months and add up to the recorded progress. */
function validInstalls(id: PolicyId, s: PolicyProgramType, month: number) {
  if (isOperatingPolicy(id)) return s.installs === undefined;
  if (!Array.isArray(s.installs)) return false;
  let total = 0;
  let last = 0;
  for (const entry of s.installs) {
    if (!Array.isArray(entry) || entry.length !== 2) return false;
    const [installed, share] = entry;
    if (
      !Number.isInteger(installed) ||
      installed <= last ||
      installed > month ||
      !Number.isFinite(share) ||
      share <= 0 ||
      share > 1
    )
      return false;
    last = installed;
    total += share;
  }
  return Math.abs(total - s.adoption) < 1e-6;
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
        Number.isFinite(s.spent) &&
        s.spent >= s.spending &&
        validInstalls(id, s, p.month) &&
        (s.completedMonth === undefined ||
          (!isOperatingPolicy(id) &&
            Number.isInteger(s.completedMonth) &&
            s.completedMonth >= 1 &&
            s.completedMonth <= p.month &&
            s.adoption === 1)) &&
        (!s.pending ||
          (validPolicyChange({ id, ...s.pending }) &&
            s.pending.month === currentMonth + 1 &&
            // A finished build-out has nothing left to start or pause.
            (isOperatingPolicy(id) || !buildoutComplete(s.adoption))))
      );
    })
  );
}
export type BuildoutPolicyId = "efficiency" | "solar";
export const buildoutMonths = (id: BuildoutPolicyId) =>
  POLICIES[id].buildoutMonths;
/** Monthly spending while a build-out program is installing. Operating offers cost nothing
 * directly; their bill credits reduce revenue instead. */
export function policyBudget(
  game: GameType,
  id: PolicyId,
  tier: PolicyTier,
  month: number,
): number {
  if (tier === "Off" || isOperatingPolicy(id)) return 0;
  return (
    policyTotalCost(game, id as BuildoutPolicyId, month) /
    buildoutMonths(id as BuildoutPolicyId)
  );
}
/** Programs are sized by the customers the utility served when the run opened, scaled like
 * demand. The market also counts customers the utility could win, so it overstates the pool. */
export const programCustomers = (game: GameType) =>
  (game.customerMarketSize / CUSTOMER_MARKET_MULTIPLIER) *
  game.startingDemandScale;
/** Whole build-out cost at the given month's technology prices, in that month's dollars. Like
 * facility costs, the real price tables are start-year dollars carried forward by inflation. */
export function policyTotalCost(
  game: GameType,
  id: BuildoutPolicyId,
  month: number,
): number {
  const date = getDateFromMinute(month * MINUTES_PER_MONTH, game.startingYear);
  const perCustomer =
    id === "solar"
      ? POLICIES.solar.rebateShare *
        residentialSolarCostPerW(date.year) *
        POLICIES.solar.cap
      : POLICIES.efficiency.costPerCustomer;
  return (
    programCustomers(game) *
    perCustomer *
    getInflationIndex(date, game.startingYear, game.seed)
  );
}
/** Share of an efficiency cohort's savings still working at the given age. */
export function efficiencySurvival(ageMonths: number): number {
  const { fullLifeMonths, endLifeMonths } = POLICIES.efficiency;
  if (ageMonths <= fullLifeMonths) return 1;
  if (ageMonths >= endLifeMonths) return 0;
  return (endLifeMonths - ageMonths) / (endLifeMonths - fullLifeMonths);
}
/** Installed efficiency still saving energy in the given month, as a share of the full pool. */
export function efficiencyInEffect(
  program: PolicyProgramType,
  month: number,
): number {
  if (!program.installs) return program.adoption;
  let share = 0;
  for (const [installed, amount] of program.installs)
    share += amount * efficiencySurvival(month - installed);
  return share;
}
// Monthly increments such as 1/48 do not sum exactly to 1 in floating point.
const COMPLETE = 1 - 1e-9;
export const buildoutComplete = (adoption: number) => adoption >= COMPLETE;
/** Whole months of installation left, counting a partial final month as one. */
export const buildoutMonthsRemaining = (
  id: BuildoutPolicyId,
  adoption: number,
) =>
  buildoutComplete(adoption)
    ? 0
    : Math.ceil((1 - adoption) * buildoutMonths(id) - 1e-6);
/** Months of installation completed so far, e.g. 8 of 24. */
export const buildoutMonthsDone = (id: BuildoutPolicyId, adoption: number) =>
  buildoutMonths(id) - buildoutMonthsRemaining(id, adoption);
/** The last month that installs upgrades if the program runs from `startMonth` without pausing. */
export const buildoutCompletionMonth = (
  id: BuildoutPolicyId,
  adoption: number,
  startMonth: number,
) => startMonth + buildoutMonthsRemaining(id, adoption) - 1;
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
      const rate =
        s.tier === "On" ? 1 / buildoutMonths(id as BuildoutPolicyId) : 0;
      const increment = buildoutComplete(s.adoption)
        ? 0
        : Math.min(1 - s.adoption, rate);
      // A final partial month pays only for the installations it funds.
      s.spending =
        increment > 0
          ? (policyBudget(game, id, s.tier, m) * increment) / rate
          : 0;
      s.spent += s.spending;
      if (increment > 0) (s.installs ??= []).push([m, increment]);
      if (increment > 0 && buildoutComplete(s.adoption + increment)) {
        s.adoption = 1;
        s.completedMonth = m;
      } else s.adoption += increment;
    });
    p.month = m;
  }
  return activated;
}
export const isOperatingPolicy = (id: PolicyId) =>
  id === "timeOfUse" || id === "curtailment";
export const participation = (tier: PolicyTier) => (tier === "On" ? 0.5 : 0);

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
    // Smelters and concentrators are the original interruptible customer - a utility short of
    // power calls the mine before it calls anyone else, which is exactly what ZESCO did.
    tick.demandByType.Mining *= 1 - contract;
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
    tick.demandByType.Industrial +
    tick.demandByType["Data centers"] +
    tick.demandByType.Mining;
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
/** Efficiency first, then rooftop solar on what remains. `weatherShare` is the fraction of this
 * tick's demand driven by heating and cooling, which envelope upgrades cut far more than the rest. */
export function applyPolicyDemand(
  game: GameType,
  tick: TickPresentFutureType,
  weatherShare = 0,
) {
  const p = game.policies?.programs;
  if (!p) return;
  const efficiency = efficiencyInEffect(
    p.efficiency,
    Math.floor(tick.minute / MINUTES_PER_MONTH),
  );
  if (!efficiency && !p.solar.adoption) return;
  const { applianceSaving, weatherSaving } = POLICIES.efficiency;
  const reduction =
    1 -
    efficiency *
      (applianceSaving * (1 - weatherShare) + weatherSaving * weatherShare);
  const eligible = tick.demandByType.Residential + tick.demandByType.Commercial;
  const residential = tick.demandByType.Residential * reduction;
  const commercial = tick.demandByType.Commercial * reduction;
  const load = residential + commercial;
  const solar =
    p.solar.adoption *
    POLICIES.solar.cap *
    programCustomers(game) *
    getSolarOutputFactor(tick.solarIrradianceWM2, tick.temperatureC) *
    POLICIES.solar.derate;
  const remaining = load > 0 ? Math.max(0, load - solar) / load : 0;
  tick.rebateEligibleW = eligible;
  tick.efficiencySavedW = eligible - load;
  tick.rooftopSolarW = load * (1 - remaining);
  tick.demandByType = {
    ...tick.demandByType,
    Residential: residential * remaining,
    Commercial: commercial * remaining,
  };
}
