import { describeHydroStatus, ReservoirOutlookPoint } from "./HydroOutlook";

function outlook(
  points: Array<[number, number, number]>,
): ReservoirOutlookPoint[] {
  return points.map(([monthNumber, fraction, snowpackMm]) => ({
    monthNumber,
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
    expect(status.detail).toMatch(/dispatch order/);
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
      { monthNumber: 1, fraction: 0.47, snowpackMm: 0 },
      { monthNumber: 2, fraction: 0.3, snowpackMm: 0 },
      { monthNumber: 3, fraction: 0.12, snowpackMm: 0 },
    ],
  });
  expect(status.tone).toBe("warn");
  expect(status.detail).toMatch(/It will run low around March/);
  expect(
    describeHydroStatus({
      spilling: false,
      monthNumber: 1,
      fraction: 0.47,
      fleet: true,
      outlook: [
        { monthNumber: 1, fraction: 0.47, snowpackMm: 0 },
        { monthNumber: 2, fraction: 0.12, snowpackMm: 0 },
      ],
    }).detail,
  ).toMatch(/Your dams will run low around February/);
});
