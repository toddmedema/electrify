import cloneDeep from "lodash.clonedeep";
import { modRuntimeDigest, validScenarioMod } from "../helpers/ScenarioMod";
import { getScenarioLocation } from "../helpers/Locations";
import { loadSimData } from "../testing/SimData";
import type { ScenarioType } from "../Types";
import {
  buildModAuthorReport,
  buildModPublication,
  modPlayerFacts,
} from "./ModAuthoring";
import { modResolvedSetup, modScenario } from "./ModScenario";
import { packageDigest } from "./ModSchema";
import { modPackage } from "../testing/ModFixtures";
import type { ModPackage } from "./ModSchema";

const pack = (): ModPackage =>
  modPackage({
    id: "authoring-boundaries",
    title: "Authoring boundaries",
    creator: "Fixture author",
    description: "Plan your grid around the announced repair.",
    seed: 1357,
    officialArcs: [],
    scenario: {
      startingYear: 2020,
      durationMonths: 6,
      startingCustomers: 10000,
      cash: 1e9,
      dollarsPerkWh: 0.2,
    },
    events: [
      {
        id: "announced-repair",
        title: "Announced repair",
        message: "Your announced repair increases costs.",
        preview: "Your announced repair will increase costs.",
        startMonth: 2,
        durationMonths: 1,
        visibility: "forecast",
        effects: { operatingExpenseDollarsPerMonth: 1234 },
      },
      {
        id: "private-turbine-loss",
        title: "Private turbine loss",
        message: "Your gas output falls unexpectedly.",
        startMonth: 5,
        durationMonths: 1,
        visibility: "surprise",
        effects: { outputMultipliersByFuel: { "Natural Gas": 0.371 } },
      },
    ],
  });

function prepared(input = pack()): ScenarioType {
  const location = getScenarioLocation(modResolvedSetup(input));
  if (!location) throw new Error("The fixture must have a resolved location.");
  loadSimData(location);
  return modScenario(input, undefined, "Employee");
}

const text = (value: unknown) => JSON.stringify(value);

test("players see declared facts without a surprise title, identity or mechanical schedule", () => {
  const scenario = prepared();
  const facts = modPlayerFacts(scenario);
  expect(text(facts.sections)).toContain("Announced repair");
  expect(text(facts.sections)).not.toMatch(
    /Private turbine loss|private-turbine-loss/,
  );
  expect(text(facts.sections)).not.toMatch(/37\.1|0\.371/);
  expect(facts.description).toBe(pack().description);
  expect(validScenarioMod(scenario.mod, scenario)).toBe(true);
  const announcedOnly = pack();
  announcedOnly.events = announcedOnly.events!.filter(
    (event) => event.visibility !== "surprise",
  );
  expect(facts.sections).toEqual(
    modPlayerFacts(prepared(announcedOnly)).sections,
  );
});

test("the author's report includes the same hidden rule that player facts exclude", () => {
  prepared();
  const input = pack();
  const original = cloneDeep(input);
  const report = buildModAuthorReport(input);
  expect(report.valid).toBe(true);
  expect(text(report.sections)).toContain("Announced repair");
  expect(text(report)).toContain("Private turbine loss");
  expect(input).toEqual(original);
});

test("an edited no-goals claim cannot hide actual required objectives under a recomputed digest", () => {
  const input = pack();
  input.objectives = [
    {
      id: "serve-demand",
      label: "Serve demand",
      metric: "monthlyReliability",
      fromMonth: 1,
      throughMonth: 6,
      minDemandServedShare: 0.99,
    },
  ];
  const valid = prepared(input);
  expect(validScenarioMod(valid.mod, valid)).toBe(true);
  const forged = cloneDeep(valid);
  forged.mod!.source.objectiveMode = "none";
  forged.mod!.runtimeDigest = modRuntimeDigest(forged.mod!);
  expect(validScenarioMod(forged.mod, forged)).toBe(false);
  expect(validScenarioMod(valid.mod, valid)).toBe(true);
});

test("an edited replacement claim cannot relabel inherited goal definitions", () => {
  const input = pack();
  input.baseScenarioId = 114;
  input.scenario = { cash: 1e9 };
  delete input.objectives;
  const valid = prepared(input);
  expect(valid.mod!.rules.objectives.some((goal) => goal.inherited)).toBe(true);
  expect(validScenarioMod(valid.mod, valid)).toBe(true);
  const forged = cloneDeep(valid);
  forged.mod!.source.objectiveMode = "replace";
  forged.mod!.runtimeDigest = modRuntimeDigest(forged.mod!);
  expect(validScenarioMod(forged.mod, forged)).toBe(false);
});

