import { shouldKeepGeneratorCommitted } from "./Commitment";
import { TickPresentFutureType } from "../Types";

function tick(target: number | undefined): TickPresentFutureType {
  return {
    dispatchTargetWByFacility: target === undefined ? {} : { 7: target },
  } as TickPresentFutureType;
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
});
