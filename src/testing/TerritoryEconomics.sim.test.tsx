import { GREEN_UPLANDS_CORRIDOR_ID } from "../data/Territories";
import { DIFFICULTY_IDS } from "../Constants";
import {
  EXPANSION_BALANCE_CASES,
  expansionBalanceActions,
} from "./UtilityExpansionBalanceFixtures";
import { expectNoViolations } from "./SimulationTestHelpers";
import { runSimulation, type ScheduledSimActionType } from "./Simulator";

jest.setTimeout(180000);

it.each(DIFFICULTY_IDS)(
  "supports developing new wind land alongside a prepared acquisition at %s",
  (difficulty) => {
    const fixture = EXPANSION_BALANCE_CASES.find(
      ({ id }) => id === "valley-electric-firm-loan",
    )!;
    const actions: ScheduledSimActionType[] = [
      ...expansionBalanceActions(fixture, 12345),
      {
        month: 0,
        type: "intertie",
        corridorId: GREEN_UPLANDS_CORRIDOR_ID,
        financed: true,
      },
      {
        month: 48,
        type: "build",
        build: {
          name: "Wind",
          peakW: 100e6,
          financed: true,
          territoryId: "green-uplands",
        },
      },
    ];
    actions.sort((left, right) => left.month - right.month);
    const result = runSimulation({
      scenarioId: 116,
      seed: 12345,
      difficulty,
      scheduledActions: actions,
    });
    expectNoViolations(result);
    expect(result.outcome).toBe("completed");
    expect(result.months).toHaveLength(240);
    expect(result.builds).toHaveLength(
      actions.filter((action) => action.type === "build").length,
    );
    expect(result.finalUtilityExpansion!.acquisitions).toHaveLength(1);
    const wind = result.finalFacilities.find(
      (facility) => facility.territoryId === "green-uplands",
    );
    expect(wind).toMatchObject({
      fuel: "Wind",
      peakW: 100e6,
      yearsToBuildLeft: 0,
    });
    expect(wind!.lifetimeWh).toBeGreaterThan(0);
    expect(
      result.finalTransmissionLines.find(
        (line) => line.corridorId === GREEN_UPLANDS_CORRIDOR_ID,
      ),
    ).toMatchObject({ capacityW: 120e6, yearsToBuildLeft: 0 });
  },
);
