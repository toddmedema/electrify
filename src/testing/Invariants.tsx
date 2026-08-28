import {
  GAME_TO_REAL_YEARS,
  TICKS_PER_HOUR,
  TICKS_PER_MONTH,
} from "../Constants";
import {
  FacilityOperatingType,
  GameType,
  MonthlyHistoryType,
  StorageOperatingType,
  TickPresentFutureType,
} from "../Types";

type TickFieldType = keyof TickPresentFutureType;
type MonthFieldType = keyof MonthlyHistoryType;

export interface ViolationType {
  rule: string;
  when: string; // Human readable point in game time, eg "2021-04 09:15"
  detail: string;
}

// Watts and dollars run into the billions, so equality checks need a relative slack rather than
// an absolute one. Cash is separately rounded to whole dollars every tick.
const RELATIVE_TOLERANCE = 1e-6;
const CASH_ROUNDING_TOLERANCE = 2;
const MAX_VIOLATIONS_PER_RULE = 5;

// Tick fields that should always hold a real, finite number
const FINITE_TICK_FIELDS: TickFieldType[] = [
  "supplyW",
  "demandW",
  "solarIrradianceWM2",
  "windKph",
  "temperatureC",
  "storedWh",
  "precipitationMm",
  "snowpackMm",
  "hydroRunoffMm",
  "hydroReservoirWh",
  "hydroReservoirCapacityWh",
  "hydroSpillWh",
  "hydroMandatedReleaseW",
  "storageLossWh",
  "cash",
  "customers",
  "customerRate",
  "netWorth",
  "revenue",
  "expensesFuel",
  "expensesOM",
  "expensesCarbonFee",
  "expensesInterest",
  "kgco2e",
  "interestRate",
  "inflationRate",
];

// Tick fields that are physically incapable of going negative (cash and netWorth can, by design)
const NON_NEGATIVE_TICK_FIELDS: TickFieldType[] = [
  "supplyW",
  "demandW",
  "solarIrradianceWM2",
  "windKph",
  "storedWh",
  "precipitationMm",
  "snowpackMm",
  "hydroRunoffMm",
  "hydroReservoirWh",
  "hydroReservoirCapacityWh",
  "hydroSpillWh",
  "hydroMandatedReleaseW",
  "storageLossWh",
  "customers",
  "revenue",
  "expensesFuel",
  "expensesOM",
  "expensesCarbonFee",
  "expensesInterest",
  "kgco2e",
  // A lender can quote any rate it likes, but never a negative one
  "interestRate",
];

const FINITE_MONTH_FIELDS: MonthFieldType[] = [
  "supplyWh",
  "demandWh",
  "cash",
  "customers",
  "netWorth",
  "revenue",
  "expensesFuel",
  "expensesOM",
  "expensesCarbonFee",
  "expensesInterest",
  "kgco2e",
  "interestRate",
  "inflationRate",
];

/**
 * Collects invariant violations across a run, deduplicating by rule so that a systemically broken
 * value reports a handful of examples instead of one line per tick.
 */
export class InvariantCollector {
  private violations: ViolationType[] = [];
  private countByRule: { [rule: string]: number } = {};

  add(rule: string, when: string, detail: string) {
    this.countByRule[rule] = (this.countByRule[rule] || 0) + 1;
    if (this.countByRule[rule] <= MAX_VIOLATIONS_PER_RULE) {
      this.violations.push({ rule, when, detail });
    }
  }

  getViolations(): ViolationType[] {
    return this.violations;
  }

  // Total occurrences, including the ones suppressed after MAX_VIOLATIONS_PER_RULE
  getCountByRule(): { [rule: string]: number } {
    return this.countByRule;
  }

  getTotalCount(): number {
    return Object.values(this.countByRule).reduce((a, b) => a + b, 0);
  }
}

