import * as Economy from "../data/Economy";
import { loanBalanceAfterTicks, purchaseTerms } from "../helpers/Financials";
import { TICKS_PER_MONTH, TICK_MINUTES } from "../Constants";
import { GENERATORS } from "../data/Facilities";
import { runMonths } from "./SimulationTestHelpers";
import cloneDeep from "lodash.clonedeep";
import { serializeCommitmentMetadata } from "../helpers/Commitment";
import { createGame } from "./Simulator";
import reducer, {
  generateForecastTimeline,
  tickState,
  sellFacility,
  buildFacility,
  delta,
} from "../reducers/Game";
import { acquireUtility } from "../reducers/GameActions";
import { validUtilityExpansion } from "../helpers/ExpansionValidation";
import { acquisitionQuote } from "../helpers/Expansion";
import { territoryDemandShares } from "../helpers/Territories";
import { currentTick } from "../helpers/GameSelectors";
import { parseSave, serializeSave } from "../SaveGame";
import { encodeSave } from "../SaveEncoding";
import { accessContextForGame } from "../data/IntertieAccess";
import { inheritedConnection } from "../helpers/PowerAgreements";
import {
  intertieBuildQuote,
  intertieUpgradeQuote,
} from "../helpers/Transmission";
import type {
  GameType,
  TransmissionLineOperatingType,
  UtilityTargetId,
} from "../Types";
import { copyOfficialGame } from "./OfficialScenarioExecutionFixtures";
import { gameObjectiveResults } from "../helpers/ObjectiveRules";
import { getMissionStatus } from "../helpers/MissionStatus";

function ready(targetId: UtilityTargetId): GameType {
  const game = createGame({
    scenarioId: 116,
    seed: 12345,
    difficulty: "Employee",
  });
  currentTick(game)!.cash = 1e9;
  expect(acquisitionQuote(game, targetId)).toBeDefined();
  expect(game.transmission!.lines).toEqual([]);
  return game;
}

