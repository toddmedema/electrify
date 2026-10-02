import reducer, {
  facilityPurchased,
  acknowledgeFacilityArrival,
  delta,
} from "./UI";

it("keeps a pending data center guide through loading and clears it between runs", () => {
  const requested = reducer(
    undefined,
    delta({ dataCenterGuideRequested: true }),
  );
  for (const type of ["game/initGame", "game/loaded"]) {
    expect(reducer(requested, { type }).dataCenterGuideRequested).toBe(true);
  }
  for (const type of [
    "game/quit",
    "game/start",
    "game/resume",
    "game/startReplay",
    "game/launchRun",
  ]) {
    expect(
      reducer(requested, { type }).dataCenterGuideRequested,
    ).toBeUndefined();
  }
});

it("consumes only the matching purchase and clears arrivals between runs", () => {
  const purchased = reducer(undefined, facilityPurchased(7));
  expect(purchased.selectedFacilityId).toBeNull();
  expect(purchased.arrivingFacilityId).toBe(7);
  expect(
    reducer(purchased, acknowledgeFacilityArrival(6)).arrivingFacilityId,
  ).toBe(7);
  expect(
    reducer(purchased, acknowledgeFacilityArrival(7)).arrivingFacilityId,
  ).toBeUndefined();
  for (const type of [
    "game/quit",
    "game/start",
    "game/resume",
    "game/startReplay",
    "game/loaded",
    "game/initGame",
  ]) {
    expect(reducer(purchased, { type }).arrivingFacilityId).toBeUndefined();
  }
});
