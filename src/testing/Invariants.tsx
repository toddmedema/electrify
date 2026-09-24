import { validHydroClaims } from "../data/HydroSites";
import {
  GAME_TO_REAL_YEARS,
  TICKS_PER_HOUR,
  TICKS_PER_MONTH,
} from "../Constants";
import {
  ConstructionEmissions,
  FacilityOperatingType,
  GameType,
  MonthlyHistoryType,
  StorageOperatingType,
  TickPresentFutureType,
} from "../Types";
import { effectiveMarket } from "../data/IntertieAccess";
import { STANDARD_GAS_DESIGN_MIN_TEMP_C } from "../data/Hazards";
import {
  COLD_DEFINITION_ID,
  HAIL_DEFINITION_ID,
  isWeatherHazardEligible,
} from "../helpers/Hazards";
import { MINUTES_PER_MONTH } from "../helpers/DateTime";
import {
  allocateIntertieFlows,
  neighborImportSupplyW,
  intertieImportLimitW,
  intertieContextForGame,
} from "../helpers/Transmission";

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
  "reserveW",
  "demandW",
  "solarIrradianceWM2",
  "windKph",
  "windAirborneKph",
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
  "storageChargeW",
  "storageDischargeW",
  "localKgco2e",
  "importedKgco2e",
  "constructionKgco2e",
  "importKgco2ePerMWh",
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
  "importedW",
  "exportedW",
  "transmissionCapacityW",
  "marketPricePerMWh",
  "revenueExports",
  "expensesImports",
];

