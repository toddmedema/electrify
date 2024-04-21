import { createSlice, PayloadAction } from "@reduxjs/toolkit";
import numbro from "numbro";
import { submitHighscore } from "./User";
import {
  getDateFromMinute,
  getTimeFromTimeline,
  summarizeHistory,
  summarizeTimeline,
  getSunriseSunset,
} from "../helpers/DateTime";
import {
  customersFromMarketingSpend,
  facilityCashBack,
  getMonthlyPayment,
  getPaymentInterest,
} from "../helpers/Financials";
import {
  formatMoneyConcise,
  formatWatts,
  formatWattHours,
} from "../helpers/Format";
import { arrayMove } from "../helpers/Math";
import { getSolarOutputFactor, getWindOutputFactor } from "../helpers/Energy";
import { getFuelPricesPerMBTU } from "../data/FuelPrices";
import { getWeather, getRawSolarIrradianceWM2 } from "../data/Weather";
import { dialogOpen, dialogClose, snackbarOpen } from "./UI";
import {
  DIFFICULTIES,
  DOWNPAYMENT_PERCENT,
  FUELS,
  GAME_TO_REAL_YEARS,
  GENERATOR_SELL_MULTIPLIER,
  INTEREST_RATE_YEARLY,
  LOAN_MONTHS,
  ORGANIC_GROWTH_MAX_ANNUAL,
  RESERVE_MARGIN,
  TICK_MINUTES,
  TICK_MS,
  TICKS_PER_DAY,
  TICKS_PER_HOUR,
  TICKS_PER_MONTH,
  TICKS_PER_YEAR,
  YEARS_PER_TICK,
  OUTSKIRTS_WIND_MULTIPLIER,
  LOCATIONS,
} from "../Constants";
import { GENERATORS, STORAGE } from "../Facilities";
import { logEvent } from "../Globals";
import { getStorageJson, setStorageKeyValue } from "../LocalStorage";
import { SCENARIOS } from "../Scenarios";
import { store } from "../Store";
import {
  DateType,
  FacilityOperatingType,
  FacilityShoppingType,
  LocationType,
  GameType,
  GeneratorOperatingType,
  LocalStoragePlayedType,
  MonthlyHistoryType,
  SpeedType,
  StorageOperatingType,
  TickPresentFutureType,
} from "../Types";
const cloneDeep = require("lodash.clonedeep");

interface BuildFacilityAction {
  facility: FacilityShoppingType;
  financed: boolean;
}

interface ReprioritizeFacilityAction {
  spotInList: number;
  delta: number;
}

interface NewGameAction {
  facilities: Array<Partial<FacilityShoppingType>>;
  cash: number;
  customers: number;
  location: LocationType;
}

let previousSpeed = "PAUSED" as SpeedType;
let previousMonth = "";
const initialGame: GameType = {
  scenarioId: 0,
  location: LOCATIONS["SF"],
  difficulty: "Employee",
  speed: "PAUSED",
  inGame: false,
  feePerKgCO2e: 0, // Start on easy mode
  monthlyMarketingSpend: 0,
  tutorialStep: -1, // Not set to 0 until after card transition, so that the target element exists
  facilities: [] as FacilityOperatingType[],
  startingYear: 2020,
  date: getDateFromMinute(0, 2020),
  timeline: [] as TickPresentFutureType[],
  monthlyHistory: [] as MonthlyHistoryType[],
};

