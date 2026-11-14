import type { BuyingRuleType, SellingRuleType, TerritoryId } from "../Types";
import {
  allocateIntertieFlows,
  supplyAtDemandBoundary,
  type IntertieOffer,
  type IntertieReservation,
} from "./Transmission";

export interface TerritoryDispatchSource {
  id: string;
  territoryId: TerritoryId;
  capacityW: number;
  kind: "native" | "agreement" | "import" | "spare";
}
export interface TerritoryDispatchSink {
  id: string;
  territoryId: TerritoryId;
  capacityW: number;
  priority?: number;
  agreements?: boolean;
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
  /** Lower priority than every reachable customer. Agreements cannot supply export sinks. */
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
  const size = 7 + sources.length + sinks.length;
  const agreementGateway = size - 1;
  const residual = Array.from(
    { length: size },
    () => new Map<number, number>(),
  );
  const index = (id: TerritoryId) => IDS.indexOf(id);
  const remaining = (from: number, to: number) => residual[from].get(to) ?? 0;
  const add = (from: number, to: number, capacity: number) => {
    residual[from].set(to, remaining(from, to) + Math.max(0, capacity));
    if (!residual[to].has(from)) residual[to].set(from, 0);
  };
  // Register every possible forward/reverse edge once. Capacities still become available in
  // dispatch order below; pre-registration lets BFS visit numeric neighbors without a matrix.
  IDS.forEach((_, i) => add(i, sinkNode, 0));
  add(sourceNode, agreementGateway, 0);
  edges.forEach((edge) => add(index(edge.from), index(edge.to), 0));
  sources.forEach((source, i) => {
    add(source.kind === "agreement" ? agreementGateway : sourceNode, 6 + i, 0);
    add(6 + i, index(source.territoryId), 0);
  });
  sinks.forEach((sink, i) => {
    const node = 6 + sources.length + i;
    add(index(sink.territoryId), node, 0);
    add(node, sinkNode, 0);
  });
  const neighbors = residual.map((row) =>
    [...row.keys()].sort((a, b) => a - b),
  );
  const push = (path: number[], watts: number) => {
    for (let i = 1; i < path.length; i++) {
      const remainingW = remaining(path[i - 1], path[i]);
      // A fully served path must not leave a few ULPs for a later, dirtier source to buy.
      residual[path[i - 1]].set(
        path[i],
        Math.max(0, remainingW - supplyAtDemandBoundary(watts, remainingW)),
      );
      residual[path[i]].set(
        path[i - 1],
        remaining(path[i], path[i - 1]) + watts,
      );
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
        for (const to of neighbors[from]) {
          if (previous[to] >= 0 || !(remaining(from, to) > 0)) continue;
          previous[to] = from;
          queue.push(to);
        }
      }
      if (previous[sinkNode] < 0) return;
      const path = [sinkNode];
      let watts = Infinity;
      while (path[0] !== sourceNode) {
        const from = previous[path[0]];
        watts = Math.min(watts, remaining(from, path[0]));
        path.unshift(from);
      }
      push(path, watts);
    }
  };
  IDS.forEach((id, i) => add(i, sinkNode, demandW[id]));
  // Contract purchases may free native generation for utility storage, but cannot exceed
  // customer load merely because storage or an export buyer can absorb more power.
  add(
    sourceNode,
    agreementGateway,
    IDS.reduce((sum, id) => sum + demandW[id], 0),
  );
  edges.forEach((edge) => {
    add(index(edge.from), index(edge.to), edge.capacityW);
    add(index(edge.to), index(edge.from), edge.capacityW);
  });
  const kinds = ["native", "agreement", "import", "spare"] as const;
  for (const kind of kinds) {
    sources.forEach((source, i) => {
      if (source.kind !== kind) return;
      const node = 6 + i;
      const territory = index(source.territoryId);
      const origin =
        source.kind === "agreement" ? agreementGateway : sourceNode;
      add(origin, node, source.capacityW);
      add(node, territory, source.capacityW);
      // Native fleets claim local load before sharing it. Agreements retain their caller's
      // dispatch priority, so a later local purchase cannot displace a reachable cheaper one.
      const localW = Math.min(
        remaining(origin, node),
        origin === agreementGateway
          ? remaining(sourceNode, agreementGateway)
          : Infinity,
        remaining(territory, sinkNode),
      );
      push(
        origin === agreementGateway
          ? [sourceNode, origin, node, territory, sinkNode]
          : [sourceNode, node, territory, sinkNode],
        localW,
      );
      if (kind === "agreement") augment();
    });
    if (kind !== "agreement") augment();
  }
  const servedW = Object.fromEntries(
    IDS.map((id, i) => [
      id,
      Math.max(0, Math.min(demandW[id], demandW[id] - remaining(i, sinkNode))),
    ]),
  ) as Record<TerritoryId, number>;
  // Freeze customer delivery. Lower-priority sinks can reroute existing deliveries, but cannot
  // take watts from an already-served customer or buy an agreement just to fill storage.
  IDS.forEach((_, i) => {
    residual[sinkNode].set(i, 0);
    residual[i].set(sinkNode, 0);
  });
  const agreementRemaining = sources.map((source, i) =>
    source.kind === "agreement" ? remaining(agreementGateway, 6 + i) : 0,
  );
  sources.forEach((source, i) => {
    if (source.kind === "agreement") residual[agreementGateway].set(6 + i, 0);
    if (
      source.kind !== "native" &&
      source.kind !== "spare" &&
      !(importToSinks && source.kind === "import")
    )
      residual[sourceNode].set(6 + i, 0);
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
    // Use already-produced surplus before burning additional fuel for a secondary sink.
    const spareRemaining = sources.map((source, i) =>
      source.kind === "spare" ? remaining(sourceNode, 6 + i) : 0,
    );
    sources.forEach((source, i) => {
      if (source.kind === "spare") residual[sourceNode].set(6 + i, 0);
    });
    augment();
    const allowAgreements = sinks.some(
      (sink) => (sink.priority ?? 0) === priority && sink.agreements,
    );
    if (allowAgreements) {
      sources.forEach((source, i) => {
        if (source.kind === "agreement") {
          residual[agreementGateway].set(6 + i, agreementRemaining[i]);
          augment();
        }
      });
      sources.forEach((source, i) => {
        if (source.kind === "agreement") {
          agreementRemaining[i] = remaining(agreementGateway, 6 + i);
          residual[agreementGateway].set(6 + i, 0);
        }
      });
    }
    sources.forEach((source, i) => {
      if (source.kind === "spare")
        residual[sourceNode].set(6 + i, spareRemaining[i]);
    });
    augment();
    sinks.forEach((sink, i) => {
      if ((sink.priority ?? 0) === priority)
        residual[6 + sources.length + i].set(sinkNode, 0);
    });
  }
  // Reverse residuals accumulate several paths and can round above the original capacity.
  const sourceW = sources.map((source, i) =>
    Math.max(
      0,
      Math.min(
        source.capacityW,
        remaining(
          6 + i,
          source.kind === "agreement" ? agreementGateway : sourceNode,
        ),
      ),
    ),
  );
  const sinkW = sinks.map((sink, i) =>
    Math.max(
      0,
      Math.min(sink.capacityW, remaining(sinkNode, 6 + sources.length + i)),
    ),
  );
  return {
    servedW,
    sourceW,
    sinkW,
    totalServedW: IDS.reduce((sum, id) => sum + servedW[id], 0),
    totalSinkW: sinkW.reduce((sum, watts) => sum + watts, 0),
    // Positive means the neighbor is sending power toward Champlain (edge.from).
    flows: edges.map((edge) => ({
      id: edge.id,
      watts: Math.max(
        -edge.capacityW,
        Math.min(
          edge.capacityW,
          remaining(index(edge.from), index(edge.to)) - edge.capacityW,
        ),
      ),
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
  spareSources = [],
}: {
  input: TerritoryDispatchInput;
  interfaces: readonly { territoryId: TerritoryId; offer: IntertieOffer }[];
  reservations: readonly IntertieReservation[];
  buyingRule: BuyingRuleType;
  sellingRule: SellingRuleType;
  spareSources?: readonly (TerritoryDispatchSource & { costPerMWh: number })[];
}) {
  const sources = [...input.sources];
  const sinks = [...(input.sinks ?? [])];
  const importSourceIndex = interfaces.map(() => -1);
  const exportSinkIndex = interfaces.map(() => -1);
  const spareSourceIndex = spareSources.map(() => -1);
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
    (watts, i) =>
      (sources[i].kind === "agreement" || sources[i].kind === "import") &&
      watts > 0,
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
      sinks.push({
        id: `export:${i}`,
        territoryId,
        capacityW,
        priority: 10 + i,
      });
      result = route();
      if (sellingRule === "PROFITABLE") {
        spareSources.forEach((source, j) => {
          if (!(offer.pricePerMWh > source.costPerMWh)) return;
          let sourceIndex = spareSourceIndex[j];
          if (sourceIndex < 0) {
            sourceIndex = sources.length;
            spareSourceIndex[j] = sourceIndex;
            sources.push({ ...source, kind: "spare" });
          } else sources[sourceIndex].capacityW = source.capacityW;
        });
        result = route();
        // A later cheap interface cannot unlock more of an expensive generator.
        for (const sourceIndex of spareSourceIndex)
          if (sourceIndex >= 0)
            sources[sourceIndex].capacityW = result.sourceW[sourceIndex];
        sinks[exportSinkIndex[i]].capacityW = result.sinkW[exportSinkIndex[i]];
      }
    });
  }
  return {
    result,
    sources,
    sinks,
    extraGenerationW: spareSources.map((_, i) =>
      spareSourceIndex[i] < 0 ? 0 : result.sourceW[spareSourceIndex[i]],
    ),
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
