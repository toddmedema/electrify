import fs from "fs";
import path from "path";
import { buildModAuthorReport, modPlayerFacts } from "./ModAuthoring";
import { createModRecipes } from "./ModRecipes";
import { validateMod } from "./ModSchema";
import { modResolvedSetup, modScenario } from "./ModScenario";
import { loadSimData } from "../testing/SimData";
import { getScenarioLocation } from "../helpers/Locations";
import { DIFFICULTY_IDS } from "../Constants";

function prepared() {
  const pack = validateMod(createModRecipes().effects);
  const location = getScenarioLocation(modResolvedSetup(pack));
  if (!location)
    throw new Error("The author recipe requires a bundled location");
  loadSimData(location);
  return pack;
}

test("monthly author facts preserve alternative selector windows and choice conditions", () => {
  const pack = validateMod(
    JSON.parse(
      fs.readFileSync(
        path.resolve(
          __dirname,
          "../../docs/mods/examples/bridge-the-maintenance-gap.json",
        ),
        "utf8",
      ),
    ),
  );
  loadSimData(getScenarioLocation(modResolvedSetup(pack))!);
  const report = buildModAuthorReport(pack);
  expect(report.valid).toBe(true);
  const months = report.sections.find(
    (section) => section.id === "monthly",
  )!.rows;
  expect(months).toHaveLength(4);
  expect(months.map((row) => row.label)).toEqual([
    "Months 1–12 · Jan 2020–Dec 2020",
    "Months 13–15 · Jan 2021–Mar 2021",
    "Months 16–18 · Apr 2021–Jun 2021",
    "Months 19–24 · Jul 2021–Dec 2021",
  ]);
  expect(months[0].value).not.toContain("overhaul");
  expect(months[1].value).toContain("accelerate-overhaul, standard-overhaul");
  expect(months[2].value).toContain("standard-overhaul");
  expect(months[2].value).not.toContain("accelerate-overhaul");
  expect(months[3].value).not.toContain("overhaul");
  const targets = report.sections.find(
    (section) => section.id === "selectors",
  )!.rows;
  expect(targets).toHaveLength(2);
  for (const [index, through, option] of [
    [0, 15, "Accelerate the overhaul"],
    [1, 18, "Accept standard-schedule support"],
  ] as const) {
    expect(targets[index].value).toContain(`Months 13–${through}`);
    expect(targets[index].value).toContain(option);
    expect(targets[index].details).toEqual([
      expect.stringContaining("0% output"),
    ]);
    expect(targets[index].details![0]).toContain(
      "scenario-106-natural-gas-peaker",
    );
    expect(targets[index].details![0]).toContain("replacements are unaffected");
  }
  expect(report.sections.every((section) => section.rows.length)).toBe(true);
});

test("monthly selector facts describe seeded possible windows without inventing dynamic targets", () => {
  const pack = prepared();
  pack.events = [
    {
      id: "seeded-overhaul",
      title: "Seeded overhaul",
      message: "Your largest operating generator loses output.",
      preview: "Your largest operating generator will lose output.",
      startMonth: { from: 2, to: 3 },
      durationMonths: 2,
      effects: {
        outputMultipliersBySelector: [
          { target: { selector: "largestOperating" }, outputMultiplier: 0.5 },
        ],
      },
    },
  ];
  const report = buildModAuthorReport(pack);
  expect(report.valid).toBe(true);
  const months = report.sections.find(
    (section) => section.id === "monthly",
  )!.rows;
  expect(months).toHaveLength(5);
  expect(months[0].value).not.toContain("seeded-overhaul");
  expect(months[4].label).toContain("Months 5–6");
  expect(months[4].value).not.toContain("seeded-overhaul");
  expect(months[1].value).toContain("Possible output limits: seeded-overhaul");
  expect(months[2].value).toBe("Output limits: seeded-overhaul");
  expect(months[3].value).toContain("Possible output limits: seeded-overhaul");
  const target = report.sections.find((section) => section.id === "selectors")!
    .rows[0];
  expect(target.value).toContain("Months 2–4");
  expect(target.details).toEqual([
    expect.stringContaining(
      "50% output · Largest operating generator at onset",
    ),
  ]);
});