export const gameSlice = createSlice({
  name: "game",
  initialState: initialGame,
  reducers: {
    tick: (state) => {
      if (!state.inGame) {
        return;
      }

      if (state.speed === "PAUSED") {
        setTimeout(
          () => store.dispatch(gameSlice.actions.tick()),
          TICK_MS.PAUSED
        );
        return;
      }

      state.date = getDateFromMinute(
        state.date.minute + TICK_MINUTES,
        state.startingYear
      );
      const now = getTimeFromTimeline(state.date.minute, state.timeline);
      const prev = getTimeFromTimeline(
        state.date.minute - TICK_MINUTES,
        state.timeline
      );
      if (now && prev) {
        updateSupplyFacilitiesFinances(state, prev, now);

        if (previousMonth !== state.date.month) {
          previousMonth = state.date.month;
          const history = state.monthlyHistory;
          const { cash, customers } = now;

          // Record final history for the month, then generate the new timeline
          history.unshift(
            summarizeTimeline(state.timeline, state.startingYear)
          );
          state.timeline = generateNewTimeline(state, cash, customers);

          // Pre-roll a few frames to compensate for temperature / demand jumps across months
          for (let i = 0; i < 4; i++) {
            updateSupplyFacilitiesFinances(
              state,
              state.timeline[0],
              state.timeline[0],
              true
            );
          }

          // ===== TRIGGERS ======
          // Failure: Bankrupt
          if (now.cash < 0) {
            logEvent("scenario_end", {
              id: state.scenarioId,
              type: "bankrupt",
              difficulty: state.difficulty,
            });
            const summary = summarizeHistory(history);
            setTimeout(
              () =>
                store.dispatch(
                  dialogOpen({
                    title: "Bankrupt!",
                    message: `You've run out of money.
                    You survived for ${store.getState().game.date.year - store.getState().game.startingYear} years,
                    earned ${formatMoneyConcise(summary.revenue)} in revenue
                    and emitted ${numbro(summary.kgco2e / 1000).format({ thousandSeparated: true, mantissa: 0 })} tons of pollution.`,
                    open: true,
                    notCancellable: true,
                    actionLabel: "Try again",
                    action: () => store.dispatch(gameSlice.actions.quit()),
                  })
                ),
              1
            );
          }

          // Failure: Too many blackouts
          if (
            history[1] &&
            history[2] &&
            history[3] &&
            history[1].supplyWh < history[1].demandWh * 0.9 &&
            history[2].supplyWh < history[2].demandWh * 0.9 &&
            history[3].supplyWh < history[3].demandWh * 0.9
          ) {
            logEvent("scenario_end", {
              id: state.scenarioId,
              type: "blackouts",
              difficulty: state.difficulty,
            });
            const summary = summarizeHistory(history);
            setTimeout(
              () =>
                store.dispatch(
                  dialogOpen({
                    title: "Fired!",
                    message: `You've allowed chronic blackouts for 3 months, causing shareholders to remove you from office.
                    You survived for ${store.getState().game.date.year - store.getState().game.startingYear} years,
                    earned ${formatMoneyConcise(summary.revenue)} in revenue
                    and emitted ${numbro(summary.kgco2e / 1000).format({ thousandSeparated: true, mantissa: 0 })} tons of pollution.`,
                    open: true,
                    notCancellable: true,
                    actionLabel: "Try again",
                    action: () => store.dispatch(gameSlice.actions.quit()),
                  })
                ),
              1
            );
          }

          const scenario =
            SCENARIOS.find((s) => s.id === state.scenarioId) || SCENARIOS[0];

          // Success: Survived duration
          if (
            state.date.monthsEllapsed === (scenario.durationMonths || 12 * 20)
          ) {
            const localStoragePlayed = (
              getStorageJson("plays", { plays: [] }) as any
            ).plays as LocalStoragePlayedType[];
            setStorageKeyValue("plays", {
              plays: [
                ...localStoragePlayed,
                {
                  scenarioId: state.scenarioId,
                  date: new Date().toString(),
                } as LocalStoragePlayedType,
              ],
            });

            // Calculate score - This is also described in the manual; if I update the algorithm, update the manual too!
            const summary = summarizeHistory(history);
            const blackoutsTWh =
              Math.max(0, summary.demandWh - summary.supplyWh) / 1000000000000;
            // Scoring algorithm should also be updated in Game.tsx
            const score =
              scenario.ownership === "Investor"
                ? {
                    supply: Math.round(summary.supplyWh / 1000000000000),
                    netWorth: Math.round((40 * summary.netWorth) / 1000000000),
                    customers: Math.round((2 * summary.customers) / 100000),
                    emissions: Math.round((-2 * summary.kgco2e) / 1000000000),
                    blackouts: Math.round(-8 * blackoutsTWh),
                  }
                : {
                    supply: Math.round((10 * summary.supplyWh) / 1000000000000),
                    emissions: Math.round((-5 * summary.kgco2e) / 1000000000),
                    blackouts: Math.round(-10 * blackoutsTWh),
                  };

            const finalScore = Object.values(score).reduce(
              (a: number, b: number) => a + b
            );
            const difficulty = state.difficulty; // pulling out of state for functions running inside of setTimeout

            if (!scenario.tutorialSteps) {
              setTimeout(
                () =>
                  store.dispatch(
                    submitHighscore({
                      score: finalScore,
                      scoreBreakdown: score, // For analytics purposes only
                      scenarioId: scenario.id,
                      difficulty,
                    })
                  ),
                1
              );
            }

            logEvent("scenario_end", {
              id: scenario.id,
              type: "win",
              difficulty,
              score: finalScore,
            });
            setTimeout(
              () =>
                store.dispatch(
                  dialogOpen({
                    title: scenario.endTitle || `You've retired!`,
                    message: scenario.endMessage || (
                      <div>
                        Your final score is {finalScore}:<br />
                        <br />+{score.supply} pts from electricity supplied
                        <br />
                        {scenario.ownership === "Investor" && (
                          <span>
                            +{score.netWorth} pts from final net worth
                            <br />
                          </span>
                        )}
                        {scenario.ownership === "Investor" && (
                          <span>
                            +{score.customers} pts from final customers
                            <br />
                          </span>
                        )}
                        {score.emissions} pts from emissions
                        <br />
                        {score.blackouts} pts from blackouts
                        <br />
                      </div>
                    ),
                    open: true,
                    closeText: "Keep playing",
                    actionLabel: "Return to menu",
                    action: () => store.dispatch(gameSlice.actions.quit()),
                  })
                ),
              1
            );
          }
        }
      }

      setTimeout(
        () => store.dispatch(gameSlice.actions.tick()),
        TICK_MS[state.speed]
      );
    },
    delta: (state, action: PayloadAction<Partial<GameType>>) => {
      return { ...state, ...action.payload };
    },
    start: (state, action: PayloadAction<number>) => {
      state.scenarioId = action.payload;
    },
    initGame: (state, action: PayloadAction<NewGameAction>) => {
      const a = action.payload;
      state.timeline = [] as TickPresentFutureType[];
      const scenario =
        SCENARIOS.find((s) => s.id === state.scenarioId) || SCENARIOS[0];
      state.date = getDateFromMinute(0, scenario.startingYear);
      state.startingYear = scenario.startingYear;
      state.feePerKgCO2e = scenario.feePerKgCO2e;
      state.location = a.location;
      state.timeline = generateNewTimeline(state, a.cash, a.customers);

      a.facilities.forEach((search: Partial<FacilityShoppingType>) => {
        const generator = GENERATORS(
          state,
          search.peakW || 1000000,
          [],
          []
        ).find((g: FacilityShoppingType) => {
          for (const property in search) {
            if (g[property] !== search[property]) {
              return false;
            }
          }
          return true;
        });
        if (generator) {
          state = buildFacilityHelper(state, generator, false, true);
        } else {
          const storage = STORAGE(state, search.peakWh || 1000000).find(
            (g: FacilityShoppingType) => {
              for (const property in search) {
                if (g[property] !== search[property]) {
                  return false;
                }
              }
              return true;
            }
          );
          if (storage) {
            state = buildFacilityHelper(state, storage, false, true);
          }
        }
      });

      // Pre-roll a few frames once we have weather and demand info so generators and batteries start in a more accurate state
      updateSupplyFacilitiesFinances(
        state,
        state.timeline[0],
        state.timeline[0],
        true
      );
      updateSupplyFacilitiesFinances(
        state,
        state.timeline[0],
        state.timeline[0],
        true
      );
      updateSupplyFacilitiesFinances(
        state,
        state.timeline[0],
        state.timeline[0],
        true
      );
      updateSupplyFacilitiesFinances(
        state,
        state.timeline[0],
        state.timeline[0],
        true
      );
      state.timeline = reforecastSupply(state);
    },
    quit: () => {
      return cloneDeep(initialGame);
    },
    buildFacility: (state, action: PayloadAction<BuildFacilityAction>) => {
      state = buildFacilityHelper(
        state,
        action.payload.facility,
        action.payload.financed
      );
      state = {
        ...state,
        timeline: reforecastSupply(state),
      };
    },
    sellFacility: (state, action: PayloadAction<number>) => {
      const id = action.payload; // (action as SellFacilityAction).id;
      // in one loop, refund cash from selling + remove from list
      state.facilities = state.facilities.filter(
        (g: GeneratorOperatingType | StorageOperatingType) => {
          if (g.id === id) {
            const now = getTimeFromTimeline(state.date.minute, state.timeline);
            if (now) {
              now.cash += facilityCashBack(g);
            }
            return false;
          }
          return true;
        }
      );
      state.timeline = reforecastSupply(state);
    },
    reprioritizeFacility: (
      state,
      action: PayloadAction<ReprioritizeFacilityAction>
    ) => {
      arrayMove(
        state.facilities,
        action.payload.spotInList,
        action.payload.spotInList + action.payload.delta
      );
      state.timeline = reforecastSupply(state);
    },
    loaded: (state) => {
      // Start ticking in game
      setTimeout(() => {
        return store.dispatch(gameSlice.actions.tick());
      }, TICK_MS.PAUSED);
      state.inGame = true;
    },
    setSpeed: (state, action: PayloadAction<SpeedType>) => {
      state.speed = action.payload;
    },
  },
  extraReducers: (builder) => {
    builder.addCase(dialogOpen, (state) => {
      previousSpeed = state.speed;
      state.speed = "PAUSED";
    });
    builder.addCase(dialogClose, (state) => {
      state.speed = previousSpeed;
    });
  },
});

