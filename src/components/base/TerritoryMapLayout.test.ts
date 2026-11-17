import { TERRITORY_TILES } from "../../data/TerritoryTiles";
import { citySizeLabel } from "./TerritoryTileFacts";
import {
  territoryTileLabel,
  tilePurchaseBenefitLabel,
  territoryPeerColors,
} from "./TerritoryMapLayout";

it("gives all other companies distinct borders even when seat hashes collide", () => {
  const colors = territoryPeerColors(["1", "4", "7"]);
  expect(new Set(Object.values(colors)).size).toBe(3);
  expect(territoryPeerColors(["7", "1", "4", "1"])).toEqual(colors);
});

it("labels each city by size and connects mixed service accounts with one customer label", () => {
  for (const tile of TERRITORY_TILES.filter((tile) => tile.city)) {
    expect(territoryTileLabel(tile)).toContain(citySizeLabel(tile.city!.size));
    expect(territoryTileLabel(tile)).not.toMatch(/residential|industrial/i);
  }
  expect(
    tilePurchaseBenefitLabel({ benefit: "residential", customers: 16000 }),
  ).toBe("16k customers");
  expect(
    tilePurchaseBenefitLabel({ benefit: "industrial", customers: 400 }),
  ).toBe("400 customers");
});
