import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { modScenario } from "../../mods/ModScenario";
import type { ModPackage } from "../../mods/ModSchema";
import { buildModAuthorReport } from "../../mods/ModAuthoring";
import { loadSimData } from "../../testing/SimData";
import ModDetails, { ModFacts } from "./ModDetails";

const pack: ModPackage = {
  schemaVersion: 1,
  gameApi: 1,
  id: "read-the-rules",
  title: "Read the rules",
  creator: "Fixture author",
  version: "1",
  description: "Your grid prepares for changing fuel costs.",
  seed: 42,
  baseScenarioId: 999,
  officialArcs: [],
  scenario: { durationMonths: 6, startingYear: 2020 },
  objectives: {
    mode: "replace",
    items: [
      {
        id: "serve-demand",
        label: "Serve demand",
        metric: "monthlyReliability",
        fromMonth: 1,
        throughMonth: 6,
        minDemandServedShare: 0.99,
      },
    ],
  },
  facilities: { Solar: { buildCost: 0.8 } },
  events: [
    {
      id: "announced",
      title: "Announced fuel support",
      message: "Fuel prices fall.",
      preview: "Fuel prices will fall.",
      startMonth: 2,
      durationMonths: 2,
      effects: { fuelPriceMultipliers: { "Natural Gas": 0.8 } },
    },
    {
      id: "private",
      title: "Private fuel shock",
      message: "A private fuel shock arrives.",
      visibility: "surprise",
      startMonth: 4,
      durationMonths: 1,
      effects: { fuelPriceMultipliers: { "Natural Gas": 1.2 } },
    },
  ],
};

beforeAll(() => loadSimData("SF"));

test("player details separate author claims from engine facts and hide surprise rules", async () => {
  const scenario = modScenario(pack, undefined, "Employee");
  render(<ModDetails scenario={scenario} objectiveIntent="replace" />);
  expect(
    screen.getByRole("region", { name: "Author description" }),
  ).toHaveTextContent(pack.description);
  const goals = screen.getByRole("region", { name: "Scenario objectives" });
  expect(goals).toHaveTextContent("Serve demand");
  expect(goals).toHaveTextContent(
    "Delivered customer electricity divided by customer demand each completed month.",
  );
  const timeline = screen.getByRole("region", { name: "Announced timeline" });
  expect(timeline).toHaveTextContent("Announced fuel support");
  expect(timeline).toHaveTextContent("Feb 2020");
  expect(
    screen.queryByText(/Private fuel shock|private fuel shock arrives/),
  ).toBeNull();
  await userEvent.click(
    screen.getByRole("button", { name: /Starting fleet/i }),
  );
  const fleet = screen.getByRole("region", { name: /Starting fleet/i });
  expect(fleet).toHaveTextContent(scenario.facilities[0].assetId!);
  expect(fleet).toHaveTextContent("MW");
  expect(
    screen.getByRole("region", { name: "Scenario diagnostics" }),
  ).toHaveTextContent("No validation issues.");
});

test("the author report exposes the same complete resolved timeline behind an explicit author tool", async () => {
  const facts = buildModAuthorReport(pack);
  render(<ModFacts facts={facts} author />);
  const timeline = facts.sections.find((section) => section.id === "timeline");
  expect(timeline).toBeDefined();
  const button = screen.getByRole("button", { name: timeline!.title });
  expect(button).toHaveAttribute("aria-expanded", "false");
  await userEvent.click(button);
  const region = screen.getByRole("region", { name: timeline!.title });
  expect(region).toHaveTextContent("Private fuel shock");
  const row = timeline!.rows.find(
    (item) =>
      item.value.includes("Private fuel shock") ||
      item.label.includes("Private fuel shock"),
  );
  expect(row).toBeDefined();
  expect(within(region).getByText(row!.value)).toBeVisible();
});
