import {
  prepareGeneratorCommitment,
  recordDispatchTarget,
  shouldKeepGeneratorCommitted,
} from "./Commitment";
import { TickPresentFutureType } from "../Types";

function tick(target: number | undefined): TickPresentFutureType {
  const result = {} as TickPresentFutureType;
  if (target !== undefined) {
    recordDispatchTarget(result, 7, target);
  }
  return result;
}

describe("generator commitment optimization", () => {
  it("stays online when forecasted use returns before minimum-load cost reaches a start", () => {
    const minimumOperatingCost = jest.fn(() => 20);

    expect(
      shouldKeepGeneratorCommitted({
        facilityId: 7,
        forecast: [tick(0), tick(0), tick(1)],
        fromIndex: 0,
        startCost: 50,
        minimumOperatingCost,
      }),
    ).toBe(true);
    expect(minimumOperatingCost).toHaveBeenCalledTimes(1);
  });

  it("shuts down as soon as minimum-load cost reaches the next-start charge", () => {
    const minimumOperatingCost = jest.fn(() => 20);

    expect(
      shouldKeepGeneratorCommitted({
        facilityId: 7,
        forecast: [tick(0), tick(0), tick(0), tick(0), tick(1)],
        fromIndex: 0,
        startCost: 40,
        minimumOperatingCost,
      }),
    ).toBe(false);
    expect(minimumOperatingCost).toHaveBeenCalledTimes(2);
  });

  it("shuts down immediately when restarting has no modeled cost", () => {
    const minimumOperatingCost = jest.fn(() => 20);

    expect(
      shouldKeepGeneratorCommitted({
        facilityId: 7,
        forecast: [tick(0), tick(1)],
        fromIndex: 0,
        startCost: 0,
        minimumOperatingCost,
      }),
    ).toBe(false);
    expect(minimumOperatingCost).not.toHaveBeenCalled();
  });

  it("shuts down when the plant is not needed again inside the forecast", () => {
    expect(
      shouldKeepGeneratorCommitted({
        facilityId: 7,
        forecast: [tick(0), tick(0), tick(0)],
        fromIndex: 0,
        startCost: 100,
        minimumOperatingCost: () => 20,
      }),
    ).toBe(false);
  });

  it("precomputes the same decisions without serializing forecast targets", () => {
    const forecast = [tick(undefined), tick(undefined), tick(undefined)];
    forecast.forEach((item, index) =>
      recordDispatchTarget(item, 7, index === 2 ? 1 : 0),
    );
    const minimumOperatingCost = jest.fn(() => 20);

    prepareGeneratorCommitment({
      facilityId: 7,
      forecast,
      minimumOperatingCost,
    });

    expect(
      shouldKeepGeneratorCommitted({
        facilityId: 7,
        forecast,
        fromIndex: 0,
        startCost: 50,
        minimumOperatingCost,
      }),
    ).toBe(true);
    expect(minimumOperatingCost).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(forecast)).not.toContain("dispatchTarget");
  });
});

test("an owned area's prepared generator decisions survive copy and JSON save", () => {
  const {
    copyCommitmentMetadata,
    serializeCommitmentMetadata,
    restoreCommitmentMetadata,
    validCommitmentMetadata,
  } = jest.requireActual<typeof import("./Commitment")>("./Commitment");
  const local = [tick(0), tick(0), tick(1)];
  prepareGeneratorCommitment({
    facilityId: 7,
    forecast: local,
    minimumOperatingCost: () => 20,
  });
  const timeline = local.map(
    (area) =>
      ({ areaTicks: { "ridge-electric": area } }) as TickPresentFutureType,
  );
  const saved = JSON.parse(
    JSON.stringify(serializeCommitmentMetadata(timeline)),
  );
  expect(validCommitmentMetadata(saved, 3)).toBe(true);
  const restored = JSON.parse(
    JSON.stringify(timeline),
  ) as TickPresentFutureType[];
  restoreCommitmentMetadata(restored, saved);
  expect(
    shouldKeepGeneratorCommitted({
      facilityId: 7,
      forecast: restored.map((t) => t.areaTicks!["ridge-electric"]!),
      fromIndex: 0,
      startCost: 50,
      minimumOperatingCost: () => 1000,
    }),
  ).toBe(true);
  const copied = timeline.map((t) => ({ ...t }));
  timeline.forEach((t, i) => copyCommitmentMetadata(t, copied[i]));
  expect(serializeCommitmentMetadata(copied)).toEqual(saved);
  const bad = JSON.parse(JSON.stringify(saved));
  bad[0].areas["ridge-electric"].areas = { champlain: bad[1] };
  expect(validCommitmentMetadata(bad, 3)).toBe(false);
});
