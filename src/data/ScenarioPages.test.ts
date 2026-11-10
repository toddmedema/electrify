import fs from "fs";
import path from "path";
import { LEGACY_SCENARIOS, isLegacyCampaignScenario } from "./LegacyCampaign";
import { SCENARIOS } from "./Scenarios";

interface ScenarioPage {
  scenarioId: number;
  name: string;
  icon: string;
  startingYear: number;
  durationYears: number;
  kind?: "campaign";
}

const pages: ScenarioPage[] = JSON.parse(
  fs.readFileSync(path.resolve("site/scenarios.json"), "utf8"),
);
const official = [
  ...SCENARIOS.filter((scenario) => !scenario.tutorialSteps),
  ...LEGACY_SCENARIOS,
];

it("publishes one landing page for every official challenge and campaign generation", () => {
  expect(pages.map((page) => page.scenarioId).sort((a, b) => a - b)).toEqual(
    official.map((scenario) => scenario.id).sort((a, b) => a - b),
  );
});

it.each(official)(
  "keeps $name landing facts aligned with the game",
  (scenario) => {
    const page = pages.find((entry) => entry.scenarioId === scenario.id);
    expect(page).toMatchObject({
      name: scenario.name,
      icon: `/images/${scenario.icon.toLowerCase()}.svg`,
      startingYear: scenario.startingYear,
      durationYears: scenario.durationMonths / 12,
    });
    expect(page?.kind === "campaign").toBe(
      isLegacyCampaignScenario(scenario.id),
    );
  },
);
