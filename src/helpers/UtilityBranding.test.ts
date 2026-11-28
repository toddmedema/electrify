import { utilityBranding } from "./UtilityBranding";

test("NPC utilities use unclaimed logos consistently across player viewpoints", () => {
  const players = { first: "sunburst", second: "grid-pylon" } as const;
  const first = utilityBranding(31337, undefined, players, "first");
  const second = utilityBranding(31337, undefined, players, "second");
  const valley = first.forOwner("valley-electric");
  const city = "municipal:frontier:10:31";
  const frontier = first.forOwner(city);

  expect(first.forOwner("you")).toBe(players.first);
  expect(first.forOwner("peer:second")).toBe(players.second);
  expect(frontier).toBeDefined();
  expect(first.forTrade("valley-purchase:0")).toBe(valley);
  expect(second.forOwner("valley-electric")).toBe(valley);
  expect(second.forOwner(city)).toBe(frontier);
  expect(new Set([valley, frontier, ...Object.values(players)]).size).toBe(4);
  expect(first.forOwner(undefined)).toBeUndefined();
});
