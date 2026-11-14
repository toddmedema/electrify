import type { BuyingRuleType, SellingRuleType, TerritoryId } from "../Types";
import {
  allocateIntertieFlows,
  type IntertieOffer,
  type IntertieReservation,
} from "./Transmission";

export interface TerritoryDispatchSource {
  id: string;
  territoryId: TerritoryId;
  capacityW: number;
  kind: "native" | "agreement" | "import";
}
export interface TerritoryDispatchSink {
  id: string;
  territoryId: TerritoryId;
  capacityW: number;
  priority?: number;
}
export interface TerritoryDispatchEdge {
  id: number;
  from: TerritoryId;
  to: TerritoryId;
  capacityW: number;
}
export interface TerritoryDispatchInput {
  demandW: Record<TerritoryId, number>;
  edges: readonly TerritoryDispatchEdge[];
  sources: readonly TerritoryDispatchSource[];
  /** Lower priority than every reachable customer, and never supplied by agreements. */
  sinks?: readonly TerritoryDispatchSink[];
  importToSinks?: boolean;
}
const IDS: TerritoryId[] = [
  "champlain",
  "valley-electric",
  "ridge-electric",
  "green-uplands",
];

/**
 * Four-node radial transport, with local customers first and a residual network so a later
 * local source can free an earlier source to serve another territory. This is transport of
 * watts, not a second generation model: ramps, water and storage remain owned by the reducer.
 */
export function routeTerritoryPower({
  demandW,
  edges,
  sources,
  sinks = [],
  importToSinks = false,
}: TerritoryDispatchInput) {
  const sourceNode = 4;
  const sinkNode = 5;
  const size = 6 + sources.length + sinks.length;
  const residual = Array.from({ length: size }, () =>
    Array<number>(size).fill(0),
  );
  const index = (id: TerritoryId) => IDS.indexOf(id);
  const add = (from: number, to: number, capacity: number) => {
    residual[from][to] += Math.max(0, capacity);
  };
  const push = (path: number[], watts: number) => {
    for (let i = 1; i < path.length; i++) {
      residual[path[i - 1]][path[i]] -= watts;
      residual[path[i]][path[i - 1]] += watts;
    }
  };
  const augment = () => {
    while (true) {
      const previous = Array<number>(size).fill(-1);
      previous[sourceNode] = sourceNode;
      const queue = [sourceNode];
      for (
        let head = 0;
        head < queue.length && previous[sinkNode] < 0;
        head++
      ) {
        const from = queue[head];
        for (let to = 0; to < size; to++) {
          if (previous[to] >= 0 || !(residual[from][to] > 0)) continue;
          previous[to] = from;
          queue.push(to);
        }
      }
      if (previous[sinkNode] < 0) return;
      const path = [sinkNode];
      let watts = Infinity;
      while (path[0] !== sourceNode) {
        const from = previous[path[0]];
        watts = Math.min(watts, residual[from][path[0]]);
        path.unshift(from);
      }
      push(path, watts);
    }
  };
  IDS.forEach((id, i) => add(i, sinkNode, demandW[id]));
  edges.forEach((edge) => {
    add(index(edge.from), index(edge.to), edge.capacityW);
    add(index(edge.to), index(edge.from), edge.capacityW);
  });
  const kinds = ["native", "agreement", "import"] as const;
  for (const kind of kinds) {
    sources.forEach((source, i) => {
      if (source.kind !== kind) return;
      const node = 6 + i;
      const territory = index(source.territoryId);
      add(sourceNode, node, source.capacityW);
      add(node, territory, source.capacityW);
      // Claim local load before allowing any source in this class to leave its territory.
      const localW = Math.min(
        residual[sourceNode][node],
        residual[territory][sinkNode],
      );
      push([sourceNode, node, territory, sinkNode], localW);
    });
    augment();
  }
  const servedW = Object.fromEntries(
    IDS.map((id, i) => [id, demandW[id] - residual[i][sinkNode]]),
  ) as Record<TerritoryId, number>;
  // Freeze customer delivery. Lower-priority sinks can reroute existing deliveries, but cannot
  // take watts from an already-served customer or buy an agreement just to fill storage.
  IDS.forEach((_, i) => {
    residual[sinkNode][i] = 0;
    residual[i][sinkNode] = 0;
  });
  sources.forEach((source, i) => {
    if (
      source.kind !== "native" &&
      !(importToSinks && source.kind === "import")
    )
      residual[sourceNode][6 + i] = 0;
  });
  for (const priority of [
    ...new Set(sinks.map((sink) => sink.priority ?? 0)),
  ].sort((a, b) => a - b)) {
    sinks.forEach((sink, i) => {
      if ((sink.priority ?? 0) !== priority) return;
      const node = 6 + sources.length + i;
      add(index(sink.territoryId), node, sink.capacityW);
      add(node, sinkNode, sink.capacityW);
    });
    augment();
  }
  const sourceW = sources.map((_, i) => residual[6 + i][sourceNode]);
  const sinkW = sinks.map((_, i) => residual[sinkNode][6 + sources.length + i]);
  return {
    servedW,
    sourceW,
    sinkW,
    totalServedW: IDS.reduce((sum, id) => sum + servedW[id], 0),
    totalSinkW: sinkW.reduce((sum, watts) => sum + watts, 0),
    // Positive means the neighbor is sending power toward Champlain (edge.from).
    flows: edges.map((edge) => ({
      id: edge.id,
      watts: residual[index(edge.from)][index(edge.to)] - edge.capacityW,
    })),
  };
}

