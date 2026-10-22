import type { RuleReport } from "../data/ScenarioRules";
import type { ActiveWorldEventType, MonthlyHistoryType } from "../Types";
import { EMPTY_HISTORY, MINUTES_PER_MONTH } from "./DateTime";
import {
  interpretRuleReport,
  RuleReportContext,
  RuleReportResult,
} from "./ScenarioRuleReports";

function month(
  index: number,
  patch: Partial<MonthlyHistoryType> = {},
): MonthlyHistoryType {
  return {
    ...EMPTY_HISTORY,
    year: 2020 + Math.floor(index / 12),
    month: (index % 12) + 1,
    supplyWh: 100,
    demandWh: 100,
    peakDemandW: 100,
    minimumSupplyMarginW: 0,
    cash: 1,
    deliveredWhByFuel: {},
    ...patch,
  };
}

function context(
  monthlyHistory: MonthlyHistoryType[],
  patch: Partial<RuleReportContext> = {},
): RuleReportContext {
  return { startingYear: 2020, completedMonths: 3, monthlyHistory, ...patch };
}

function metric(result: RuleReportResult, id: string) {
  const found = result.metrics.find((value) => value.id === id);
  expect(found).toBeDefined();
  return found!;
}

const reliability: RuleReport = {
  id: "reliability",
  kind: "reliability",
  fromMonth: 0,
  throughMonth: 2,
};

describe("recorded report windows", () => {
  it("includes both zero-based boundaries and uses summed energy, regardless of history order", () => {
    const history = [
      month(2, { demandWh: 800, supplyWh: 800 }),
      month(0, { demandWh: 100, supplyWh: 0 }),
      month(1, { demandWh: 100, supplyWh: 100 }),
      month(3, { demandWh: 100, supplyWh: 0 }),
    ];
    const result = interpretRuleReport(reliability, context(history));
    expect(result.available).toBe(true);
    expect(metric(result, "reliability").value).toBe(0.9);
    expect(metric(result, "unservedWh").value).toBe(100);
    expect(
      interpretRuleReport(reliability, context([...history].reverse())),
    ).toEqual(result);
  });

  it("can report exactly the first completed month and a final month across a year boundary", () => {
    expect(
      interpretRuleReport(
        { ...reliability, throughMonth: 0 },
        context([month(0)], { completedMonths: 1 }),
      ).available,
    ).toBe(true);
    const result = interpretRuleReport(
      { ...reliability, fromMonth: 11, throughMonth: 12 },
      context([month(12), month(11)], { completedMonths: 13 }),
    );
    expect(result.available).toBe(true);
    expect(metric(result, "reliability").value).toBe(1);
  });

  it.each([
    ["no observations", []],
    ["missing first month", [month(1), month(2)]],
    ["missing last month", [month(0), month(1)]],
    ["duplicate month", [month(0), month(1), month(1), month(2)]],
    ["invalid calendar month", [month(0), month(1), month(2, { month: 2.5 })]],
  ])("makes %s unavailable instead of implying success", (_, history) => {
    const result = interpretRuleReport(
      reliability,
      context(history as MonthlyHistoryType[]),
    );
    expect(result).toMatchObject({
      available: false,
      importance: "ROUTINE",
      turningPointPriority: 0,
      attributes: {},
    });
    expect(result.message).toContain("unavailable");
    expect(result.metrics).toEqual([]);
  });

  it("does not accept a forecast or an in-progress month as a completed observation", () => {
    const result = interpretRuleReport(
      reliability,
      context([month(0), month(1), month(2)], { completedMonths: 2 }),
    );
    expect(result.available).toBe(false);
    expect(result.reason).toContain("not completed");
  });

  it.each([
    { fromMonth: -1, throughMonth: 0 },
    { fromMonth: 1, throughMonth: 0 },
    { fromMonth: 0, throughMonth: 0.5 },
    { fromMonth: 0, throughMonth: 1200 },
  ])("rejects an invalid normalized window %p", (window) => {
    expect(
      interpretRuleReport({ ...reliability, ...window }, context([month(0)]))
        .available,
    ).toBe(false);
  });

  it("ignores observations outside the window, including duplicates", () => {
    const result = interpretRuleReport(
      { ...reliability, fromMonth: 1, throughMonth: 1 },
      context([month(0), month(0), month(1), month(2)]),
    );
    expect(result.available).toBe(true);
  });

  it("is serializable and does not modify input observations", () => {
    const rows = [month(2), month(0), month(1)];
    const before = JSON.stringify(rows);
    rows.forEach((row) => {
      Object.freeze(row.deliveredWhByFuel);
      Object.freeze(row);
    });
    Object.freeze(rows);
    const inputs = context(rows);
    const result = interpretRuleReport(reliability, inputs);
    expect(JSON.stringify(rows)).toBe(before);
    expect(JSON.parse(JSON.stringify(result))).toEqual(result);
    expect(
      interpretRuleReport(
        JSON.parse(JSON.stringify(reliability)),
        JSON.parse(JSON.stringify(inputs)),
      ),
    ).toEqual(result);
  });
});