export const {
  tick,
  delta,
  initGame,
  start,
  quit,
  buildFacility,
  sellFacility,
  reprioritizeFacility,
  loaded,
  setSpeed,
} = gameSlice.actions;

export default gameSlice.reducer;

// ====== HELPERS ======

// Simplified customer forecast, assumes no blackouts since supply calculation depends on demand (circular depedency)
function getDemandW(
  date: DateType,
  game: GameType,
  prev: TickPresentFutureType,
  now: TickPresentFutureType
) {
  const marketingGrowth =
    customersFromMarketingSpend(game.monthlyMarketingSpend) / TICKS_PER_MONTH;
  now.customers = Math.round(
    prev.customers * (1 + ORGANIC_GROWTH_MAX_ANNUAL / TICKS_PER_YEAR) +
      marketingGrowth
  );
  const { sunrise, sunset } = getSunriseSunset(
    date,
    game.location.lat,
    game.location.long
  );

  // https://www.eia.gov/todayinenergy/detail.php?id=830
  // https://www.e-education.psu.edu/ebf200/node/151
  // Demand estimation: http://www.iitk.ac.in/npsc/Papers/NPSC2016/1570293957.pdf
  // Pricing estimation: http://www.stat.cmu.edu/tr/tr817/tr817.pdf
  const temperatureNormalized =
    0.0035 * Math.pow(now.temperatureC, 2) - 0.035 * now.temperatureC;
  const minutesFromDarkNormalized =
    Math.min(date.minuteOfDay - sunrise, sunset - date.minuteOfDay) / 420;
  const minutesFromDarkLogistics =
    1 / (1 + Math.pow(Math.E, -minutesFromDarkNormalized * 6));
  const minutesFrom9amNormalized = Math.abs(date.minuteOfDay - 540) / 120;
  const minutesFrom9amLogistics =
    1 / (1 + Math.pow(Math.E, -minutesFrom9amNormalized * 2));
  const minutesFrom5pmNormalized = Math.abs(date.minuteOfDay - 1020) / 240;
  const minutesFrom5pmLogistics =
    1 / (1 + Math.pow(Math.E, -minutesFrom5pmNormalized * 2));
  const demandMultiple =
    430 +
    70 * temperatureNormalized -
    40 * minutesFrom9amLogistics +
    30 * minutesFromDarkLogistics -
    65 * minutesFrom5pmLogistics;
  return demandMultiple * now.customers;
}