function legacyPortfolio(tier = 1, pendingUpgrade = false) {
  const game = ready("valley-electric");
  const context = accessContextForGame(game);
  const lines = ["vt-champlain-valley", "vt-champlain-ridge"].map(
    (corridorId, index): TransmissionLineOperatingType => {
      const quote = intertieBuildQuote(
        corridorId,
        game.date.year,
        tier,
        context,
      )!;
      expect(quote).toBeDefined();
      const terms = purchaseTerms(quote.buildCost, true, game.interestRate);
      currentTick(game)!.cash -= terms.amountDue;
      const line: TransmissionLineOperatingType = {
        ...quote,
        id: index + 2,
        corridorId,
        yearsToBuildLeft: 0,
        minuteCreated: 0,
        financed: true,
        loanAmountLeft: terms.loanAmount,
        loanMonthlyPayment: terms.monthlyPayment,
        interestRate: game.interestRate,
        currentFlowW: 0,
        paused: index === 1,
      };
      if (pendingUpgrade && index === 0) {
        const upgrade = intertieUpgradeQuote(
          line,
          game.date.year,
          1,
          1,
          context,
        )!;
        expect(upgrade).toBeDefined();
        const financing = purchaseTerms(
          upgrade.buildCost,
          true,
          game.interestRate,
          line.loanAmountLeft,
        );
        currentTick(game)!.cash -= financing.amountDue;
        line.buildCost += upgrade.buildCost;
        line.loanAmountLeft += financing.loanAmount;
        line.loanMonthlyPayment = financing.monthlyPayment;
        line.upgrade = {
          ...upgrade,
          yearsToBuildLeft: upgrade.yearsToBuild / 2,
          constructionKgco2eEmitted: upgrade.constructionKgco2eTotal / 2,
        };
      }
      return line;
    },
  );
  game.transmission!.lines = [inheritedConnection("champlain", 1), ...lines];
  const raw = JSON.parse(JSON.stringify(serializeSave(game)));
  raw.schemaVersion = 13;
  raw.game.territoryNetwork = { version: 1 };
  return raw;
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

function persisted(game: GameType): GameType {
  const save = serializeSave(game);
  const expected = JSON.parse(JSON.stringify(game));
  for (const payload of [save, encodeSave(save)]) {
    for (const wire of [payload, JSON.parse(JSON.stringify(payload))]) {
      const parsed = parseSave(wire);
      expect(parsed).not.toBeNull();
      expect(JSON.parse(JSON.stringify(parsed!.game))).toEqual(expected);
    }
  }
  return parseSave(JSON.parse(JSON.stringify(encodeSave(save))))!.game;
}

function expectRetainedInvestment(
  game: GameType,
  investment: TransmissionLineOperatingType,
): TransmissionLineOperatingType {
  const retained = game.territoryNetwork!.legacyConnections.find(
    (line) => line.id === investment.id,
  )!;
  expect(retained).toBeDefined();
  expect(retained).toEqual(investment);
  return retained;
}

it.each([1, 2, 3, 4])(
  "retains migrated Tier %i corridor investments when both utilities are acquired after reload",
  (tier) => {
    const raw = legacyPortfolio(tier);
    const original = cloneDeep(raw);
    const parsed = parseSave(raw);
    expect(parsed).not.toBeNull();
    expect(raw).toEqual(original);
    let game = persisted(parsed!.game);
    expect(game.territoryNetwork!.legacyConnections).toEqual(
      raw.game.transmission.lines,
    );
    for (const key of [
      "timeline",
      "monthlyHistory",
      "date",
      "utilityExpansion",
    ] as const)
      expect(game[key]).toEqual(raw.game[key]);
    expect(game.transmission!.lines).toEqual([]);
    const investments = cloneDeep(game.territoryNetwork!.legacyConnections);
    expect(investments.filter((line) => line.buildCost > 0)).toHaveLength(2);
    for (const [index, targetId] of (
      ["valley-electric", "ridge-electric"] as const
    ).entries()) {
      const quote = acquisitionQuote(game, targetId)!;
      const cash = currentTick(game)!.cash;
      const customers = currentTick(game)!.customers;
      const financed = index === 0;
      const minute = game.date.minute;
      game = copyOfficialGame(
        reducer(
          game,
          acquireUtility({ targetId, financed, quoteKey: quote.quoteKey }),
        ),
      );
      expect(currentTick(game)!.cash).toBeCloseTo(
        cash - (financed ? quote.financedCashDue : quote.cashDue),
        5,
      );
      expect(currentTick(game)!.customers).toBeCloseTo(
        customers + quote.customers,
        6,
      );
      expect(game.date.minute).toBe(minute);
      expect(
        territoryDemandShares(game, currentTick(game)!)[targetId],
      ).toBeGreaterThan(0);
      for (const investment of investments)
        expectRetainedInvestment(game, investment);
      expect(game.transmission!.lines).toEqual([]);
      game = persisted(game);
      const before = JSON.stringify(game);
      generateForecastTimeline(
        game,
        currentTick(game)!.cash,
        currentTick(game)!.customers,
        3,
      );
      expect(JSON.stringify(game)).toBe(before);
      const paid = investments[index + 1];
      for (const field of [
        "capacityW",
        "buildCost",
        "annualOperatingCost",
      ] as const) {
        const malformed = JSON.parse(JSON.stringify(serializeSave(game)));
        malformed.game.territoryNetwork.legacyConnections.find(
          (line: { id: number }) => line.id === paid.id,
        )[field] += 1;
        expect(parseSave(malformed)).toBeNull();
      }
    }
  },
);

it.each([0, 1])(
  "preserves a migrated paid pending upgrade acquired after %i elapsed ticks",
  (elapsed) => {
    const raw = legacyPortfolio(1, true);
    let game = parseSave(raw)!.game;
    expect(game.territoryNetwork!.legacyConnections).toEqual(
      raw.game.transmission.lines,
    );
    for (let tick = 0; tick < elapsed; tick++) tickState(game);
    game = persisted(game);
    const investment = cloneDeep(
      game.territoryNetwork!.legacyConnections.find(
        (line) => line.corridorId === "vt-champlain-valley",
      )!,
    );
    expect(investment.upgrade).toBeDefined();
    game = buy(game, "valley-electric");
    expectRetainedInvestment(game, investment);
    game = persisted(game);
    const resumed = persisted(game);
    const withoutArchive = cloneDeep(game);
    withoutArchive.territoryNetwork!.legacyConnections = [];
    for (let tick = 0; tick < 3; tick++) {
      tickState(game);
      tickState(resumed);
      tickState(withoutArchive);
      for (const field of [
        "supplyW",
        "availableSupplyW",
        "reserveW",
        "expensesOM",
      ] as const)
        expect(currentTick(game)![field]).toBe(
          currentTick(withoutArchive)![field],
        );
    }
    expect(persisted(resumed)).toEqual(JSON.parse(JSON.stringify(game)));
    const retained = game.territoryNetwork!.legacyConnections.find(
      (line) => line.id === investment.id,
    )!;
    expect({ ...retained, loanAmountLeft: investment.loanAmountLeft }).toEqual(
      investment,
    );
    expect(retained.loanAmountLeft).toBeLessThan(investment.loanAmountLeft);
    expect(retained.loanAmountLeft).toBeCloseTo(
      loanBalanceAfterTicks(
        investment.loanAmountLeft,
        investment.loanMonthlyPayment,
        investment.interestRate,
        3,
      ),
      6,
    );
    for (const field of [
      "targetCapacityW",
      "buildCost",
      "annualOperatingCost",
      "yearsToBuild",
      "yearsToBuildLeft",
      "constructionKgco2eTotal",
      "constructionKgco2eEmitted",
    ] as const) {
      const malformed = JSON.parse(JSON.stringify(serializeSave(game)));
      const upgrade = malformed.game.territoryNetwork.legacyConnections.find(
        (line: { id: number }) => line.id === investment.id,
      ).upgrade;
      upgrade[field] =
        field === "constructionKgco2eEmitted"
          ? upgrade.constructionKgco2eTotal + 1
          : upgrade[field] * 100;
      expect(parseSave(malformed)).toBeNull();
    }
  },
);

it.each<UtilityTargetId>(["valley-electric", "ridge-electric"])(
  "%s persists exact ownership, customers, debt and assets through save/resume",
  (targetId) => {
    let game = ready(targetId);
    expect(
      parseSave(JSON.parse(JSON.stringify(serializeSave(game)))),
    ).not.toBeNull();
    game = buy(game, targetId);
    expect(game.utilityExpansion!.networkAssets).toHaveLength(1);
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

it("forecast clones cannot mutate live ownership, cash, debts, program equipment or event history", () => {
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
  const asset = game.facilities.find((f) =>
    f.startingAssetId?.startsWith("scenario-116-ridge-"),
  )!;
  game = copyOfficialGame(reducer(game, sellFacility(asset.id)));
  expect(game.utilityExpansion!.loans).toEqual(debts);
  expect(
    game.utilityExpansion!.networkAssets.find(
      (a) => a.targetId === "ridge-electric",
    )!.initialValue,
  ).toBeGreaterThan(0);
});

it("rejects inconsistent or forged acquisition import ledgers", () => {
  const game = buy(parseSave(legacyPortfolio())!.game, "ridge-electric");
  const mutations: ((g: GameType) => void)[] = [
    (g) => {
      g.utilityExpansion!.networkAssets.push(
        cloneDeep(g.utilityExpansion!.networkAssets[0]),
      );
    },
    (g) => {
      g.utilityExpansion!.loans.pop();
    },
    (g) => {
      g.utilityExpansion!.loans[0].loanAmountLeft = 0;
    },
    (g) => {
      g.utilityExpansion!.acquisitions[0].transferredCustomers *= 2;
    },
    (g) => {
      g.utilityExpansion!.networkAssets[0].initialValue += 1e6;
    },
    (g) => {
      g.utilityExpansion!.networkAssets[0].retentionLowWatermark = 2;
    },
    (g) => {
      g.utilityExpansion!.acquisitions.push(
        cloneDeep(g.utilityExpansion!.acquisitions[0]),
      );
    },
    (g) => {
      Object.assign(g, { operatingAreaId: "champlain" });
    },
    (g) => {
      Object.assign(g.facilities[0], { operatingAreaId: "ridge-electric" });
    },
    (g) => {
      Object.assign(currentTick(g)!, { areaTicks: {} });
    },
    (g) => {
      g.customerMarketSize += 100;
    },
    (g) => {
      g.territoryNetwork!.legacyConnections.find(
        (line) => line.corridorId === "vt-champlain-ridge",
      )!.paused = "paused" as unknown as boolean;
    },
    (g) => {
      const line = g.territoryNetwork!.legacyConnections.find(
        (line) => line.corridorId === "vt-champlain-ridge",
      )!;
      line.currentFlowW = line.capacityW + 1;
    },
    (g) => {
      currentTick(g)!.customers = g.customerMarketSize * 1e6;
    },
    (g) => {
      currentTick(g)!.entitlementImportCapacityW = 1e12;
    },
    (g) => {
      currentTick(g)!.entitlementImportedW = 1e12;
    },
    (g) => {
      g.facilities.find(
        (f) => f.startingAssetId === "scenario-116-ridge-gas-cc",
      )!.peakW *= 2;
    },
    (g) => {
      g.facilities.find(
        (f) => f.startingAssetId === "scenario-116-ridge-gas-cc",
      )!.buildCost *= 2;
    },
    (g) => {
      g.facilities.find(
        (f) => f.startingAssetId === "scenario-116-ridge-gas-cc",
      )!.minuteOperational! += 15;
    },
  ];
  for (const mutate of mutations) {
    const raw = JSON.parse(JSON.stringify(serializeSave(game)));
    mutate(raw.game);
    expect(parseSave(raw)).toBeNull();
  }
  expect(gameObjectiveResults(game).map((o) => o.id)).toContain(
    "retain-customers",
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
  const accounts = cloneDeep(game.transmission!.agreementAccounts);
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
  expect(game.transmission!.agreementAccounts).toEqual(accounts);
  expect(roundtrip(game)).toEqual(JSON.parse(JSON.stringify(game)));
  expect(() => tickState(game)).not.toThrow();
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
        g.utilityExpansion!.networkAssets[0].initialValue += 1e6;
      },
      (g: GameType) => {
        g.facilities.find((facility) =>
          facility.startingAssetId?.startsWith("scenario-116-ridge-"),
        )!.peakW *= 2;
      },
      (g: GameType) => {
        g.facilities.find((facility) =>
          facility.startingAssetId?.startsWith("scenario-116-ridge-"),
        )!.buildCost *= 2;
      },
      (g: GameType) => {
        g.facilities.find((facility) =>
          facility.startingAssetId?.startsWith("scenario-116-ridge-"),
        )!.minuteOperational! += 15;
      },
      (g: GameType) => {
        const gas = g.facilities.find(
          (f) =>
            f.startingAssetId?.startsWith("scenario-116-ridge-") &&
            f.fuel === "Natural Gas",
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
    after.find((result) => result.metric === "customerRetention")!.status,
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
      (f) =>
        f.startingAssetId?.startsWith("scenario-116-ridge-") &&
        f.fuel === "Natural Gas",
    )!;
    expect(gas.resilience?.coldWeatherPackage).toBe(true);
    expect(gas.resilienceExtraBuildCost).toBe(147475);
    expect(roundtrip(game)).toEqual(JSON.parse(JSON.stringify(game)));
  },
);