// A type predicate, so a value that passes is narrowed to number for the comparisons that
// follow rather than needing a cast at each one
function isFinite_(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

/**
 * Checks everything that must hold on a single simulated tick.
 * `prev` is the previous tick, or null across a month boundary / at the start of a run, where
 * continuity checks don't apply because the timeline is regenerated and pre-rolled.
 */
export function checkTick(
  collector: InvariantCollector,
  state: GameType,
  prev: TickPresentFutureType | null,
  now: TickPresentFutureType,
  when: string,
  builtThisTick: boolean,
) {
  FINITE_TICK_FIELDS.forEach((field) => {
    if (!isFinite_(now[field])) {
      collector.add("tick value is finite", when, `${field} = ${now[field]}`);
    }
  });

  NON_NEGATIVE_TICK_FIELDS.forEach((field) => {
    const value = now[field];
    if (isFinite_(value) && value < 0) {
      collector.add("tick value is non-negative", when, `${field} = ${value}`);
    }
  });

  if (isFinite_(now.demandW) && now.demandW <= 0) {
    collector.add(
      "demand is positive",
      when,
      `demandW = ${now.demandW} with ${now.customers} customers`,
    );
  }

  // supplyByFuel only accounts for generators; supplyW also includes storage discharge,
  // so the fuel breakdown can never exceed the total it is a breakdown of.
  let supplyByFuelTotal = 0;
  Object.keys(now.supplyByFuel || {}).forEach((fuel: string) => {
    const value = now.supplyByFuel[fuel];
    if (!isFinite_(value) || value < 0) {
      collector.add(
        "supplyByFuel is finite and non-negative",
        when,
        `${fuel} = ${value}`,
      );
      return;
    }
    supplyByFuelTotal += value;
  });
  if (
    isFinite_(now.supplyW) &&
    supplyByFuelTotal > now.supplyW * (1 + RELATIVE_TOLERANCE) + 1
  ) {
    collector.add(
      "supplyByFuel sums to at most supplyW",
      when,
      `supplyByFuel totals ${Math.round(supplyByFuelTotal)}W but supplyW is ${Math.round(now.supplyW)}W`,
    );
  }

  // Cash moves only by the tick's own revenue and expenses. Loan principal is spent but not
  // recorded on the tick, so the expected value is a range bounded by the outstanding payments.
  if (prev && !builtThisTick && isFinite_(now.cash) && isFinite_(prev.cash)) {
    const expenses =
      now.expensesFuel +
      now.expensesOM +
      now.expensesCarbonFee +
      now.expensesInterest;
    const maxPrincipal = state.facilities.reduce(
      (acc: number, f: FacilityOperatingType) =>
        acc +
        (f.loanAmountLeft > 0 ? f.loanMonthlyPayment / TICKS_PER_MONTH : 0),
      0,
    );
    const upperBound = prev.cash + now.revenue - expenses;
    const lowerBound = upperBound - maxPrincipal;
    if (
      now.cash > upperBound + CASH_ROUNDING_TOLERANCE ||
      now.cash < lowerBound - CASH_ROUNDING_TOLERANCE
    ) {
      collector.add(
        "cash changes only by recorded revenue and expenses",
        when,
        `cash went ${Math.round(prev.cash)} -> ${Math.round(now.cash)}, expected ${Math.round(lowerBound)}..${Math.round(upperBound)}`,
      );
    }
  }

  state.facilities.forEach((f: FacilityOperatingType) => {
    const label = `${f.name} #${f.id}`;
    if (!isFinite_(f.currentW)) {
      collector.add(
        "facility output is finite",
        when,
        `${label} currentW = ${f.currentW}`,
      );
    } else if (f.peakWh) {
      // Storage swings both ways: positive discharging, negative charging
      if (Math.abs(f.currentW) > f.peakW * (1 + RELATIVE_TOLERANCE)) {
        collector.add(
          "storage stays within its rated power",
          when,
          `${label} currentW = ${Math.round(f.currentW)} vs peakW ${Math.round(f.peakW)}`,
        );
      }
    } else if (
      f.currentW < 0 ||
      f.currentW > f.peakW * (1 + RELATIVE_TOLERANCE)
    ) {
      collector.add(
        "generator output stays within 0..peakW",
        when,
        `${label} currentW = ${Math.round(f.currentW)} vs peakW ${Math.round(f.peakW)}`,
      );
    }

    if (f.peakWh) {
      // peakWh is only on storage; the union is indexable, so this is the narrowing the
      // check above has already established
      const storage = f as StorageOperatingType;
      if (!isFinite_(storage.currentWh)) {
        collector.add(
          "storage charge is finite",
          when,
          `${label} currentWh = ${storage.currentWh}`,
        );
      } else if (
        storage.currentWh < 0 ||
        storage.currentWh > f.peakWh * (1 + RELATIVE_TOLERANCE)
      ) {
        collector.add(
          "storage charge stays within 0..peakWh",
          when,
          `${label} currentWh = ${Math.round(storage.currentWh)} vs peakWh ${Math.round(f.peakWh)}`,
        );
      }
    }

    if (f.fuel === "Hydro" && f.reservoirCapacityWh) {
      const reservoirWh = f.reservoirWh;
      if (!isFinite_(reservoirWh)) {
        collector.add(
          "hydro reservoir is finite",
          when,
          `${label} reservoirWh = ${reservoirWh}`,
        );
      } else if (
        reservoirWh < 0 ||
        reservoirWh > f.reservoirCapacityWh * (1 + RELATIVE_TOLERANCE)
      ) {
        collector.add(
          "hydro reservoir stays within 0..capacity",
          when,
          `${label} reservoirWh = ${Math.round(reservoirWh)} vs capacity ${Math.round(f.reservoirCapacityWh)}`,
        );
      }
    }

    if (f.yearsToBuildLeft < 0 || !isFinite_(f.yearsToBuildLeft)) {
      collector.add(
        "construction time remaining is non-negative",
        when,
        `${label} yearsToBuildLeft = ${f.yearsToBuildLeft}`,
      );
    }

    if (
      !isFinite_(f.loanAmountLeft) ||
      f.loanAmountLeft < -CASH_ROUNDING_TOLERANCE ||
      f.loanAmountLeft > f.loanAmountTotal * (1 + RELATIVE_TOLERANCE)
    ) {
      collector.add(
        "loan balance stays within 0..original",
        when,
        `${label} loanAmountLeft = ${Math.round(f.loanAmountLeft)} of ${Math.round(f.loanAmountTotal)}`,
      );
    }
  });

  if (prev) {
    checkStorageEnergyBalance(collector, state, prev, now, when);
    checkHydroEnergyBalance(collector, state, prev, now, when);
  }
}

export function checkMonth(
  collector: InvariantCollector,
  month: MonthlyHistoryType,
  when: string,
) {
  FINITE_MONTH_FIELDS.forEach((field) => {
    if (!isFinite_(month[field])) {
      collector.add(
        "monthly total is finite",
        when,
        `${field} = ${month[field]}`,
      );
    }
  });

  // summarizeTimeline books supply as min(supply, demand), so billed supply can never exceed demand
  if (
    isFinite_(month.supplyWh) &&
    isFinite_(month.demandWh) &&
    month.supplyWh > month.demandWh * (1 + RELATIVE_TOLERANCE)
  ) {
    collector.add(
      "monthly supply never exceeds demand",
      when,
      `supplyWh ${Math.round(month.supplyWh)} > demandWh ${Math.round(month.demandWh)}`,
    );
  }

  if (isFinite_(month.demandWh) && month.demandWh <= 0) {
    collector.add(
      "monthly demand is positive",
      when,
      `demandWh = ${month.demandWh}`,
    );
  }
}

/**
 * Storage can only hold energy that was charged into it. Charging is recorded as negative output
 * and discharging as positive, so the stored total has to move by exactly the fleet's net output
 * over one tick.
 *
 * Only checkable between consecutive ticks inside a month: a rollover runs the tick function five
 * more times (once for the new timeline, then four pre-roll frames) against the same tick object,
 * so the energy that moved in between is not observable from outside.
 */
function checkStorageEnergyBalance(
  collector: InvariantCollector,
  state: GameType,
  prev: TickPresentFutureType,
  now: TickPresentFutureType,
  when: string,
) {
  let netChargedWh = 0;
  let hasStorage = false;
  state.facilities.forEach((f: FacilityOperatingType) => {
    if (f.peakWh && isFinite_(f.currentW)) {
      hasStorage = true;
      netChargedWh -= f.currentW / TICKS_PER_HOUR; // Negative output is charging
    }
  });
  if (!hasStorage || !isFinite_(now.storedWh) || !isFinite_(prev.storedWh)) {
    return;
  }

  const actualDelta = now.storedWh - prev.storedWh;
  const expectedDelta = netChargedWh - now.storageLossWh;
  const tolerance =
    Math.max(Math.abs(expectedDelta), Math.abs(actualDelta)) *
      RELATIVE_TOLERANCE +
    1;
  if (Math.abs(actualDelta - expectedDelta) > tolerance) {
    collector.add(
      "stored energy moves by exactly what was charged or discharged",
      when,
      `storedWh moved ${Math.round(actualDelta)}Wh but charge minus losses was ${Math.round(expectedDelta)}Wh`,
    );
  }
}

function checkHydroEnergyBalance(
  collector: InvariantCollector,
  state: GameType,
  prev: TickPresentFutureType,
  now: TickPresentFutureType,
  when: string,
) {
  const hydro = state.facilities.filter(
    (f) => f.fuel === "Hydro" && f.yearsToBuildLeft === 0,
  );
  if (hydro.length === 0 || prev.hydroReservoirCapacityWh <= 0) {
    return;
  }
  const inflowWh = hydro.reduce(
    (total, f) => total + (f.hydroLastInflowWh || 0),
    0,
  );
  const bypassWh = hydro.reduce(
    (total, f) => total + (f.hydroLastBypassWh || 0),
    0,
  );
  // The tick's fuel breakdown is the authoritative delivered output. A paused generator retains
  // a ramping currentW internally but is deliberately excluded from supply, so summing facility
  // fields would charge its reservoir for electricity the grid never received.
  const generatedWh =
    ((now.supplyByFuel.Hydro || 0) / TICKS_PER_HOUR) * GAME_TO_REAL_YEARS;
  const expectedDelta = inflowWh - now.hydroSpillWh - bypassWh - generatedWh;
  const actualDelta = now.hydroReservoirWh - prev.hydroReservoirWh;
  const tolerance =
    Math.max(Math.abs(expectedDelta), Math.abs(actualDelta)) *
      RELATIVE_TOLERANCE +
    1;
  if (Math.abs(actualDelta - expectedDelta) > tolerance) {
    collector.add(
      "hydro inflow, generation, releases and spill balance the reservoir",
      when,
      `reservoir moved ${Math.round(actualDelta)}Wh but water balance was ${Math.round(expectedDelta)}Wh (in ${Math.round(inflowWh)}, generated ${Math.round(generatedWh)}, bypass ${Math.round(bypassWh)}, spill ${Math.round(now.hydroSpillWh)})`,
    );
  }
}
