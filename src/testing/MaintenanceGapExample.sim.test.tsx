import fs from "fs";
import path from "path";
import { MINUTES_PER_MONTH } from "../helpers/DateTime";
import { interpretRuleReport } from "../helpers/ScenarioRuleReports";
import { runModSimulation } from "./ModCli";

const pack = JSON.parse(
  fs.readFileSync(
    path.resolve(
      __dirname,
      "../../docs/mods/examples/bridge-the-maintenance-gap.json",
    ),
    "utf8",
  ),
);
const responses = (optionId: string) => ({
  responses: [{ choiceId: "overhaul-schedule", optionId }],
});

jest.setTimeout(120000);

for (const optionId of ["accelerate", "standard"] as const) {
  test(`maintenance example: ${optionId} wins with reserve on Easy and Medium across both seeds`, () => {
    const runs = runModSimulation(pack, {
      responses: responses(optionId),
      seeds: [609, 610],
      difficulties: ["Employee", "Manager"],
      simulation: {
        initialBuild: {
          name: "Oil",
          peakW: 50e6,
          financed: true,
          priority: "reserve",
        },
        dollarsPerkWh: 0.12,
      },
    });
    expect(runs).toHaveLength(4);
    for (const run of runs) {
      expect(run.outcome).toBe("completed");
      expect(run.outcomeMonth).toBe(24);
      expect(run.warnings).toEqual([]);
      expect(run.responses).toEqual([
        {
          choiceId: "overhaul-schedule",
          optionId,
          month: 7,
          automatic: false,
          fallback: false,
        },
      ]);
      expect(run.objectiveResults).toHaveLength(2);
      expect(
        run.objectiveResults.every((goal) => goal.status === "completed"),
      ).toBe(true);
      expect(run.result.violations).toEqual([]);
      expect(run.result.builds).toHaveLength(1);
      expect(run.result.finalFacilities).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            name: "Oil",
            peakW: 50e6,
            yearsToBuildLeft: 0,
          }),
        ]),
      );
      const reports = run.result.scenario.mod!.rules.debriefReports.map(
        (report) =>
          interpretRuleReport(report, {
            startingYear: run.result.scenario.startingYear,
            completedMonths: run.result.months.length,
            monthlyHistory: run.result.months,
          }),
      );
      expect(reports.map((report) => report.kind).sort()).toEqual([
        "profitLoss",
        "reliability",
      ]);
      expect(reports.every((report) => report.available)).toBe(true);
      expect(
        reports.find((report) => report.kind === "reliability")!.attributes
          .reliability,
      ).toBeGreaterThanOrEqual(0.995);
      const receipt = run.result.storyOccurrences.find(
        (event) =>
          event.key === `mod:bridge-the-maintenance-gap:${optionId}-overhaul`,
      );
      expect(receipt).toMatchObject({
        startsMinute: 12 * MINUTES_PER_MONTH,
        endsMinute: (optionId === "accelerate" ? 15 : 18) * MINUTES_PER_MONTH,
        attributes: { selectedFacilityIds: [1], affectedFacilityCount: 1 },
        effects: { facilityOutputMultipliersById: { 1: 0 } },
      });
      expect(run.result.storyOccurrences).toContainEqual(
        expect.objectContaining({
          key: `mod:bridge-the-maintenance-gap:${optionId}-overhaul:end`,
          startsMinute:
            (optionId === "accelerate" ? 15 : 18) * MINUTES_PER_MONTH,
          effects: {},
        }),
      );
      expect(run.result.storyOccurrences).not.toContainEqual(
        expect.objectContaining({
          key: `mod:bridge-the-maintenance-gap:${optionId === "accelerate" ? "standard" : "accelerate"}-overhaul`,
        }),
      );
      expect(run.result.storyOccurrences).toContainEqual(
        expect.objectContaining({
          key: "mod:bridge-the-maintenance-gap:overhaul-schedule",
          attributes: expect.objectContaining({
            cost: optionId === "accelerate" ? 3000000 : 0,
            upfrontGrant: optionId === "standard" ? 2000000 : 0,
          }),
        }),
      );
      expect(
        run.result.months.reduce((sum, month) => sum + month.revenueGrants, 0),
      ).toBe(optionId === "standard" ? 2000000 : 0);
    }
  });
}

test("neglecting reserve fails the example's unchanged maintenance reliability goal", () => {
  const [run] = runModSimulation(pack, {
    responses: responses("standard"),
    simulation: { dollarsPerkWh: 0.12 },
  });
  expect(run.result.violations).toEqual([]);
  expect(run.result.builds).toEqual([]);
  expect(run.outcome).toBe("fired");
  expect(run.outcomeMonth).toBe(18);
  expect(run.objectiveResults).toContainEqual(
    expect.objectContaining({
      id: "maintenance-service",
      status: "failed",
    }),
  );
});
