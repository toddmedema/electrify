import type { GameType } from "../Types";
import {
  UTILITY_AREAS,
  UTILITY_TARGETS,
  UtilityEnergyShares,
} from "../data/UtilityExpansion";

export interface CombinedUtilityDemandProfile {
  demandScale: number;
  demandShapeExponent: number;
  energyShares: UtilityEnergyShares;
}

/**
 * One company's static demand composition, derived only from acquired package identities.
 * Customer counts weight the authored per-account scale and shape exponent; sector shares use
 * customer × scale weights so a higher-load package contributes its share of electricity use.
 * The single evolving customer count and Burlington weather are applied by the demand owner.
 */
export function combinedUtilityDemandProfile(
  game: Pick<GameType, "utilityExpansion">,
): CombinedUtilityDemandProfile {
  const owned = new Set(
    game.utilityExpansion?.acquisitions.map(({ targetId }) => targetId),
  );
  const definitions = [
    UTILITY_AREAS.champlain,
    ...UTILITY_TARGETS.filter(({ id }) => owned.has(id)).map(
      ({ id }) => UTILITY_AREAS[id],
    ),
  ];
  if (definitions.length === 1) {
    const { demandScale, demandShapeExponent, energyShares } = definitions[0];
    return { demandScale, demandShapeExponent, energyShares };
  }
  const customers = definitions.reduce((sum, area) => sum + area.customers, 0);
  const loadWeight = definitions.reduce(
    (sum, area) => sum + area.customers * area.demandScale,
    0,
  );
  const sector = (name: keyof UtilityEnergyShares) =>
    definitions.reduce(
      (sum, area) =>
        sum + area.customers * area.demandScale * area.energyShares[name],
      0,
    ) / loadWeight;
  return {
    demandScale: loadWeight / customers,
    demandShapeExponent:
      definitions.reduce(
        (sum, area) => sum + area.customers * area.demandShapeExponent,
        0,
      ) / customers,
    energyShares: {
      Residential: sector("Residential"),
      Commercial: sector("Commercial"),
      Industrial: sector("Industrial"),
    },
  };
}
