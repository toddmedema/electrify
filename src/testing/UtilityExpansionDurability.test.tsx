import * as Economy from "../data/Economy";
import { loanBalanceAfterTicks } from "../helpers/Financials";
import { TICKS_PER_MONTH, TICK_MINUTES } from "../Constants";
import { GENERATORS } from "../data/Facilities";
import { runMonths } from "./SimulationTestHelpers";
import cloneDeep from "lodash.clonedeep";
import { serializeCommitmentMetadata } from "../helpers/Commitment";
import { createGame } from "./Simulator";
import reducer, {
  buildTransmissionLine,
  generateForecastTimeline,
  tickState,
  sellFacility,
  buildFacility,
  delta,
} from "../reducers/Game";
import { acquireUtility } from "../reducers/GameActions";
import { validUtilityExpansion } from "../helpers/ExpansionValidation";
import { acquisitionQuote } from "../helpers/Expansion";
import { currentTick } from "../helpers/GameSelectors";
import { parseSave, serializeSave } from "../SaveGame";
import type { GameType, UtilityTargetId } from "../Types";
import { copyOfficialGame } from "./OfficialScenarioExecutionFixtures";
import { gameObjectiveResults } from "../helpers/ObjectiveRules";
import { getMissionStatus } from "../helpers/MissionStatus";

function ready(targetId: UtilityTargetId): GameType {
  let game = createGame({
    scenarioId: 116,
    seed: 12345,
    difficulty: "Employee",
  });
  game = copyOfficialGame(
    reducer(
      game,
      buildTransmissionLine({
        corridorId:
          targetId === "valley-electric"
            ? "vt-champlain-valley"
            : "vt-champlain-ridge",
        financed: true,
      }),
    ),
  );
  // The boundary fixture starts at completed construction; long scenarios exercise actual elapsed construction.
  game.transmission!.lines[0].yearsToBuildLeft = 0;
  currentTick(game)!.cash = 1e9;
  return game;
}
function buy(game: GameType, targetId: UtilityTargetId): GameType {
  const quote = acquisitionQuote(game, targetId);
  expect(quote).toBeDefined();
  return copyOfficialGame(
    reducer(
      game,
      acquireUtility({ targetId, financed: true, quoteKey: quote!.quoteKey }),
    ),
  );
}
function roundtrip(game: GameType): GameType {
  expect(validUtilityExpansion(game)).toBe(true);
  const raw = JSON.parse(JSON.stringify(serializeSave(game)));
  const saved = parseSave(raw);
  expect(saved).not.toBeNull();
  return saved!.game;
}

it.each<UtilityTargetId>(["valley-electric", "ridge-electric"])(
  "%s persists exact ownership, cohorts, debt and assets through save/resume",
  (targetId) => {
    let game = ready(targetId);
    expect(
      parseSave(JSON.parse(JSON.stringify(serializeSave(game)))),
    ).not.toBeNull();
    game = buy(game, targetId);
    expect(game.utilityExpansion!.areas).toHaveLength(2);
    expect(game.utilityExpansion!.loans).toHaveLength(2);
    expect(roundtrip(game)).toEqual(JSON.parse(JSON.stringify(game)));
    const resumed = roundtrip(game);
    for (let i = 0; i < 8; i++) {
      tickState(game);
      tickState(resumed);
    }
    expect(
      JSON.stringify(serializeSave(resumed).game) ===
        JSON.stringify(serializeSave(game).game),
    ).toBe(true);
  },
);

it("rejects duplicate ownership and stale terms atomically through the owning action", () => {
  let game = ready("ridge-electric");
  const quote = acquisitionQuote(game, "ridge-electric")!;
  const action = acquireUtility({
    targetId: "ridge-electric",
    financed: true,
    quoteKey: quote.quoteKey,
  });
  game = copyOfficialGame(reducer(game, action));
  expect(reducer(game, action)).toBe(game);
  const before = ready("valley-electric");
  const stale = acquisitionQuote(before, "valley-electric")!;
  tickState(before);
  expect(
    reducer(
      before,
      acquireUtility({
        targetId: "valley-electric",
        financed: true,
        quoteKey: stale.quoteKey,
      }),
    ),
  ).toBe(before);
});

it("forecast clones cannot mutate live ownership, cash, debts, policy cohorts or event history", () => {
  const game = buy(ready("ridge-electric"), "ridge-electric");
  const before = JSON.stringify(game);
  const commitmentBefore = JSON.stringify(
    serializeCommitmentMetadata(game.timeline),
  );
  generateForecastTimeline(
    game,
    currentTick(game)!.cash,
    currentTick(game)!.customers,
    48,
  );
  expect(JSON.stringify(game)).toBe(before);
  expect(JSON.stringify(serializeCommitmentMetadata(game.timeline))).toBe(
    commitmentBefore,
  );
});

