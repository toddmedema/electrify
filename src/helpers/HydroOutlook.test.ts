import {
  describeHydroStatus,
  reservoirOutlook,
  ReservoirOutlookPoint,
} from "./HydroOutlook";
import { MINUTES_PER_MONTH } from "./DateTime";
import { TickPresentFutureType } from "../Types";

it("keeps the snapshot calendar year on current and month-end forecast points", () => {
  const tick = (minute: number) =>
    ({
      minute,
      hydroReservoirWh: 50,
      hydroReservoirCapacityWh: 100,
      snowpackMm: 0,
    }) as TickPresentFutureType;
  const now = tick(11 * MINUTES_PER_MONTH);
  const forecast = [
    tick(12 * MINUTES_PER_MONTH - 1),
    tick(12 * MINUTES_PER_MONTH),
  ];
  expect(reservoirOutlook(now, forecast, 2025)).toEqual([
    expect.objectContaining({ monthNumber: 12, year: 2025 }),
    expect.objectContaining({ monthNumber: 12, year: 2025 }),
    expect.objectContaining({ monthNumber: 1, year: 2026 }),
  ]);
});

function outlook(
  points: Array<[number, number, number]>,
): ReservoirOutlookPoint[] {
  return points.map(([monthNumber, fraction, snowpackMm]) => ({
    monthNumber,
    year: 2025,
    fraction,
    snowpackMm,
  }));
}

const base = {
  spilling: false,
  // October: a light month for water-rights releases in the northern hemisphere
  monthNumber: 10,
  latitude: 40,
};

describe("describeHydroStatus", () => {
  test.each([
    [0, "Empty."],
    [0.019999, "Empty."],
    [0.02, "Nearly empty."],
  ])("labels a reservoir at %s fullness", (fraction, lead) => {
    expect(describeHydroStatus({ ...base, fraction })).toMatchObject({
      lead,
      tone: "bad",
    });
  });

  test("a reservoir near its minimum level says output is limited", () => {
    const status = describeHydroStatus({ ...base, fraction: 0.12 });
    expect(status.tone).toBe("bad");
    expect(status.lead).toBe("Nearly empty.");
  });

  test("spilling water is framed as free generation", () => {
    const status = describeHydroStatus({
      ...base,
      fraction: 1,
      spilling: true,
    });
    expect(status.lead).toBe("Full.");
    expect(status.detail).toMatch(/costs no stored water/);
  });

  test("the next month of the forecast sets the direction", () => {
    expect(
      describeHydroStatus({
        ...base,
        fraction: 0.5,
        outlook: outlook([
          [10, 0.5, 0],
          [11, 0.6, 0],
        ]),
      }).lead,
    ).toBe("Filling.");
    expect(
      describeHydroStatus({
        ...base,
        fraction: 0.5,
        outlook: outlook([
          [10, 0.5, 0],
          [11, 0.4, 0],
        ]),
      }).lead,
    ).toBe("Draining.");
    expect(
      describeHydroStatus({
        ...base,
        fraction: 0.5,
        outlook: outlook([
          [10, 0.5, 0],
          [11, 0.51, 0],
        ]),
      }).lead,
    ).toBe("Steady.");
  });

  test("a draining reservoir with snow on the ground names the melt month", () => {
    const status = describeHydroStatus({
      ...base,
      monthNumber: 1,
      fraction: 0.5,
      outlook: outlook([
        [1, 0.5, 300],
        [2, 0.42, 320],
        [3, 0.36, 250],
        [4, 0.45, 120],
        [5, 0.7, 20],
      ]),
    });
    expect(status.lead).toBe("Draining.");
    expect(status.detail).toMatch(/refill around April/);
  });

  test("summer water rights are mentioned when no refill is coming", () => {
    const north = describeHydroStatus({
      ...base,
      monthNumber: 7,
      fraction: 0.5,
    });
    expect(north.detail).toMatch(/water rights/);
    // July is midwinter south of the equator, when downstream demand is light
    const south = describeHydroStatus({
      ...base,
      monthNumber: 7,
      latitude: -15,
      fraction: 0.5,
    });
    expect(south.detail).not.toMatch(/water rights/);
  });
});

test("a forecast that reaches the minimum level warns with the month", () => {
  const status = describeHydroStatus({
    spilling: false,
    monthNumber: 1,
    latitude: 40,
    fraction: 0.47,
    outlook: [
      { year: 2025, monthNumber: 1, fraction: 0.47, snowpackMm: 0 },
      { year: 2025, monthNumber: 2, fraction: 0.3, snowpackMm: 0 },
      { year: 2025, monthNumber: 3, fraction: 0.12, snowpackMm: 0 },
    ],
  });
  expect(status.tone).toBe("warn");
  expect(status.detail).toMatch(/It will run low around March/);
  expect(status.detail).toMatch(/later in the dispatch order/);
  expect(
    describeHydroStatus({
      spilling: false,
      monthNumber: 1,
      fraction: 0.47,
      fleet: true,
      outlook: [
        { year: 2025, monthNumber: 1, fraction: 0.47, snowpackMm: 0 },
        { year: 2025, monthNumber: 2, fraction: 0.12, snowpackMm: 0 },
      ],
    }),
  ).toMatchObject({
    lead: "Your dams are draining.",
    detail: expect.stringMatching(/They will run low around February/),
  });
});

test("a nearly empty lone dam names when it refills, or says it won't", () => {
  const input = {
    spilling: false,
    monthNumber: 8,
    latitude: 40,
    fraction: 0.05,
  };
  expect(
    describeHydroStatus({
      ...input,
      outlook: [
        { year: 2025, monthNumber: 8, fraction: 0.05, snowpackMm: 0 },
        { year: 2025, monthNumber: 9, fraction: 0.05, snowpackMm: 0 },
        { year: 2025, monthNumber: 10, fraction: 0.2, snowpackMm: 0 },
      ],
    }).detail,
  ).toMatch(/likely in October/);
  expect(
    describeHydroStatus({
      ...input,
      outlook: [
        { year: 2025, monthNumber: 8, fraction: 0.05, snowpackMm: 0 },
        { year: 2025, monthNumber: 9, fraction: 0.04, snowpackMm: 0 },
      ],
    }).detail,
  ).toMatch(/no refill is expected/);
});

test.each([false, true])(
  "a reservoir rising before a dry spell says the rise is temporary (fleet: %s)",
  (fleet) => {
    const status = describeHydroStatus({
      spilling: false,
      monthNumber: 4,
      latitude: 40,
      fraction: 0.32,
      fleet,
      outlook: [
        { year: 2025, monthNumber: 4, fraction: 0.32, snowpackMm: 0 },
        { year: 2025, monthNumber: 5, fraction: 0.4, snowpackMm: 0 },
        { year: 2025, monthNumber: 6, fraction: 0.05, snowpackMm: 0 },
      ],
    });
    expect(status).toMatchObject({
      lead: "Filling for now",
      detail: expect.stringMatching(/^but will run low around June\./),
      tone: "warn",
    });
  },
);

test("running low before the month ends says so", () => {
  const status = describeHydroStatus({
    spilling: false,
    monthNumber: 1,
    fraction: 0.4,
    outlook: [
      { year: 2025, monthNumber: 1, fraction: 0.4, snowpackMm: 0 },
      { year: 2025, monthNumber: 1, fraction: 0.1, snowpackMm: 0 },
    ],
  });
  expect(status.detail).toMatch(/will run low this month/);
});
