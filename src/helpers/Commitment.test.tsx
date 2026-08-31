import {
  prepareGeneratorCommitment,
  recordDispatchTarget,
  shouldKeepGeneratorCommitted,
} from "./Commitment";
import { TickPresentFutureType } from "../Types";

function tick(target: number | undefined): TickPresentFutureType {
  return (
    target === undefined ? {} : { dispatchTargetWByFacility: { 7: target } }
  ) as TickPresentFutureType;
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