function reforecastWeatherAndPrices(state: GameType): TickPresentFutureType[] {
  return state.timeline.map((t: TickPresentFutureType) => {
    if (t.minute >= state.date.minute) {
      const date = getDateFromMinute(t.minute, state.startingYear);
      const weather = getWeather(date);
      const fuelPrices = getFuelPricesPerMBTU(date);
      return {
        ...t,
        ...fuelPrices,
        solarIrradianceWM2: getRawSolarIrradianceWM2(
          date,
          state.location.lat,
          state.location.long,
          weather.CLOUD_PCT
        ),
        windKph: OUTSKIRTS_WIND_MULTIPLIER * weather.WIND_KPH,
        temperatureC: weather.TEMP_C,
      };
    }
    return t;
  });
}

function reforecastDemand(state: GameType): TickPresentFutureType[] {
  let prev = state.timeline[0];
  return state.timeline.map((t: TickPresentFutureType, i: number) => {
    if (t.minute >= state.date.minute) {
      const date = getDateFromMinute(t.minute, state.startingYear);
      t.demandW = getDemandW(date, state, prev, t);
      prev = t;
      return t;
    }
    return t;
  });
}

// Updates game state and now in place
function updateSupplyFacilitiesFinances(
  state: GameType,
  prev: TickPresentFutureType,
  now: TickPresentFutureType,
  simulated?: boolean
) {
  const { facilities, date } = state;
  const difficulty = DIFFICULTIES[state.difficulty];

  // Update facility construction status
  facilities.forEach((f: FacilityOperatingType) => {
    if (f.yearsToBuildLeft > 0) {
      f.yearsToBuildLeft = Math.max(0, f.yearsToBuildLeft - YEARS_PER_TICK);
      if (f.yearsToBuildLeft === 0 && !simulated) {
        const message = `Construction complete: ${f.name}, ${f.peakWh ? formatWattHours(f.peakWh) : formatWatts(f.peakW)}`; // defining for functions running inside of setTimeout
        setTimeout(() => {
          store.dispatch(snackbarOpen(message));
        }, 0);
      }
    }
  });

  const windOutputFactor = getWindOutputFactor(now.windKph);
  const solarOutputFactor = getSolarOutputFactor(
    now.solarIrradianceWM2,
    now.temperatureC
  );

  // Pre-check how much extra supply we'll need to charge batteries
  let indexOfLastUnchargedBattery = -1;
  let totalChargeNeeded = 0;
  facilities.forEach((g: FacilityOperatingType, i: number) => {
    if (g.peakWh && g.currentWh < g.peakWh && g.yearsToBuildLeft === 0) {
      indexOfLastUnchargedBattery = i;
      totalChargeNeeded += Math.min(
        g.peakW,
        (g.peakWh - g.currentWh) * TICKS_PER_HOUR
      );
    }
  });

  // Update supply and facility outputs
  let supply = 0;
  let charge = 0;
  facilities.forEach((g: FacilityOperatingType, i: number) => {
    if (g.yearsToBuildLeft === 0) {
      if (g.fuel) {
        // Capable of generating electricity
        const targetW = Math.max(
          0,
          now.demandW * (1 + RESERVE_MARGIN) - supply
        );
        switch (g.fuel) {
          case "Sun":
            g.currentW = g.peakW * solarOutputFactor;
            break;
          case "Wind":
            g.currentW = g.peakW * windOutputFactor;
            break;
          default: // on-demand produces up to demand + reserve margin
            if (targetW > g.currentW || i < indexOfLastUnchargedBattery) {
              // spinning up
              // If there's a battery to charge after me, output as much as possible to charge it beyond demand
              if (
                indexOfLastUnchargedBattery >= 0 &&
                i < indexOfLastUnchargedBattery
              ) {
                g.currentW = Math.min(
                  now.demandW + totalChargeNeeded - charge,
                  g.peakW,
                  g.currentW + (g.peakW * TICK_MINUTES) / g.spinMinutes
                );
              } else {
                // Otherwise just try to fulfill demand + reserve margin
                g.currentW = Math.min(
                  g.peakW,
                  targetW,
                  g.currentW + (g.peakW * TICK_MINUTES) / g.spinMinutes
                );
              }
            } else {
              g.currentW = Math.max(
                0,
                targetW,
                g.currentW - (g.peakW * TICK_MINUTES) / g.spinMinutes
              );
            }
            break;
        }
        supply += g.currentW;
      }
      if (g.peakWh) {
        // Capable of storing electricity
        const targetW = Math.max(0, now.demandW - supply);
        if (g.currentWh > 0 && targetW > 0) {
          // If there's a need and we have charge, discharge
          g.currentW = Math.min(g.peakW, targetW, g.currentWh * TICKS_PER_HOUR);
          g.currentWh = Math.max(0, g.currentWh - g.currentW / TICKS_PER_HOUR);
          supply += g.currentW;
        } else if (g.currentWh < g.peakWh && supply - charge > now.demandW) {
          // If there's spare capacity, charge
          g.currentW = -Math.min(
            g.peakW,
            supply - now.demandW - charge,
            (g.peakWh - g.currentWh) * TICKS_PER_HOUR
          );
          g.currentWh = Math.min(
            g.peakWh,
            g.currentWh - g.currentW / TICKS_PER_HOUR
          );
          charge -= g.currentW / g.roundTripEfficiency;
        } else {
          // Otherwise, don't charge or discharge: reset to 0
          g.currentW = 0;
        }
      }
    }
  });
  now.supplyW = supply;

  // Update finances
  // TODO actually calculate market price / sale value
  // Alternative: use rate by location, based on historic prices (not as fulfilling) - or at least use to double check
  const dollarsPerWh = 0.07 / 1000;
  const supplyWh =
    (Math.min(now.supplyW, now.demandW) / TICKS_PER_HOUR) * GAME_TO_REAL_YEARS; // Output-dependent #'s converted to real months, since we don't simulate every day
  const demandWh = (now.demandW / TICKS_PER_HOUR) * GAME_TO_REAL_YEARS; // Output-dependent #'s converted to real months, since we don't simulate every day
  const revenue = supplyWh * dollarsPerWh;

  // Facilities expenses
  let kgco2e = 0;
  let expensesOM = 0;
  let expensesFuel = 0;
  let expensesInterest = 0;
  let principalRepayment = 0;
  facilities.forEach((g: FacilityShoppingType) => {
    if (g.yearsToBuildLeft === 0) {
      expensesOM += g.annualOperatingCost / TICKS_PER_YEAR;
      if (g.fuel && FUELS[g.fuel]) {
        const fuelBtu =
          ((g.currentW * (g.btuPerWh || 0)) / TICKS_PER_HOUR) *
          GAME_TO_REAL_YEARS; // Output-dependent #'s converted to real months, since we don't simulate every day
        expensesFuel +=
          (fuelBtu * getFuelPricesPerMBTU(date)[g.fuel]) / 1000000;
        kgco2e += fuelBtu * FUELS[g.fuel].kgCO2ePerBtu;
      }
      if (g.loanAmountLeft > 0) {
        const paymentInterest = getPaymentInterest(
          g.loanAmountLeft,
          INTEREST_RATE_YEARLY,
          g.loanMonthlyPayment
        );
        const paymentPrincipal = g.loanMonthlyPayment - paymentInterest;
        expensesInterest += paymentInterest / TICKS_PER_MONTH;
        principalRepayment += paymentPrincipal / TICKS_PER_MONTH;
        g.loanAmountLeft -= paymentPrincipal / TICKS_PER_MONTH;
      }
    } else {
      expensesInterest +=
        getPaymentInterest(
          g.loanAmountLeft,
          INTEREST_RATE_YEARLY,
          g.loanMonthlyPayment
        ) / TICKS_PER_MONTH;
    }
  });
  const expensesCarbonFee = state.feePerKgCO2e * kgco2e;
  const expensesMarketing = state.monthlyMarketingSpend / TICKS_PER_MONTH;

  // Customers
  const percentDemandUnfulfilled = (demandWh - supplyWh) / demandWh;
  const organicGrowthRate =
    ORGANIC_GROWTH_MAX_ANNUAL -
    difficulty.blackoutPenalty * percentDemandUnfulfilled;
  const marketingGrowth =
    customersFromMarketingSpend(state.monthlyMarketingSpend) / TICKS_PER_MONTH;

  // Save new financial info
  now.customers = Math.round(
    prev.customers * (1 + organicGrowthRate / TICKS_PER_YEAR) + marketingGrowth
  );
  now.cash = Math.round(
    prev.cash +
      revenue -
      expensesOM -
      expensesFuel -
      expensesCarbonFee -
      expensesInterest -
      expensesMarketing -
      principalRepayment
  );
  now.netWorth = getNetWorth(facilities, now.cash);
  now.revenue = revenue;
  now.expensesOM = expensesOM;
  now.expensesFuel = expensesFuel;
  now.expensesCarbonFee = expensesCarbonFee;
  now.expensesInterest = expensesInterest;
  now.expensesMarketing = expensesMarketing;
  now.kgco2e = kgco2e;

  return now;
}