// Tick fields that are physically incapable of going negative (cash and netWorth can, by design)
const NON_NEGATIVE_TICK_FIELDS: TickFieldType[] = [
  "supplyW",
  "demandW",
  "solarIrradianceWM2",
  "windKph",
  "windAirborneKph",
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
  "importedW",
  "exportedW",
  "transmissionCapacityW",
  "marketPricePerMWh",
  "revenueExports",
  "expensesImports",
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
  "revenueExports",
  "expensesImports",
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
  if (
    !Number.isFinite(now.expensesPolicy ?? 0) ||
    (now.expensesPolicy ?? 0) < 0
  ) {
    collector.add(
      "policy spending is finite and non-negative",
      when,
      `${now.expensesPolicy}`,
    );
  }
  if (state.policies) {
    Object.values(state.policies.programs).forEach((program) => {
      if (
        program.adoption < 0 ||
        program.adoption > 1 ||
        !Number.isFinite(program.adoption)
      ) {
        collector.add(
          "policy adoption is bounded",
          when,
          `${program.adoption}`,
        );
      }
    });
  }

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

  const emissionsTotal =
    (now.localKgco2e || 0) +
    (now.importedKgco2e || 0) +
    (now.constructionKgco2e || 0);
  if (
    Math.abs(now.kgco2e - emissionsTotal) >
    Math.max(1, emissionsTotal) * RELATIVE_TOLERANCE
  ) {
    collector.add(
      "local, purchased and construction emissions sum to total",
      when,
      `${now.kgco2e} vs ${emissionsTotal}`,
    );
  }

  // No project may emit more than it was quoted. This is the rule that matters: it bounds the
  // accrual from above whatever the clock does, and a runaway or double charge trips it on the
  // tick it happens. Its mirror -- that nothing accrues once everything is paid for -- cannot
  // be checked here, because the tick that finishes a project both settles the last of its
  // balance and zeroes it, so the charge and an empty balance are always seen together.
  let constructionOverpaid = 0;
  const trackConstruction = (asset: ConstructionEmissions) => {
    const total = asset.constructionKgco2eTotal || 0;
    const emitted = asset.constructionKgco2eEmitted || 0;
    if (emitted > total) constructionOverpaid += emitted - total;
  };
  state.facilities.forEach(trackConstruction);
  (state.transmission?.lines || []).forEach(trackConstruction);
  if (constructionOverpaid > 1e-6) {
    collector.add(
      "no project emits more than it was quoted to",
      when,
      `${constructionOverpaid} beyond the quoted totals`,
    );
  }

  // Fuel totals are gross generation; the local grid also includes storage and trade.
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
  const storageGridW = state.facilities.reduce(
    (sum, f) =>
      sum +
      (f.peakWh && !f.paused && f.yearsToBuildLeft === 0
        ? f.currentW < 0
          ? f.currentW / f.roundTripEfficiency
          : f.currentW
        : 0),
    0,
  );
  const expectedSupplyW =
    supplyByFuelTotal +
    storageGridW +
    (now.importedW || 0) -
    (now.exportedW || 0);
  if (
    isFinite_(now.supplyW) &&
    Math.abs(expectedSupplyW - now.supplyW) >
      Math.max(Math.abs(expectedSupplyW), Math.abs(now.supplyW)) *
        RELATIVE_TOLERANCE +
        1
  ) {
    collector.add(
      "generation, storage and trade balance supply",
      when,
      `expected ${Math.round(expectedSupplyW)}W but supplyW is ${Math.round(now.supplyW)}W`,
    );
  }

  checkTrade(collector, state, now, when);

  if (now.customerBillingRate !== undefined) {
    const billedRevenue =
      (((Math.min(now.supplyW, now.demandW) / TICKS_PER_HOUR) *
        GAME_TO_REAL_YEARS) /
        1000) *
        now.customerBillingRate +
      (now.revenueExports || 0);
    if (
      !isFinite_(now.customerBillingRate) ||
      now.customerBillingRate < 0 ||
      Math.abs(now.revenue - billedRevenue) >
        Math.max(1, Math.abs(billedRevenue) * RELATIVE_TOLERANCE)
    ) {
      collector.add(
        "revenue bills only delivered energy at the effective rate",
        when,
        `recorded revenue ${now.revenue}, delivered-energy bill ${billedRevenue}`,
      );
    }
  }

  // Cash moves only by the tick's own revenue and expenses. Loan principal is spent but not
  // recorded on the tick, so the expected value is a range bounded by the outstanding payments.
  if (prev && !builtThisTick && isFinite_(now.cash) && isFinite_(prev.cash)) {
    const expenses =
      now.expensesFuel +
      now.expensesOM +
      now.expensesCarbonFee +
      now.expensesInterest +
      (now.expensesImports || 0) +
      (now.expensesPolicy || 0);
    const maxPrincipal =
      state.facilities.reduce(
        (acc: number, f: FacilityOperatingType) =>
          acc +
          (f.loanAmountLeft > 0 ? f.loanMonthlyPayment / TICKS_PER_MONTH : 0),
        0,
      ) +
      (state.transmission?.lines || []).reduce(
        (acc, line) =>
          acc +
          (line.loanAmountLeft > 0
            ? line.loanMonthlyPayment / TICKS_PER_MONTH
            : 0),
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

  if (!validHydroClaims(state))
    collector.add(
      "Hydro sites remain unique, capacity-limited and historically claimed",
      when,
      "Invalid Hydro reservation or commissioned site claim",
    );

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
      const gridW =
        f.currentW < 0 ? f.currentW / f.roundTripEfficiency : f.currentW;
      if (Math.abs(gridW) > f.peakW * (1 + RELATIVE_TOLERANCE)) {
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

  (state.transmission?.lines || []).forEach((line) => {
    const label = `${line.name} #${line.id}`;
    if (!isFinite_(line.yearsToBuildLeft) || line.yearsToBuildLeft < 0) {
      collector.add(
        "transmission construction time remaining is non-negative",
        when,
        `${label} yearsToBuildLeft = ${line.yearsToBuildLeft}`,
      );
    }
    if (!isFinite_(line.loanAmountLeft) || line.loanAmountLeft < 0) {
      collector.add(
        "transmission loan balance is finite and non-negative",
        when,
        `${label} loanAmountLeft = ${line.loanAmountLeft}`,
      );
    }
  });

  if (prev) {
    checkStorageEnergyBalance(collector, state, prev, now, when);
    checkHydroEnergyBalance(collector, state, prev, now, when);
  }
}

/**
 * Trade stays within what the built lines and neighbours can carry, and is paid for exactly when it
 * flows. The import bound is an upper limit composed from the same helpers the reducer uses, so it
 * catches a flow that bypasses a neighbour's availability without restating how flows are split.
 */
function checkTrade(
  collector: InvariantCollector,
  state: GameType,
  now: TickPresentFutureType,
  when: string,
) {
  const importedW = now.importedW || 0;
  const exportedW = now.exportedW || 0;
  const capacityW = now.transmissionCapacityW || 0;
  if (importedW + exportedW > capacityW * (1 + RELATIVE_TOLERANCE) + 1) {
    collector.add(
      "trade stays within transmission capacity",
      when,
      `imported ${Math.round(importedW)}W + exported ${Math.round(exportedW)}W vs ${Math.round(capacityW)}W`,
    );
  }
  if (importedW > 0 && exportedW > 0) {
    collector.add(
      "a tick never imports and exports at once",
      when,
      `imported ${importedW}W and exported ${exportedW}W`,
    );
  }
  const importsFlow = importedW > 0;
  const importsPaid = (now.expensesImports || 0) > 0;
  if (importsFlow !== importsPaid) {
    collector.add(
      "imports are paid for exactly when they flow",
      when,
      `imported ${importedW}W, import expenses ${now.expensesImports}`,
    );
  }
  const exportsFlow = exportedW > 0;
  const exportsPaid = (now.revenueExports || 0) > 0;
  if (exportsFlow !== exportsPaid) {
    collector.add(
      "exports are paid for exactly when they flow",
      when,
      `exported ${exportedW}W, export revenue ${now.revenueExports}`,
    );
  }
  if (state.transmission && now.temperatureC !== undefined) {
    const context = intertieContextForGame(state);
    const conditions = {
      temperatureC: now.temperatureC,
      solarIrradianceWM2: now.solarIrradianceWM2 || 0,
    };
    const markets = new Map<
      string,
      { imported: number; exported: number; supply: number; demand: number }
    >();
    for (const line of state.transmission.lines.filter(
      (l) => l.yearsToBuildLeft <= 0,
    )) {
      const market = effectiveMarket(line.corridorId, context);
      if (!market) continue;
      const entry = markets.get(market.id) || {
        imported: 0,
        exported: 0,
        supply: neighborImportSupplyW(
          line.corridorId,
          context,
          now.minute,
          conditions,
        ),
        demand: market.availableDemandW,
      };
      entry.imported += Math.max(0, line.currentFlowW || 0);
      entry.exported += Math.max(0, -(line.currentFlowW || 0));
      markets.set(market.id, entry);
    }
    for (const [id, market] of markets) {
      if (
        market.imported > market.supply * (1 + RELATIVE_TOLERANCE) + 1 ||
        market.exported > market.demand * (1 + RELATIVE_TOLERANCE) + 1
      )
        collector.add(
          "each neighboring market has one shared trade budget",
          when,
          `${id}: imports ${market.imported}/${market.supply}W, exports ${market.exported}/${market.demand}W`,
        );
    }
  }
  if (importedW > 0 && state.transmission && now.temperatureC !== undefined) {
    const context = intertieContextForGame(state);
    const conditions = {
      temperatureC: now.temperatureC,
      solarIrradianceWM2: now.solarIrradianceWM2 || 0,
    };
    const offers = state.transmission.lines
      .filter(({ yearsToBuildLeft }) => yearsToBuildLeft <= 0)
      .map((line) => ({
        marketId: effectiveMarket(line.corridorId, context)?.id,
        marketImportLimitW: neighborImportSupplyW(
          line.corridorId,
          context,
          now.minute,
          conditions,
        ),
        importLimitW: intertieImportLimitW(
          line,
          context,
          now.minute,
          conditions,
        ),
        exportLimitW: 0,
        pricePerMWh: 0,
      }));
    const neighbourLimitW = allocateIntertieFlows(
      offers,
      Infinity,
      0,
    ).importedW.reduce((sum, w) => sum + w, 0);
    if (importedW > neighbourLimitW * (1 + RELATIVE_TOLERANCE) + 1) {
      collector.add(
        "imports stay within what neighbours can spare",
        when,
        `imported ${Math.round(importedW)}W vs ${Math.round(neighbourLimitW)}W available`,
      );
    }
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
 * Checks the weather hazards that started this month, right after the rollover that drew them:
 * every derate is a real reduction, each hail charge is its repair cost, hail only hits operating
 * solar and cold only derates gas plants rated warmer than the month's minimum.
 */
export function checkWeatherHazards(
  collector: InvariantCollector,
  state: GameType,
  when: string,
) {
  const monthStart = state.date.monthsElapsed * MINUTES_PER_MONTH;
  state.worldEvents.active.forEach((event) => {
    const hail = event.definitionId === HAIL_DEFINITION_ID;
    const cold = event.definitionId === COLD_DEFINITION_ID;
    if ((!hail && !cold) || event.startsMinute !== monthStart) return;
    if (!isWeatherHazardEligible(state, hail ? "HAIL" : "EXTREME_COLD")) {
      collector.add(
        "weather hazards only occur where eligible",
        when,
        `${event.key} in scenario ${state.scenarioId}`,
      );
    }
    Object.entries(event.effects.facilityOutputMultipliersById || {}).forEach(
      ([id, multiplier]) => {
        if (!isFinite_(multiplier) || multiplier <= 0 || multiplier > 1) {
          collector.add(
            "weather hazard derates stay within (0, 1]",
            when,
            `${event.key} facility ${id} multiplier ${multiplier}`,
          );
        }
        const facility = state.facilities.find((f) => String(f.id) === id);
        if (
          hail &&
          (facility?.fuel !== "Sun" || facility.yearsToBuildLeft > 0)
        ) {
          collector.add(
            "hail only damages operating solar",
            when,
            `${event.key} hit ${facility?.fuel ?? "missing"} facility ${id}`,
          );
        }
        if (cold) {
          const designMinTempC =
            facility?.resilience?.designMinTempC ??
            STANDARD_GAS_DESIGN_MIN_TEMP_C;
          if (
            facility?.fuel !== "Natural Gas" ||
            !(Number(event.attributes.minTempC) < designMinTempC)
          ) {
            collector.add(
              "cold only derates gas plants colder than their rating",
              when,
              `${event.key} derated ${facility?.fuel ?? "missing"} facility ${id} rated ${designMinTempC} at ${event.attributes.minTempC}`,
            );
          }
        }
      },
    );
    const gasMultiplier = event.effects.fuelPriceMultipliers?.["Natural Gas"];
    if (
      gasMultiplier !== undefined &&
      (!isFinite_(gasMultiplier) || gasMultiplier < 1)
    ) {
      collector.add(
        "cold gas price multipliers are finite and at least 1",
        when,
        `${event.key} ${gasMultiplier}`,
      );
    }
    if (hail) {
      const charge = event.attributes.oneTimeCost;
      const repairCost = event.attributes.repairCost;
      if (
        !isFinite_(charge) ||
        !isFinite_(repairCost) ||
        repairCost < 0 ||
        Math.abs(charge - repairCost) > repairCost * RELATIVE_TOLERANCE
      ) {
        collector.add(
          "hail charge equals the repair cost",
          when,
          `${event.key} charge ${charge} repair ${repairCost}`,
        );
      }
    }
  });
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
  const hasStorage = state.facilities.some(
    (f) => f.peakWh && f.yearsToBuildLeft === 0,
  );
  state.facilities.forEach((f: FacilityOperatingType) => {
    if (
      f.peakWh &&
      !f.paused &&
      f.yearsToBuildLeft === 0 &&
      isFinite_(f.currentW)
    ) {
      // Negative currentW is stored power; recover the grid draw before subtracting losses.
      netChargedWh -=
        (f.currentW < 0 ? f.currentW / f.roundTripEfficiency : f.currentW) /
        TICKS_PER_HOUR;
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