describe("reliability feedback", () => {
  const report = { ...reliability, throughMonth: 0 };

  it.each([
    [999, "ROUTINE"],
    [998.999, "NOTABLE"],
    [1000, "ROUTINE"],
    [0, "NOTABLE"],
  ])(
    "classifies %s Wh served out of 1000 at the exact threshold",
    (supplyWh, importance) => {
      const result = interpretRuleReport(
        report,
        context([month(0, { demandWh: 1000, supplyWh })]),
      );
      expect(result.available).toBe(true);
      expect(result.importance).toBe(importance);
      expect(metric(result, "reliability").value).toBe(supplyWh / 1000);
    },
  );

  it("does not round a failed reliability threshold into an apparent pass", () => {
    const result = interpretRuleReport(
      report,
      context([month(0, { demandWh: 1000, supplyWh: 998.999 })]),
    );
    expect(result.importance).toBe("NOTABLE");
    expect(result.message).toContain("99.8999%");
  });

  it("supports a supplied reliability threshold and label", () => {
    const result = interpretRuleReport(
      { ...report, label: "Restoration review", minDemandServedShare: 0.9 },
      context([month(0, { supplyWh: 90 })]),
    );
    expect(result).toMatchObject({
      label: "Restoration review",
      importance: "ROUTINE",
      turningPointPriority: 90,
    });
  });

  it.each([
    { demandWh: 0, supplyWh: 0 },
    { demandWh: -1 },
    { supplyWh: Number.NaN },
    { supplyWh: Number.POSITIVE_INFINITY },
  ])("makes invalid or undefined energy ratios unavailable: %p", (patch) => {
    expect(
      interpretRuleReport(report, context([month(0, patch)])).available,
    ).toBe(false);
  });
});

describe("fuel mix feedback", () => {
  const report: RuleReport = {
    id: "mix",
    kind: "fuelMix",
    fromMonth: 0,
    throughMonth: 1,
    fuels: ["Coal", "Natural Gas"],
  };

  it("divides summed delivered energy instead of averaging monthly shares", () => {
    const result = interpretRuleReport(
      report,
      context([
        month(0, { deliveredWhByFuel: { Coal: 100 } }),
        month(1, { deliveredWhByFuel: { "Natural Gas": 100, Wind: 800 } }),
      ]),
    );
    expect(metric(result, "fuelShare").value).toBe(0.2);
    expect(result.attributes).toMatchObject({
      selectedWh: 200,
      denominatorWh: 1000,
      basis: "localGeneration",
    });
    expect(result.message).toContain("local fuel-delivered power");
  });

  it("can preserve customer-demand fuel reviews while excluding imported power from the numerator", () => {
    const rows = [
      month(0, { demandWh: 200, deliveredWhByFuel: { "Natural Gas": 100 } }),
      month(1, { demandWh: 800, deliveredWhByFuel: { Wind: 100 } }),
    ];
    const local = interpretRuleReport(report, context(rows));
    const demand = interpretRuleReport(
      { ...report, basis: "customerDemand" },
      context(rows),
    );
    expect(metric(local, "fuelShare").value).toBe(0.5);
    expect(metric(demand, "fuelShare").value).toBe(0.1);
    expect(demand.message).toContain("customer demand");
  });

  it("reports zero selected-fuel delivery as a meaningful zero", () => {
    const result = interpretRuleReport(
      report,
      context([
        month(0, { deliveredWhByFuel: { Wind: 50 } }),
        month(1, { deliveredWhByFuel: { Wind: 50 } }),
      ]),
    );
    expect(result.available).toBe(true);
    expect(metric(result, "fuelShare").value).toBe(0);
  });

  it.each([
    {},
    { Coal: Number.NaN },
    { Coal: -1 },
    { Coal: Number.MAX_VALUE, Wind: Number.MAX_VALUE },
  ])(
    "makes unavailable or invalid fuel totals unavailable: %p",
    (deliveredWhByFuel) => {
      expect(
        interpretRuleReport(
          report,
          context([month(0, { deliveredWhByFuel }), month(1)]),
        ).available,
      ).toBe(false);
    },
  );
});

