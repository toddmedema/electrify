import {
  isStorage,
  type FacilityOperatingType,
  type TerritoryId,
  type TerritoryTick,
} from "../Types";
import { TERRITORIES } from "../data/Territories";
import { facilityTerritoryId } from "./Territories";
import { supplyAtDemandBoundary } from "./Transmission";
import type {
  clearTerritoryMarket,
  TerritoryDispatchInput,
} from "./TerritoryDispatch";

/** Derive the reported physical balances without mutating the settled fleet or routing result. */
export function territoryBalances(
  territoryIds: readonly TerritoryId[],
  facilities: readonly FacilityOperatingType[],
  demandW: TerritoryDispatchInput["demandW"],
  market: Pick<
    ReturnType<typeof clearTerritoryMarket>,
    "sources" | "sinks" | "result"
  >,
): Partial<Record<TerritoryId, TerritoryTick>> {
  const regionSources = market.sources;
  const regionSinks = market.sinks;
  return Object.fromEntries(
    TERRITORIES.filter(({ id }) => territoryIds.includes(id)).map(({ id }) => {
      const generationW = facilities.reduce(
        (sum, facility) =>
          sum +
          (!isStorage(facility) &&
          !facility.paused &&
          facility.yearsToBuildLeft === 0 &&
          facilityTerritoryId(facility) === id
            ? facility.currentW
            : 0),
        0,
      );
      const importedW = regionSources.reduce(
        (sum, source, i) =>
          sum +
          (source.territoryId === id &&
          (source.kind === "agreement" || source.kind === "import")
            ? market.result.sourceW[i]
            : 0),
        0,
      );
      const exportedW = regionSinks.reduce(
        (sum, sink, i) =>
          sum +
          (sink.territoryId === id &&
          (sink.id.startsWith("export:") || sink.id === "peer-export")
            ? market.result.sinkW[i]
            : 0),
        0,
      );
      const storageChargeW = regionSinks.reduce(
        (sum, sink, i) =>
          sum +
          (sink.territoryId === id &&
          (sink.id.startsWith("charge:") ||
            sink.id.startsWith("customer-battery:"))
            ? market.result.sinkW[i]
            : 0),
        0,
      );
      const storageDischargeW = facilities.reduce(
        (sum, facility) =>
          sum +
          (isStorage(facility) &&
          !facility.paused &&
          facility.yearsToBuildLeft === 0 &&
          facilityTerritoryId(facility) === id
            ? Math.max(0, facility.currentW)
            : 0),
        0,
      );
      const curtailedW = regionSources.reduce(
        (sum, source, i) =>
          sum +
          (source.territoryId === id && source.kind === "native"
            ? Math.max(0, source.capacityW - market.result.sourceW[i])
            : 0),
        0,
      );
      const supplyW = supplyAtDemandBoundary(
        market.result.servedW[id],
        demandW[id],
      );
      return [
        id,
        {
          demandW: demandW[id],
          supplyW,
          generationW,
          importedW,
          exportedW,
          storageChargeW,
          storageDischargeW,
          unservedW: Math.max(0, demandW[id] - supplyW),
          curtailedW,
        },
      ];
    }),
  );
}