function reforecastSupply(
  state: GameType,
  simulated?: boolean
): TickPresentFutureType[] {
  // Make temporary deep copy so that it can be revised in place
  const newState = { ...state };
  let prev = newState.timeline[0];
  return newState.timeline.map((t: TickPresentFutureType) => {
    if (t.minute >= state.date.minute) {
      t = updateSupplyFacilitiesFinances(newState, prev, { ...t }, simulated);
    }
    prev = t;
    return t;
  });
}

export function generateNewTimeline(
  readOnlyState: GameType,
  cash: number,
  customers: number,
  ticks = TICKS_PER_DAY
): TickPresentFutureType[] {
  // TODO performance optimization, figure out how to deep clone everything EXCEPT timeline, since I'm about to overwrite it
  const state = cloneDeep(readOnlyState);
  state.timeline = new Array(ticks) as TickPresentFutureType[];
  for (let i = 0; i < ticks; i++) {
    state.timeline[i] = {
      minute: state.date.minute + i * TICK_MINUTES,
      supplyW: 0,
      demandW: 0,
      solarIrradianceWM2: 0,
      windKph: 0,
      temperatureC: 0,
      cash,
      customers,
      netWorth: getNetWorth(state.facilities, cash),
      revenue: 0,
      expensesFuel: 0,
      expensesOM: 0,
      expensesCarbonFee: 0,
      expensesInterest: 0,
      expensesMarketing: 0,
      kgco2e: 0,
    };
  }
  state.timeline = reforecastWeatherAndPrices(state);
  state.timeline = reforecastDemand(state);
  state.timeline = reforecastSupply(state, true);
  return state.timeline;
}