describe("persisted affected-facility feedback", () => {
  const report: RuleReport = {
    id: "targets",
    kind: "affectedFacilities",
    eventId: "storm",
  };
  function occurrence(
    patch: Partial<ActiveWorldEventType> = {},
  ): ActiveWorldEventType {
    return {
      key: "mod:example:storm",
      definitionId: "storm",
      startsMinute: MINUTES_PER_MONTH,
      endsMinute: 2 * MINUTES_PER_MONTH,
      attributes: {
        selectedFacilityNames: ["Original coal plant", "Old turbine"],
      },
      effects: {},
      ...patch,
    };
  }
  function inputs(events = [occurrence()]): RuleReportContext {
    return context([], {
      eventKeys: { storm: "mod:example:storm" },
      occurrences: events,
    });
  }

  it("uses activation-time names after the event expires or its facilities are gone", () => {
    const result = interpretRuleReport(report, inputs());
    expect(result.available).toBe(true);
    expect(result.message).toContain("Original coal plant, Old turbine");
    expect(result.attributes.selectedFacilityNames).toEqual([
      "Original coal plant",
      "Old turbine",
    ]);
  });

  it("warns for an observed selector with no match", () => {
    const result = interpretRuleReport(
      report,
      inputs([occurrence({ attributes: { selectedFacilityNames: [] } })]),
    );
    expect(result).toMatchObject({
      available: true,
      importance: "NOTABLE",
      attributes: { affectedFacilityCount: 0 },
    });
    expect(result.message).toContain("No owned facility");
  });

  it("requires exact occurrence identity and persisted selection facts", () => {
    expect(
      interpretRuleReport(report, context([], { occurrences: [occurrence()] }))
        .available,
    ).toBe(false);
    expect(
      interpretRuleReport(
        report,
        inputs([occurrence({ key: "some-other-arc:storm" })]),
      ).available,
    ).toBe(false);
    expect(
      interpretRuleReport(report, inputs([occurrence({ attributes: {} })]))
        .available,
    ).toBe(false);
    expect(
      interpretRuleReport(
        report,
        inputs([occurrence({ attributes: { selectedFacilityNames: [1] } })]),
      ).available,
    ).toBe(false);
  });

  it("does not reveal a future surprise, and can report its recorded activation at the exact boundary", () => {
    const event = occurrence({
      startsMinute: 3 * MINUTES_PER_MONTH,
      forecastable: false,
    });
    expect(
      interpretRuleReport(report, { ...inputs([event]), completedMonths: 2 })
        .available,
    ).toBe(false);
    expect(
      interpretRuleReport(report, { ...inputs([event]), completedMonths: 3 })
        .available,
    ).toBe(true);
  });

  it("copies recorded names into its output", () => {
    const event = occurrence();
    const result = interpretRuleReport(report, inputs([event]));
    (result.attributes.selectedFacilityNames as string[]).push(
      "Replacement plant",
    );
    expect(event.attributes.selectedFacilityNames).toEqual([
      "Original coal plant",
      "Old turbine",
    ]);
  });
});

