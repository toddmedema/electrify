import cloneDeep from "lodash.clonedeep";
import { createGame } from "../testing/Simulator";
import type { TerritoryDispatchInput } from "./TerritoryDispatch";
import { territoryBalances } from "./TerritoryBalances";

it("reports each facility, source and sink once while retaining unserved demand and native curtailment", () => {
  const game = createGame({ scenarioId: 116, seed: 12345 });
  const plant = game.facilities[0];
  const facilities = [
    {
      ...plant,
      territoryId: "champlain" as const,
      currentW: 80,
      paused: false,
      yearsToBuildLeft: 0,
    },
    {
      ...plant,
      territoryId: "valley-electric" as const,
      currentW: 20,
      paused: false,
      yearsToBuildLeft: 0,
    },
    {
      ...plant,
      territoryId: "champlain" as const,
      currentW: 999,
      paused: true,
      yearsToBuildLeft: 0,
    },
    {
      ...plant,
      territoryId: "valley-electric" as const,
      currentW: 999,
      paused: false,
      yearsToBuildLeft: 1,
    },
  ];
  const demandW = {
    champlain: 40,
    "valley-electric": 35,
    "ridge-electric": 0,
    "green-uplands": 0,
  };
  const sources: TerritoryDispatchInput["sources"] = [
    { id: "native", territoryId: "champlain", capacityW: 80, kind: "native" },
    {
      id: "agreement",
      territoryId: "valley-electric",
      capacityW: 30,
      kind: "agreement",
    },
    { id: "import", territoryId: "champlain", capacityW: 10, kind: "import" },
    {
      id: "extra",
      territoryId: "valley-electric",
      capacityW: 20,
      kind: "spare",
    },
  ];
  const sinks = [
    { id: "charge:1", territoryId: "champlain" as const, capacityW: 10 },
    {
      id: "customer-battery:valley-electric",
      territoryId: "valley-electric" as const,
      capacityW: 5,
    },
    { id: "export:0", territoryId: "champlain" as const, capacityW: 25 },
    {
      id: "peer-export",
      territoryId: "valley-electric" as const,
      capacityW: 10,
    },
  ];
  const market = {
    sources: [...sources],
    sinks,
    result: {
      servedW: { ...demandW, "valley-electric": 30 },
      sourceW: [60, 30, 10, 20],
      sinkW: [10, 5, 25, 10],
      totalServedW: 70,
      totalSinkW: 50,
      flows: [],
    },
  };
  const before = cloneDeep({ facilities, demandW, market });
  expect(
    territoryBalances(
      ["champlain", "valley-electric"],
      facilities,
      demandW,
      market,
    ),
  ).toEqual({
    champlain: {
      demandW: 40,
      supplyW: 40,
      generationW: 80,
      importedW: 10,
      exportedW: 25,
      storageChargeW: 10,
      storageDischargeW: 0,
      unservedW: 0,
      curtailedW: 20,
    },
    "valley-electric": {
      demandW: 35,
      supplyW: 30,
      generationW: 20,
      importedW: 30,
      exportedW: 10,
      storageChargeW: 5,
      storageDischargeW: 0,
      unservedW: 5,
      curtailedW: 0,
    },
  });
  expect({ facilities, demandW, market }).toEqual(before);
});
