import { PEER_CORRIDOR_DERATE } from "../data/Multiplayer";
import { transmissionRatingFactor } from "../helpers/Transmission";
import type { PeerPlan, PeerSettlement } from "../Types";
import type { Edge } from "./Types";

const EPS = 0.001;
interface Arc {
  to: number;
  reverse: number;
  left: number;
  initial: number;
}
function network(size: number) {
  const graph: Arc[][] = Array.from({ length: size }, () => []);
  const add = (from: number, to: number, capacity: number) => {
    const arc = {
      to,
      reverse: graph[to].length,
      left: capacity,
      initial: capacity,
    };
    graph[from].push(arc);
    graph[to].push({
      to: from,
      reverse: graph[from].length - 1,
      left: 0,
      initial: 0,
    });
    return arc;
  };
  const flow = (source: number, sink: number) => {
    let total = 0;
    for (;;) {
      const seen = new Set<number>();
      const visit = (node: number, available: number): number => {
        if (node === sink) return available;
        seen.add(node);
        for (const arc of graph[node]) {
          if (arc.left <= EPS || seen.has(arc.to)) continue;
          const sent = visit(arc.to, Math.min(available, arc.left));
          if (sent > EPS) {
            arc.left -= sent;
            graph[arc.to][arc.reverse].left += sent;
            return sent;
          }
        }
        return 0;
      };
      const sent = visit(source, Number.MAX_SAFE_INTEGER);
      if (sent <= EPS) return total;
      total += sent;
    }
  };
  return { add, flow };
}

/** Maximum delivered energy, then lexicographic max-min shortage coverage.
 * Lower-bounded circulation preserves the maximum while testing fair allocations;
 * residual paths can reroute an earlier assignment instead of stranding supply.
 */
export function clearPeerMarket(
  ids: string[],
  plans: PeerPlan[],
  edges: Edge[],
): PeerSettlement[] {
  const n = ids.length;
  const source = n * 2,
    sink = source + 1,
    superSource = sink + 1,
    superSink = superSource + 1;
  const offers = plans.map((p) =>
    p.shortageW > EPS ? 0 : Math.max(0, p.offerW),
  );
  const demands = plans.map((p) => Math.max(0, p.shortageW));
  const ratings = edges.map((edge) => {
    const a = plans[ids.indexOf(edge.a)],
      b = plans[ids.indexOf(edge.b)];
    const factor = (p: PeerPlan) =>
      transmissionRatingFactor(PEER_CORRIDOR_DERATE, p);
    return edge.disabled ? 0 : edge.capacityW * Math.min(factor(a), factor(b));
  });
  const create = (
    minimum: number[],
    exact: Map<number, number>,
    total?: number,
  ) => {
    const net = network(superSink + 1);
    const balance = Array(superSink + 1).fill(0) as number[];
    const bounded = (
      from: number,
      to: number,
      lower: number,
      upper: number,
    ) => {
      const arc = net.add(from, to, Math.max(0, upper - lower));
      balance[from] -= lower;
      balance[to] += lower;
      return { arc, lower };
    };
    const buyers = [];
    for (let i = 0; i < n; i++) {
      bounded(source, i, 0, offers[i]);
      buyers.push(
        bounded(
          i + n,
          sink,
          exact.get(i) ?? minimum[i],
          exact.get(i) ?? demands[i],
        ),
      );
    }
    const links = edges.map((edge, index) => {
      const a = ids.indexOf(edge.a),
        b = ids.indexOf(edge.b);
      return [
        bounded(a, b + n, 0, ratings[index]),
        bounded(b, a + n, 0, ratings[index]),
      ];
    });
    if (total === undefined)
      return { total: net.flow(source, sink), links, buyers };
    bounded(sink, source, total, total);
    let required = 0;
    balance.forEach((value, node) => {
      if (value > EPS) {
        net.add(superSource, node, value);
        required += value;
      } else if (value < -EPS) net.add(node, superSink, -value);
    });
    return {
      total:
        net.flow(superSource, superSink) >= required - EPS * 4 ? total : -1,
      links,
      buyers,
    };
  };
  const zeros = Array(n).fill(0) as number[];
  const total = create(zeros, new Map()).total;
  const fixed = new Map<number, number>();
  let minimum = [...zeros];
  for (
    let pass = 0;
    pass < n && fixed.size < demands.filter((d) => d > EPS).length;
    pass++
  ) {
    let low = 0,
      high = 1;
    for (let iteration = 0; iteration < 40; iteration++) {
      const fraction = (low + high) / 2;
      const target = demands.map((d, i) => fixed.get(i) ?? d * fraction);
      if (create(target, fixed, total).total >= 0) low = fraction;
      else high = fraction;
    }
    minimum = demands.map(
      (d, i) => fixed.get(i) ?? Math.max(0, d * low - EPS * 8),
    );
    const witness = create(minimum, fixed, total);
    let froze = false;
    for (let i = 0; i < n; i++) {
      if (demands[i] <= EPS || fixed.has(i)) continue;
      const trial = [...minimum];
      trial[i] += Math.max(0.1, demands[i] * 1e-6);
      if (trial[i] > demands[i] || create(trial, fixed, total).total < 0) {
        const { arc, lower } = witness.buyers[i];
        fixed.set(i, arc.initial - arc.left + lower);
        froze = true;
      }
    }
    if (!froze) break;
  }
  // The fair allocation is checked within floating-point tolerances. If those ever reject the
  // final assignment, deliver the plain maximum flow: it still respects every offer, shortage
  // and line rating, and a fairness rounding miss must not stop the whole match.
  const fair = create(minimum, fixed, total);
  const result = fair.total >= 0 ? fair : create(zeros, new Map());
  const settlements = ids.map(() => ({
    importedW: 0,
    exportedW: 0,
    importEmissionsKgPerMWh: 0,
  }));
  const amounts = result.links.map((pair) =>
    pair.map(({ arc, lower }) => Math.max(0, arc.initial - arc.left + lower)),
  );
  edges.forEach((edge, index) => {
    const a = ids.indexOf(edge.a),
      b = ids.indexOf(edge.b);
    edge.ratingW = ratings[index];
    edge.flowW = amounts[index][0] - amounts[index][1];
    const seller = edge.flowW >= 0 ? a : b,
      buyer = seller === a ? b : a;
    const watts = Math.abs(edge.flowW);
    settlements[seller].exportedW += watts;
    settlements[buyer].importedW += watts;
  });
  edges.forEach((edge) => {
    const a = ids.indexOf(edge.a),
      b = ids.indexOf(edge.b);
    const seller = edge.flowW >= 0 ? a : b,
      buyer = seller === a ? b : a;
    const intensity = plans[seller].emissionsAt(settlements[seller].exportedW);
    settlements[buyer].importEmissionsKgPerMWh +=
      Math.abs(edge.flowW) * intensity;
  });
  settlements.forEach((s) => {
    if (s.importedW > 0) s.importEmissionsKgPerMWh /= s.importedW;
  });
  return settlements;
}