describe("historical capacity feedback", () => {
  const firm: RuleReport = {
    id: "firm",
    kind: "firmCoverage",
    fromMonth: 0,
    throughMonth: 1,
  };
  const storage: RuleReport = { ...firm, kind: "storageCoverage" };
  const rows = [month(0, { peakDemandW: 200 }), month(1, { peakDemandW: 100 })];
  const inputs = context(rows, {
    snapshot: { firmPeakW: 100, storagePeakW: 50, storagePeakWh: 800 },
    snapshotMonth: 1,
  });

  it("combines firm generation and storage power against the window's largest demand peak", () => {
    const result = interpretRuleReport(firm, inputs);
    expect(metric(result, "firmCoverage").value).toBe(0.75);
    expect(result.importance).toBe("ROUTINE");
    expect(
      interpretRuleReport(firm, {
        ...inputs,
        snapshot: { ...inputs.snapshot!, firmPeakW: 99.999 },
      }).importance,
    ).toBe("NOTABLE");
  });

  it("keeps storage power share and energy duration distinct", () => {
    const result = interpretRuleReport(storage, inputs);
    expect(metric(result, "storageCoverage")).toMatchObject({
      value: 0.25,
      unit: "share",
    });
    expect(metric(result, "storageHoursAtPeak")).toMatchObject({
      value: 4,
      unit: "hours",
    });
  });

  it("accepts zero capacity and capacity above demand without inventing a bound", () => {
    const empty = interpretRuleReport(storage, {
      ...inputs,
      snapshot: { firmPeakW: 0, storagePeakW: 0, storagePeakWh: 0 },
    });
    expect(empty.available).toBe(true);
    expect(metric(empty, "storageHoursAtPeak").value).toBe(0);
    const surplus = interpretRuleReport(firm, {
      ...inputs,
      snapshot: { firmPeakW: 300, storagePeakW: 50, storagePeakWh: 800 },
    });
    expect(metric(surplus, "firmCoverage").value).toBe(1.75);
  });

  it.each([
    { snapshot: undefined },
    { snapshotMonth: 0 },
    { snapshotMonth: 2 },
    { snapshot: { firmPeakW: -1, storagePeakW: 0, storagePeakWh: 0 } },
    {
      monthlyHistory: [
        month(0, { peakDemandW: 0 }),
        month(1, { peakDemandW: 0 }),
      ],
    },
  ])(
    "does not substitute a current or invalid fleet for the closing snapshot: %p",
    (patch) => {
      expect(interpretRuleReport(firm, { ...inputs, ...patch }).available).toBe(
        false,
      );
    },
  );
});

describe("recorded profit and loss", () => {
  const report: RuleReport = {
    id: "profit",
    kind: "profitLoss",
    fromMonth: 0,
    throughMonth: 0,
  };

  it("uses the accounting owner's complete expenses, including imports", () => {
    const result = interpretRuleReport(
      report,
      context([
        month(0, {
          revenue: 100,
          revenueExports: 20,
          revenueGrants: 10,
          expensesFuel: 10,
          expensesOM: 20,
          expensesCarbonFee: 5,
          expensesInterest: 5,
          expensesPolicy: 10,
          expensesImports: 60,
        }),
      ]),
    );
    expect(metric(result, "netIncome")).toMatchObject({
      value: -10,
      unit: "dollars",
    });
    expect(result.importance).toBe("NOTABLE");
    expect(result.message).toContain("loss");
  });

  it.each([
    [0, "broke even"],
    [20, "profit"],
    [-20, "loss"],
  ])("reports an exact %s net income", (revenue, message) => {
    const result = interpretRuleReport(
      report,
      context([month(0, { revenue })]),
    );
    expect(result.available).toBe(true);
    expect(metric(result, "netIncome").value).toBe(revenue);
    expect(result.message).toContain(message);
  });

  it("makes nonfinite accounting facts unavailable", () => {
    expect(
      interpretRuleReport(
        report,
        context([month(0, { expensesImports: Number.NaN })]),
      ).available,
    ).toBe(false);
  });
});

