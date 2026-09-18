import reducer, { facilityPurchased, acknowledgeFacilityArrival } from "./UI";

it("consumes only the matching purchase and clears arrivals between runs", () => {
  const purchased = reducer(undefined, facilityPurchased(7));
  expect(purchased.selectedFacilityId).toBe(7);
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
