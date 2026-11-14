import type { TerritoryId } from "../Types";
import {
  routeTerritoryPower,
  type TerritoryDispatchInput,
} from "./TerritoryDispatch";

const ids: TerritoryId[] = [
  "champlain",
  "valley-electric",
  "ridge-electric",
  "green-uplands",
];
function fixture(count: number): TerritoryDispatchInput {
  return {
    demandW: {
      champlain: 450e6,
      "valley-electric": 150e6,
      "ridge-electric": 200e6,
      "green-uplands": 0,
    },
    edges: ids
      .slice(1)
      .map((to, i) => ({
        id: i,
        from: ids[0],
        to,
        capacityW: [100e6, 60e6, 120e6][i],
      })),
    sources: Array.from({ length: count }, (_, i) => ({
      id: `source:${i}`,
      territoryId: ids[i % (i < count / 2 ? 4 : 3)],
      kind:
        i < count / 2
          ? "native"
          : i < (count * 3) / 4
            ? "agreement"
            : i < (count * 7) / 8
              ? "import"
              : "spare",
      capacityW:
        i < count / 2
          ? 800e6 / count
          : i < (count * 3) / 4
            ? 1280e6 / count
            : i < (count * 7) / 8
              ? 1600e6 / count
              : 640e6 / count,
    })),
    sinks: ids.map((territoryId, i) => ({
      id: `sink:${i}`,
      territoryId,
      capacityW: 50e6,
      priority: i % 2,
      agreements: i < 2,
    })),
    importToSinks: true,
  };
}

it("retains source order, customer delivery and secondary-sink priorities for a legacy-sized fleet", () => {
  // Existing saves may contain more plants than the new site budgets permit building.
  const input = fixture(128);
  const before = JSON.parse(JSON.stringify(input));
  const result = routeTerritoryPower(input);
  expect(result).toEqual({
    servedW: input.demandW,
    sourceW: [
      ...Array<number>(64).fill(6.25e6),
      ...Array<number>(32).fill(10e6),
      ...Array<number>(16).fill(12.5e6),
      ...Array<number>(15).fill(5e6),
      2.5e6,
    ],
    sinkW: [50e6, 50e6, 50e6, 47.5e6],
    totalServedW: 800e6,
    totalSinkW: 197.5e6,
    flows: [
      { id: 0, watts: 100e6 },
      { id: 1, watts: 47.5e6 },
      { id: 2, watts: 52.5e6 },
    ],
  });
  expect(result.sourceW.reduce((sum, watts) => sum + watts, 0)).toBe(
    result.totalServedW + result.totalSinkW,
  );
  expect(input).toEqual(before);
});