describe("data-center debrief feedback", () => {
  const report: RuleReport = {
    id: "data",
    kind: "dataCenter",
    fromMonth: 0,
    throughMonth: 2,
  };
  const rows = [
    month(0, { supplyWh: 99 }),
    month(1, { supplyWh: 98.999 }),
    month(2),
  ];

  it("counts only deficits above one Wh and preserves the recorded tariff comparison", () => {
    const result = interpretRuleReport(
      report,
      context(rows, {
        startingRateDollarsPerKWh: 0.1,
        endingRateDollarsPerKWh: 0.2,
      }),
    );
    expect(metric(result, "blackoutMonths")).toMatchObject({
      value: 1,
      label: "Months with blackouts after Data Centers arrived",
      unit: "months",
    });
    expect(metric(result, "electricityRate").value).toBe("$0.1/kWh → $0.2/kWh");
    expect(result.importance).toBe("NOTABLE");
  });

  it("does not infer tariffs from grants or billed revenue, and accepts an actual zero tariff", () => {
    const result = interpretRuleReport(
      report,
      context([month(0, { revenue: 50000 }), month(1), month(2)], {
        startingRateDollarsPerKWh: 0.2,
        endingRateDollarsPerKWh: 0,
      }),
    );
    expect(metric(result, "electricityRate").value).toBe("$0.2/kWh → $0/kWh");
    expect(result.importance).toBe("ROUTINE");
  });

  it("marks missing rate observations unavailable while retaining the known blackout count", () => {
    const result = interpretRuleReport(report, context(rows));
    expect(result.available).toBe(false);
    expect(metric(result, "blackoutMonths")).toMatchObject({
      available: true,
      value: 1,
    });
    expect(metric(result, "electricityRate")).toMatchObject({
      available: false,
    });
  });
});

describe("deep-freeze debrief feedback", () => {
  const report: RuleReport = {
    id: "freeze",
    kind: "deepFreeze",
    fromMonth: 0,
    throughMonth: 2,
  };
  const rows = [
    month(0, {
      supplyWh: 1000,
      demandWh: 1100,
      revenue: 150,
      revenueExports: 30,
      revenueGrants: 20,
    }),
    month(1, { supplyWh: 900, demandWh: 1000, minimumSupplyMarginW: -25 }),
    month(2, {
      supplyWh: 2000,
      demandWh: 2000,
      revenue: 450,
      revenueExports: 30,
      revenueGrants: 20,
    }),
  ];

  it("observes the middle month's shortage, billed before/after rates, and cash through recovery", () => {
    const result = interpretRuleReport(report, context([...rows].reverse()));
    expect(result.available).toBe(true);
    expect(metric(result, "unservedWh")).toMatchObject({
      value: 100,
      unit: "Wh",
    });
    expect(metric(result, "maximumDeficitW")).toMatchObject({
      value: 25,
      unit: "W",
    });
    expect(metric(result, "electricityRate").value).toBe("$100/kWh → $200/kWh");
    expect(metric(result, "cashStayedPositive")).toMatchObject({
      value: true,
      unit: "boolean",
    });
    expect(result).toMatchObject({
      importance: "NOTABLE",
      turningPointPriority: 110,
    });
  });

  it("does not call zero cash positive, or a nonnegative supply margin a shortage", () => {
    const result = interpretRuleReport(
      report,
      context([
        month(0),
        month(1, { cash: 0, minimumSupplyMarginW: 10 }),
        month(2),
      ]),
    );
    expect(metric(result, "cashStayedPositive").value).toBe(false);
    expect(metric(result, "maximumDeficitW").value).toBe(0);
  });

  it.each([
    [month(0), month(1), month(2, { supplyWh: 0 })],
    [month(0), month(1, { minimumSupplyMarginW: undefined }), month(2)],
    [month(0), month(1, { cash: Number.NaN }), month(2)],
    [month(0), month(1)],
  ])("does not invent missing freeze observations: %p", (...history) => {
    expect(interpretRuleReport(report, context(history)).available).toBe(false);
  });

  it("requires exactly the before, event and recovery months", () => {
    expect(
      interpretRuleReport({ ...report, throughMonth: 1 }, context(rows))
        .available,
    ).toBe(false);
  });
});