it("corporate loans survive plant sales and opening asset equity is not counted twice", () => {
  let game = buy(ready("ridge-electric"), "ridge-electric");
  const debts = cloneDeep(game.utilityExpansion!.loans);
  const asset = game.facilities.find(
    (f) => f.operatingAreaId === "ridge-electric",
  )!;
  game = copyOfficialGame(reducer(game, sellFacility(asset.id)));
  expect(game.utilityExpansion!.loans).toEqual(debts);
  expect(
    game.utilityExpansion!.areas.find((a) => a.id === "ridge-electric")!
      .networkInitialValue,
  ).toBeGreaterThan(0);
});

it("rejects inconsistent or forged acquisition import ledgers", () => {
  const game = buy(ready("ridge-electric"), "ridge-electric");
  const mutations: ((g: GameType) => void)[] = [
    (g) => {
      g.utilityExpansion!.areas.push(cloneDeep(g.utilityExpansion!.areas[1]));
    },
    (g) => {
      g.utilityExpansion!.loans.pop();
    },
    (g) => {
      g.utilityExpansion!.loans[0].loanAmountLeft = 0;
    },
    (g) => {
      g.utilityExpansion!.areas[1].transferredCustomers *= 2;
    },
    (g) => {
      g.utilityExpansion!.areas[1].networkInitialValue += 1e6;
    },
    (g) => {
      g.utilityExpansion!.areas[1].retentionLowWatermark = 2;
    },
    (g) => {
      g.facilities.find(
        (f) => f.operatingAreaId === "ridge-electric",
      )!.operatingAreaId = "valley-electric";
    },
    (g) => {
      g.operatingAreaId = "champlain";
    },
    (g) => {
      g.utilityExpansion!.areas[1].customers += 100;
    },
    (g) => {
      currentTick(g)!.customers += 100;
    },
    (g) => {
      currentTick(g)!.areaTicks!["ridge-electric"]!.entitlementImportCapacityW =
        1e12;
    },
    (g) => {
      currentTick(g)!.areaTicks!["ridge-electric"]!.entitlementImportedW = 1e12;
    },
    (g) => {
      g.facilities.find((f) => f.operatingAreaId === "ridge-electric")!.peakW *=
        2;
    },
    (g) => {
      g.facilities.find(
        (f) => f.operatingAreaId === "ridge-electric",
      )!.buildCost *= 2;
    },
    (g) => {
      g.facilities.find(
        (f) => f.operatingAreaId === "ridge-electric",
      )!.minuteOperational! += 15;
    },
  ];
  for (const mutate of mutations) {
    const raw = JSON.parse(JSON.stringify(serializeSave(game)));
    mutate(raw.game);
    expect(parseSave(raw)).toBeNull();
  }
  expect(gameObjectiveResults(game).map((o) => o.id)).toContain(
    "retain-each-area",
  );
});

it("acquisition preserves settled history and reforecasting cannot repay corporate loans again", () => {
  let game = ready("valley-electric");
  runMonths(game, 2);
  for (let i = 0; i < 4; i++) tickState(game);
  const history = cloneDeep(game.monthlyHistory);
  const settled = JSON.parse(
    JSON.stringify(
      game.timeline.filter((tick) => tick.minute < game.date.minute),
    ),
  );
  const settledCommitment = JSON.stringify(
    serializeCommitmentMetadata(
      game.timeline.filter((tick) => tick.minute < game.date.minute),
    ),
  );
  game = buy(game, "valley-electric");
  expect(game.monthlyHistory).toEqual(history);
  expect(
    JSON.parse(
      JSON.stringify(
        game.timeline.filter((tick) => tick.minute < game.date.minute),
      ),
    ),
  ).toEqual(settled);
  expect(
    JSON.stringify(
      serializeCommitmentMetadata(
        game.timeline.filter((tick) => tick.minute < game.date.minute),
      ),
    ),
  ).toBe(settledCommitment);
  const debts = cloneDeep(game.utilityExpansion!.loans);
  expect(debts.every((loan) => loan.loanAmountLeft === loan.principal)).toBe(
    true,
  );
  const now = currentTick(game)!;
  generateForecastTimeline(game, now.cash, now.customers);
  game = copyOfficialGame(reducer(game, delta({ dollarsPerkWh: 0.11 })));
  const solar = GENERATORS(
    game,
    1e6,
    game.timeline.map((tick) => tick.windKph),
    game.timeline.map((tick) => tick.solarIrradianceWM2),
  ).find((facility) => facility.available && facility.name === "Solar")!;
  expect(solar).toBeDefined();
  game = copyOfficialGame(
    reducer(game, buildFacility({ facility: solar, financed: false })),
  );
  expect(game.utilityExpansion!.loans).toEqual(debts);
  expect(roundtrip(game)).toEqual(JSON.parse(JSON.stringify(game)));
});

