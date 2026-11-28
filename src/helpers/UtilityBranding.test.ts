import { isUtilityLogo } from "../data/UtilityLogos";
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

test("a full co-op roster leaves valid marks for every NPC trade and frontier town", () => {
  const players = {
    a: "sunburst",
    b: "clipped-bolt",
    c: "grid-pylon",
    d: "turbine-rotor",
  } as const;
  const branding = utilityBranding(31337, undefined, players, "a");
  const marks = [
    branding.forTrade("champlain-nuclear"),
    branding.forTrade("champlain-quebec"),
    branding.forOwner("municipal:frontier:10:31"),
  ];
  expect(marks.every(isUtilityLogo)).toBe(true);
  expect(
    new Set([...marks, ...Object.values(players)]).size,
  ).toBeGreaterThanOrEqual(6);
  for (const mark of marks) expect(Object.values(players)).not.toContain(mark);
});
