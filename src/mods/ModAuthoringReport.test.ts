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

test("the common author report has all difficulty values, actual peak and additive/static monthly ranges", () => {
  const pack = prepared();
  pack.facilities = { "Natural Gas Peaker": { buildCost: 2 } };
  const report = buildModAuthorReport(pack);
  expect(report.valid).toBe(true);
  expect(Object.keys(report.difficulties).sort()).toEqual(
    [...DIFFICULTY_IDS].sort(),
  );
  for (const facts of Object.values(report.difficulties)) {
    const peak = facts!.sections
      .find((s) => s.id === "setup")!
      .rows.find((r) => r.label === "Starting peak demand")!.value;
    expect(peak).toMatch(/^[1-9][\d,.]* MW$/);
    const monthly = facts!.sections.find((s) => s.id === "monthly")!.rows;
    expect(monthly).toHaveLength(6);
    expect(monthly[0].value).toContain(
      "buildCostMultipliersByFuel.Natural Gas.Natural Gas Peaker: ×2–2",
    );
    expect(monthly[1].value).toContain(
      "buildCostMultipliersByFuel.Natural Gas.Natural Gas Peaker: ×1.8–1.8",
    );
    expect(monthly[1].value).toContain("temperatureOffsetC: 1–1 °C");
    expect(monthly[1].value).toContain(
      "operatingExpensePerMonth: 1,000–1,000 starting-year dollars/month",
    );
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
  expect(monthly[1].value).toContain("temperatureOffsetC: -3–5 °C");
  expect(monthly[0].value).not.toContain("temperatureOffsetC");
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