/** Market budgets are reserved only for physically useful deliveries, in the player's order. */
export function clearTerritoryMarket({
  input,
  interfaces,
  reservations,
  buyingRule,
  sellingRule,
}: {
  input: TerritoryDispatchInput;
  interfaces: readonly { territoryId: TerritoryId; offer: IntertieOffer }[];
  reservations: readonly IntertieReservation[];
  buyingRule: BuyingRuleType;
  sellingRule: SellingRuleType;
}) {
  const sources = [...input.sources];
  const sinks = [...(input.sinks ?? [])];
  const importSourceIndex = interfaces.map(() => -1);
  const exportSinkIndex = interfaces.map(() => -1);
  const route = (importToSinks = false) =>
    routeTerritoryPower({ ...input, sources, sinks, importToSinks });
  let result = route();
  const baseSourceCount = sources.length;
  const nativeChargeW = result.totalSinkW;
  if (buyingRule !== "NONE") {
    for (const storage of buyingRule === "SHORTAGES_AND_STORAGE"
      ? [false, true]
      : [false]) {
      for (const [i, { territoryId, offer }] of interfaces.entries()) {
        const reserved = [
          ...reservations,
          ...interfaces.flatMap((entry, j) => {
            const index = importSourceIndex[j];
            return index >= 0
              ? [{ offer: entry.offer, watts: sources[index].capacityW }]
              : [];
          }),
        ];
        const capacityW = allocateIntertieFlows([offer], Infinity, 0, reserved)
          .importedW[0];
        if (!(capacityW > 0)) continue;
        let index = importSourceIndex[i];
        if (index < 0) {
          index = sources.length;
          importSourceIndex[i] = index;
          sources.push({
            id: `market:${i}`,
            territoryId,
            capacityW: 0,
            kind: "import",
          });
        }
        sources[index].capacityW += capacityW;
        result = route(storage);
        // Unreachable headroom is neither purchased nor reserved against another interface.
        for (let j = baseSourceCount; j < sources.length; j++)
          sources[j].capacityW = result.sourceW[j];
      }
    }
    result = route(buyingRule === "SHORTAGES_AND_STORAGE");
  }
  const importedW = interfaces.map((_, i) =>
    importSourceIndex[i] < 0 ? 0 : result.sourceW[importSourceIndex[i]],
  );
  const anyImports = result.sourceW.some(
    (watts, i) => sources[i].kind !== "native" && watts > 0,
  );
  if (!anyImports && sellingRule !== "NONE") {
    interfaces.forEach(({ territoryId, offer }, i) => {
      const marketUsedW = interfaces.reduce(
        (sum, entry, j) =>
          sum +
          (entry.offer.marketId === offer.marketId && offer.marketId
            ? (result.sinkW[exportSinkIndex[j]] ?? 0)
            : 0),
        0,
      );
      const accessUsedW = interfaces.reduce(
        (sum, entry, j) =>
          sum +
          (entry.offer.accessId === offer.accessId && offer.accessId
            ? (result.sinkW[exportSinkIndex[j]] ?? 0)
            : 0),
        0,
      );
      const capacityW = Math.max(
        0,
        Math.min(
          offer.exportLimitW,
          (offer.marketExportLimitW ?? Infinity) - marketUsedW,
          (offer.accessExportLimitW ?? Infinity) - accessUsedW,
        ),
      );
      exportSinkIndex[i] = sinks.length;
      sinks.push({ id: `export:${i}`, territoryId, capacityW, priority: 1 });
      result = route();
    });
  }
  return {
    result,
    sources,
    sinks,
    importedW,
    exportedW: interfaces.map((_, i) =>
      exportSinkIndex[i] < 0 ? 0 : result.sinkW[exportSinkIndex[i]],
    ),
    storageImportedW: Math.max(
      0,
      result.sinkW
        .slice(0, input.sinks?.length ?? 0)
        .reduce((sum, watts) => sum + watts, 0) - nativeChargeW,
    ),
  };
}

/** Additional useful output at one node, with every existing customer delivery retained. */
export function territoryAdditionalDemandW(
  input: TerritoryDispatchInput,
  territoryId: TerritoryId,
): number {
  const before = routeTerritoryPower(input);
  const after = routeTerritoryPower({
    ...input,
    sources: [
      ...input.sources,
      { id: "additional", territoryId, capacityW: 1e12, kind: "native" },
    ],
  });
  return Math.max(
    0,
    after.totalServedW +
      after.totalSinkW -
      before.totalServedW -
      before.totalSinkW,
  );
}