it("month-boundary warmup cannot repeat corporate payments, cash transactions or stored-energy use", () => {
  const game = buy(ready("valley-electric"), "valley-electric");
  for (let tick = 0; tick < TICKS_PER_MONTH - 1; tick++) tickState(game);
  const closingFrame = game.timeline.at(-1)!;
  tickState(game);
  expect(game.date.monthsElapsed).toBe(1);
  expect(currentTick(game)!.cash).toBe(closingFrame.cash);
  for (const loan of game.utilityExpansion!.loans)
    expect(loan.loanAmountLeft).toBeCloseTo(
      loanBalanceAfterTicks(
        loan.principal,
        loan.loanMonthlyPayment,
        loan.interestRate,
        TICKS_PER_MONTH,
      ),
      2,
    );
  expect(
    game.facilities.reduce(
      (sum, facility) => sum + (facility.reservoirWh ?? 0),
      0,
    ),
  ).toBeCloseTo(closingFrame.hydroReservoirWh, 2);
  expect(roundtrip(game)).toEqual(JSON.parse(JSON.stringify(game)));
});

it("validates canonical acquired assets and network consideration before economic data loads", () => {
  let game = ready("ridge-electric");
  runMonths(game, 2);
  game = buy(game, "ridge-electric");
  const saved = JSON.parse(JSON.stringify(serializeSave(game)));
  expect(validUtilityExpansion(saved.game)).toBe(true);
  const unloaded = jest.spyOn(Economy, "hasEconomy").mockReturnValue(false);
  try {
    expect(validUtilityExpansion(saved.game)).toBe(true);
    expect(parseSave(saved)).not.toBeNull();
    for (const mutate of [
      (g: GameType) => {
        g.utilityExpansion!.areas[1].networkInitialValue += 1e6;
      },
      (g: GameType) => {
        g.facilities.find(
          (facility) => facility.operatingAreaId === "ridge-electric",
        )!.peakW *= 2;
      },
      (g: GameType) => {
        g.facilities.find(
          (facility) => facility.operatingAreaId === "ridge-electric",
        )!.buildCost *= 2;
      },
      (g: GameType) => {
        g.facilities.find(
          (facility) => facility.operatingAreaId === "ridge-electric",
        )!.minuteOperational! += 15;
      },
      (g: GameType) => {
        const gas = g.facilities.find(
          (f) =>
            f.operatingAreaId === "ridge-electric" && f.fuel === "Natural Gas",
        )!;
        gas.resilienceExtraBuildCost! += 1000;
      },
    ]) {
      const altered = JSON.parse(JSON.stringify(saved));
      mutate(altered.game);
      expect(parseSave(altered)).toBeNull();
    }
  } finally {
    unloaded.mockRestore();
  }
});

it("acknowledges ownership immediately without inventing completed-month history", () => {
  let game = ready("ridge-electric");
  const before = gameObjectiveResults(game);
  expect(
    before.find((result) => result.metric === "utilityOwnership")!.status,
  ).toBe("pending");
  const history = JSON.stringify(game.monthlyHistory);
  const completed = game.objectiveProgress!.completedMonths;
  game = buy(game, "ridge-electric");
  const after = gameObjectiveResults(game);
  expect(
    after.find((result) => result.metric === "utilityOwnership")!.status,
  ).toBe("completed");
  expect(
    after.find((result) => result.metric === "cohortRetention")!.status,
  ).toBe("pending");
  expect(getMissionStatus(game).headline!.id).toBe("retire-champlain-oil");
  expect(JSON.stringify(game.monthlyHistory)).toBe(history);
  expect(game.objectiveProgress!.completedMonths).toBe(completed);
});

it("projected corporate debt advances only for future elapsed ticks, with real payments unchanged", () => {
  const game = buy(ready("valley-electric"), "valley-electric");
  const initial = cloneDeep(game.utilityExpansion!.loans);
  const now = currentTick(game)!;
  const balances: number[][] = [];
  generateForecastTimeline(
    game,
    now.cash,
    now.customers,
    3,
    TICK_MINUTES,
    (forecast) =>
      balances.push(
        forecast.utilityExpansion!.loans.map((loan) => loan.loanAmountLeft),
      ),
  );
  expect(balances).toHaveLength(3);
  expect(balances[0]).toEqual(initial.map((loan) => loan.loanAmountLeft));
  expect(game.utilityExpansion!.loans).toEqual(initial);
  for (let step = 1; step < balances.length; step++) {
    tickState(game);
    game.utilityExpansion!.loans.forEach((loan, index) => {
      expect(balances[step][index]).toBeCloseTo(loan.loanAmountLeft, 6);
      expect(loan.loanAmountLeft).toBeCloseTo(
        loanBalanceAfterTicks(
          initial[index].principal,
          initial[index].loanMonthlyPayment,
          initial[index].interestRate,
          step,
        ),
        2,
      );
    });
  }
});

it.each(["storyEffectsDisabled", "weatherHazardsDisabled"] as const)(
  "seller equipment preserves authored cold protection with buyer %s",
  (flag) => {
    const opening = copyOfficialGame(
      reducer(ready("ridge-electric"), delta({ [flag]: true })),
    );
    const game = buy(opening, "ridge-electric");
    const gas = game.facilities.find(
      (f) => f.operatingAreaId === "ridge-electric" && f.fuel === "Natural Gas",
    )!;
    expect(gas.resilience?.coldWeatherPackage).toBe(true);
    expect(gas.resilienceExtraBuildCost).toBe(147475);
    expect(roundtrip(game)).toEqual(JSON.parse(JSON.stringify(game)));
  },
);
