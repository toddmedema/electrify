import { UTILITY_AREAS } from "../data/UtilityExpansion";
import { GameType, UtilityTargetId } from "../Types";
import { combinedUtilityDemandProfile } from "./CombinedUtilityDemand";

function ownership(
  ...targets: UtilityTargetId[]
): Pick<GameType, "utilityExpansion"> {
  return {
    utilityExpansion: {
      networkAssets: [],
      loans: [],
      acquisitions: targets.map((targetId, index) => ({
        targetId,
        minute: index * 1440,
        financed: true,
        transferredCustomers: UTILITY_AREAS[targetId].customers,
      })),
    },
  };
}

it("preserves the exact Champlain demand profile before a purchase", () => {
  expect(combinedUtilityDemandProfile({})).toEqual({
    demandScale: UTILITY_AREAS.champlain.demandScale,
    demandShapeExponent: UTILITY_AREAS.champlain.demandShapeExponent,
    energyShares: UTILITY_AREAS.champlain.energyShares,
  });
});

it("combines acquired package profiles into one customer-weighted composition", () => {
  const profile = combinedUtilityDemandProfile(ownership("valley-electric"));
  const home = UTILITY_AREAS.champlain,
    target = UTILITY_AREAS["valley-electric"];
  expect(profile.demandScale).toBe(
    (home.customers * home.demandScale +
      target.customers * target.demandScale) /
      (home.customers + target.customers),
  );
  expect(profile.demandShapeExponent).toBe(
    (home.customers * home.demandShapeExponent +
      target.customers * target.demandShapeExponent) /
      (home.customers + target.customers),
  );
  expect(
    Object.values(profile.energyShares).reduce((sum, value) => sum + value, 0),
  ).toBeCloseTo(1, 14);
  expect(profile.energyShares.Residential).toBeGreaterThan(
    home.energyShares.Residential,
  );
});

it("derives composition from identities, independently of purchase order, dates or transferred counts", () => {
  const first = ownership("valley-electric", "ridge-electric");
  const reversed = ownership("ridge-electric", "valley-electric");
  reversed.utilityExpansion!.acquisitions[0].transferredCustomers *= 2;
  reversed.utilityExpansion!.acquisitions[1].minute += 5000;
  expect(combinedUtilityDemandProfile(first)).toEqual(
    combinedUtilityDemandProfile(reversed),
  );
  expect(
    combinedUtilityDemandProfile(ownership("ridge-electric", "ridge-electric")),
  ).toEqual(combinedUtilityDemandProfile(ownership("ridge-electric")));
});

it("lets Ridge's industrial composition make the merged mix steadier", () => {
  const profile = combinedUtilityDemandProfile(ownership("ridge-electric"));
  expect(profile.energyShares.Industrial).toBeGreaterThan(
    UTILITY_AREAS.champlain.energyShares.Industrial,
  );
});