test("large author reports retain complete selector declarations without repeating them every month", () => {
  const pack = prepared();
  pack.scenario = { ...pack.scenario, durationMonths: 120 };
  pack.choices = [
    {
      id: "maintenance-plan",
      title: "Choose maintenance",
      prompt: "Choose a maintenance schedule.",
      dueMonth: 1,
      options: [
        {
          id: "funded",
          label: "Funded",
          description: "Receive support.",
          message: "Support received.",
          grantDollars: 1000,
        },
        {
          id: "standard",
          label: "Standard",
          description: "Keep the standard schedule.",
          message: "Standard schedule kept.",
          costDollars: 0,
        },
      ],
    },
  ];
  pack.events = Array.from({ length: 10 }, (_, event) => ({
    id: `maintenance-${event}`,
    title: `Maintenance ${event}`,
    message: "Selected generators have reduced output.",
    preview: "Selected generators will have reduced output.",
    startMonth: event === 9 ? { from: 1, to: 3 } : 1,
    durationMonths: "untilEnd" as const,
    requiresChoice: {
      choiceId: "maintenance-plan",
      optionIds: [event % 2 ? "funded" : "standard"],
    },
    effects: {
      outputMultipliersBySelector: Array.from({ length: 10 }, (_, target) => ({
        target: {
          selector: "operatingAtLeastAge" as const,
          fuel: "Natural Gas" as const,
          minAgeYears: target,
        },
        outputMultiplier: target / 10,
      })),
    },
  }));
  const report = buildModAuthorReport(pack);
  expect(
    report.diagnostics.filter(({ severity }) => severity === "error"),
  ).toEqual([]);
  expect(Object.keys(report.difficulties)).toHaveLength(5);
  // This valid workload previously serialized to more than 16 MB of repeated prose.
  expect(Buffer.byteLength(JSON.stringify(report), "utf8")).toBeLessThan(
    1000000,
  );
  for (const facts of Object.values(report.difficulties)) {
    const definitions = facts!.sections.find(
      ({ id }) => id === "selectors",
    )!.rows;
    expect(definitions).toHaveLength(10);
    for (let event = 0; event < 10; event++) {
      expect(definitions[event].label).toContain(`maintenance-${event}`);
      expect(definitions[event].value).toContain(
        `If Choose maintenance: ${event % 2 ? "Funded" : "Standard"}`,
      );
      expect(definitions[event].value).toContain("Months 1–120");
      expect(definitions[event].details).toHaveLength(10);
      for (let target = 0; target < 10; target++)
        expect(definitions[event].details![target]).toContain(
          `${target * 10}% output · All operating Natural Gas generators aged at least ${target} years at onset.`,
        );
    }
    const monthly = facts!.sections.find(({ id }) => id === "monthly")!.rows;
    expect(monthly).toHaveLength(2);
    expect(monthly[0].label).toContain("Months 1–2");
    expect(monthly[1].label).toContain("Months 3–120");
    for (const row of monthly.slice(1)) {
      expect(row.value).toContain(
        "Output limits: maintenance-0, maintenance-1, maintenance-2, maintenance-3, maintenance-4, maintenance-5, maintenance-6, maintenance-7, maintenance-8, maintenance-9",
      );
      expect(row.value).not.toContain("at onset");
    }
    for (const row of monthly.slice(0, 1)) {
      expect(row.value).toContain(
        "Output limits: maintenance-0, maintenance-1, maintenance-2, maintenance-3, maintenance-4, maintenance-5, maintenance-6, maintenance-7, maintenance-8",
      );
      expect(row.value).toContain(
        "Possible output limits: maintenance-9 (start varies)",
      );
    }
    expect(monthly[1].value).not.toContain("start varies");
  }
});

