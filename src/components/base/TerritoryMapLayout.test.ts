import { territoryPeerColors } from "./TerritoryMapLayout";

it("gives all other companies distinct borders even when seat hashes collide", () => {
  const colors = territoryPeerColors(["1", "4", "7"]);
  expect(new Set(Object.values(colors)).size).toBe(3);
  expect(territoryPeerColors(["7", "1", "4", "1"])).toEqual(colors);
});