/**
 * Edits the state in place to handle all of the one-off consequences of building
 * (not including reforecasting, which should be done once after multiple builds)
 * @param state
 * @param g
 * @param financed
 * @param newGame
 * @returns
 */
function buildFacilityHelper(
  state: GameType,
  g: FacilityShoppingType,
  financed: boolean,
  newGame = false
): GameType {
  const now = getTimeFromTimeline(state.date.minute, state.timeline);

  if (now) {
    let financing = {
      loanAmountTotal: 0,
      loanAmountLeft: 0,
      loanMonthlyPayment: 0,
    };
    if (newGame) {
      // Don't charge anything for initial builds
    } else if (financed) {
      const downpayment = g.buildCost * DOWNPAYMENT_PERCENT;
      now.cash -= downpayment;
      const loanAmount = g.buildCost - downpayment;
      financing = {
        loanAmountTotal: loanAmount,
        loanAmountLeft: loanAmount,
        loanMonthlyPayment: getMonthlyPayment(
          loanAmount,
          INTEREST_RATE_YEARLY,
          LOAN_MONTHS
        ),
      };
    } else {
      // purchased in cash
      now.cash -= g.buildCost;
    }
    const facility = {
      ...g,
      ...financing,
      id:
        state.facilities.reduce(
          (max: number, f: FacilityOperatingType) => (max > f.id ? max : f.id),
          0
        ) + 1,
      currentW: newGame && g.peakWh === undefined ? g.peakW : 0,
      yearsToBuildLeft: newGame ? 0 : g.yearsToBuild,
      minuteCreated: state.date.minute,
    } as FacilityOperatingType;
    if (g.peakWh) {
      facility.currentWh = 0;
      state.facilities.push(facility); // add storage to bottom so that it's on by default
    } else {
      state.facilities.unshift(facility); // add generators to top so that they produce by default
    }
  }

  return state;
}

// TODO account for generator current value better - get rid of SELL_MULTIPLIER everywhere and depreciate buildCost over time
function getNetWorth(
  facilities: FacilityOperatingType[],
  cash: number
): number {
  let netWorth = cash;
  facilities.forEach((g: FacilityOperatingType) => {
    if (g.yearsToBuildLeft === 0) {
      netWorth += g.buildCost * GENERATOR_SELL_MULTIPLIER - g.loanAmountLeft;
    } else {
      netWorth += g.buildCost * DOWNPAYMENT_PERCENT;
    }
  });
  return netWorth;
}