test("omitted goals inherit defaults and an explicit empty list clears them", () => {
  const objectiveRows = (["inherit", "replace"] as const).map((mode) => {
    const input = pack();
    if (mode === "replace") input.objectives = [];
    else delete input.objectives;
    const scenario = prepared(input);
    expect(scenario.mod!.rules.objectives).toEqual([]);
    const section = modPlayerFacts(scenario).sections.find(
      (candidate) => candidate.id === "objectives",
    );
    expect(section?.rows[0].label).toBe("Objective intent");
    return section!.rows[0].value;
  });
  expect(new Set(objectiveRows).size).toBe(2);
});

test("reported inherited goals are valid replacement JSON with the same resolved measurements", () => {
  const input = pack();
  input.baseScenarioId = 114;
  input.scenario = { startingYear: 2040, cash: 1e9 };
  delete input.objectives;
  const inherited = prepared(input);
  const report = buildModAuthorReport(input);
  expect(report.valid).toBe(true);
  expect(report.inheritedObjectives.length).toBeGreaterThan(0);
  const replacement = prepared({
    ...input,
    objectives: report.inheritedObjectives,
  });
  expect(validScenarioMod(replacement.mod, replacement)).toBe(true);
  expect(replacement.mod!.rules.objectives).toEqual(
    inherited.mod!.rules.objectives.map(
      ({ inherited: _inherited, ...goal }) => goal,
    ),
  );
});

test("publication contains public rules and the author's description without exposing a hidden mechanic", () => {
  const input = pack();
  prepared(input);
  const published = buildModPublication(input);
  expect(published.packageDigest).toBe(packageDigest(input));
  expect(
    published.description.startsWith(`${input.description}\n\nRules\n`),
  ).toBe(true);
  expect(published.description).toContain("Announced repair");
  expect(published.description).not.toMatch(
    /Private turbine loss|private-turbine-loss|37\.1|0\.371/,
  );
  const announcedOnly = cloneDeep(input);
  announcedOnly.events = announcedOnly.events!.filter(
    (event) => event.visibility !== "surprise",
  );
  expect(buildModPublication(announcedOnly).description).toBe(
    published.description,
  );
});

test("each publication rebuilds changed public dates, effects and description with its current package identity", () => {
  const input = pack();
  prepared(input);
  const before = buildModPublication(input);
  input.version = "2";
  input.description = "Plan your grid around the revised investment.";
  const event = input.events![0];
  event.title = "Announced replacement investment";
  event.preview = "Your revised investment will increase costs.";
  event.startMonth = 3;
  event.effects!.operatingExpenseDollarsPerMonth = 4321;
  const after = buildModPublication(input);
  expect(after.packageDigest).toBe(packageDigest(input));
  expect(after.packageDigest).not.toBe(before.packageDigest);
  expect(after.description.startsWith(`${input.description}\n\nRules\n`)).toBe(
    true,
  );
  expect(after.description).toContain(event.title);
  expect(after.description).toContain(event.preview);
  expect(after.description).not.toContain("Announced repair");
  const timeline = modPlayerFacts(prepared(input)).sections.find(
    (section) => section.id === "timeline",
  )!;
  expect(timeline.rows).toHaveLength(1);
  expect(after.description).toContain(timeline.rows[0].label);
  expect(after.description).not.toBe(before.description);
});

test("a valid package warning does not block publication of its actual objectives", () => {
  const input = pack();
  input.objectives = [
    {
      id: "retire-coal",
      label: "Retire coal",
      metric: "fuelRetirement",
      fuel: "Coal",
      deadlineMonth: 6,
    },
  ];
  prepared(input);
  const report = buildModAuthorReport(input);
  expect(report.valid).toBe(true);
  expect(
    report.diagnostics.some((diagnostic) => diagnostic.severity === "warning"),
  ).toBe(true);
  expect(buildModPublication(input).description).toContain("Retire coal");
});

test("invalid mechanical values cannot reach public publication, while a valid output neighbor can", () => {
  const input = pack();
  prepared(input);
  const invalid = cloneDeep(input);
  invalid.events![1].effects!.outputMultipliersByFuel!["Natural Gas"] = 1.01;
  const original = cloneDeep(invalid);
  expect(() => buildModPublication(invalid)).toThrow(/outputMultipliersByFuel/);
  expect(invalid).toEqual(original);
  input.events![1].effects!.outputMultipliersByFuel!["Natural Gas"] = 1;
  expect(() => buildModPublication(input)).not.toThrow();
});