test("the common author report has all difficulty values, actual peak and additive/static monthly ranges", () => {
  const pack = prepared();
  pack.facilities = { "Natural Gas Peaker": { buildCost: 2 } };
  const report = buildModAuthorReport(pack);
  expect(report.valid).toBe(true);
  expect(Object.keys(report.difficulties).sort()).toEqual(
    [...DIFFICULTY_IDS].sort(),
  );
  for (const facts of Object.values(report.difficulties)) {
    expect(
      facts!.sections.find((section) => section.id === "modifiers")!.rows[0]
        .value,
    ).toContain("applies to starting facilities and future purchases");
    const peak = facts!.sections
      .find((s) => s.id === "setup")!
      .rows.find((r) => r.label === "Starting peak demand")!.value;
    expect(peak).toMatch(/^[1-9][\d,.]* MW$/);
    const monthly = facts!.sections.find((s) => s.id === "monthly")!.rows;
    expect(monthly).toHaveLength(3);
    expect(monthly[0].value).toContain(
      "Natural Gas Peaker construction cost: ×2",
    );
    expect(monthly[1].value).toContain(
      "Natural Gas Peaker construction cost: ×1.8",
    );
    expect(monthly[1].value).toContain("Temperature: 1 °C");
    expect(monthly[1].value).toContain("Operating expense: $1,000/month");
  }
});

test("independent semantic compilation errors become an invalid report rather than a thrown snapshot error", () => {
  const pack = prepared();
  pack.events![0].effects!.hydroInflowMultiplier = 0.05;
  const report = buildModAuthorReport(pack);
  expect(report.valid).toBe(false);
  expect(report.diagnostics).toContainEqual(
    expect.objectContaining({ code: "composed-factor", severity: "error" }),
  );
  expect(
    report.sections.find((s) => s.id === "difficulties")!.rows,
  ).toHaveLength(5);
});

test("author report additive ranges retain mutually exclusive choice branches", () => {
  const pack = prepared();
  const choices = validateMod(createModRecipes().choices);
  pack.choices = choices.choices!.map((choice) => ({
    ...choice,
    options: choice.options.map(
      ({ replaceLoad: _replaceLoad, ...option }) => option,
    ),
  }));
  pack.events = [
    {
      ...pack.events![0],
      id: "warm",
      requiresChoice: { choiceId: "funding", optionIds: ["accept"] },
      effects: { temperatureOffsetC: 5 },
    },
    {
      ...pack.events![0],
      id: "cool",
      requiresChoice: { choiceId: "funding", optionIds: ["decline"] },
      effects: { temperatureOffsetC: -3 },
    },
  ];
  pack.choices[0].options.forEach((option) => delete option.eventIds);
  const report = buildModAuthorReport(pack);
  expect(report.valid).toBe(true);
  const monthly = report.sections.find((s) => s.id === "monthly")!.rows;
  expect(monthly[1].value).toContain("Temperature: -3–5 °C");
  expect(monthly[0].value).not.toContain("Temperature:");
});

test("player diagnostics cannot disclose a surprise through a real truncated-window warning", () => {
  const pack = prepared();
  pack.events = [
    {
      id: "private-turbine-loss",
      title: "Private turbine loss",
      message: "Your gas output falls unexpectedly.",
      startMonth: 5,
      durationMonths: 3,
      visibility: "surprise",
      effects: { outputMultipliersByFuel: { "Natural Gas": 0.371 } },
    },
  ];
  const report = buildModAuthorReport(pack);
  expect(report.valid).toBe(true);
  expect(report.diagnostics).toContainEqual(
    expect.objectContaining({
      code: "truncated-event",
      message: expect.stringContaining("Private turbine loss"),
    }),
  );
  const facts = modPlayerFacts(modScenario(pack, undefined, "Employee"), {
    diagnostics: report.diagnostics,
  });
  expect(JSON.stringify(facts)).not.toMatch(
    /Private turbine loss|private-turbine-loss|37\.1|0\.371/,
  );
  expect(facts.diagnostics).toContainEqual(
    expect.objectContaining({ severity: "warning" }),
  );
  expect(JSON.stringify(report.diagnostics)).toContain("Private turbine loss");
  expect(JSON.stringify(report)).toContain("0.371");
});
