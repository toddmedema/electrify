import userEvent from "@testing-library/user-event";
import { render, screen, within } from "@testing-library/react";
import { configureStore } from "@reduxjs/toolkit";
import { Provider } from "react-redux";
import { UTILITY_TARGETS } from "../../data/UtilityExpansion";
import { acquisitionQuote } from "../../helpers/Expansion";
import { currentTick } from "../../helpers/GameSelectors";
import {
  formatMoneyConcise,
  formatNumber,
  formatWatts,
  formatForecastWatts,
} from "../../helpers/Format";
import { copyOfficialGame } from "../../testing/OfficialScenarioExecutionFixtures";
import { createGame } from "../../testing/Simulator";
import {
  buildTransmissionLine,
  generateForecastTimeline,
  previewUtilityAcquisition,
} from "../../reducers/Game";
import { getDateFromMinute, MINUTES_PER_MONTH } from "../../helpers/DateTime";
import reducer from "../../reducers/Game";
import uiReducer from "../../reducers/UI";
import { UtilityTargetId } from "../../Types";
import AcquisitionReviewDialog from "./AcquisitionReviewDialog";
import { facilityDisplayName } from "./FacilityLabels";

function review(targetId: UtilityTargetId, year = 2005, customers = 90000) {
  const corridorId = UTILITY_TARGETS.find(
    (target) => target.id === targetId,
  )!.corridorId;
  const initial = createGame({
    scenarioId: 116,
    seed: 12345,
    difficulty: "Employee",
  });
  currentTick(initial)!.cash = 2e9;
  currentTick(initial)!.customers = customers;
  const game = copyOfficialGame(
    reducer(
      initial,
      buildTransmissionLine({
        corridorId,
        financed: false,
      }),
    ),
  );
  game.transmission!.lines.find(
    (line) => line.corridorId === corridorId,
  )!.yearsToBuildLeft = 0;
  if (year !== 2005) {
    game.date = getDateFromMinute(
      (year - game.startingYear) * 12 * MINUTES_PER_MONTH,
      game.startingYear,
    );
    game.timeline = generateForecastTimeline(game, 2e9, 90000, 2);
  }
  const quote = acquisitionQuote(game, targetId)!;
  const store = configureStore({
    reducer: { game: () => game, ui: uiReducer },
  });
  render(
    <Provider store={store}>
      <AcquisitionReviewDialog
        game={game}
        targetId={targetId}
        onClose={jest.fn()}
        onAcquire={jest.fn()}
      />
    </Provider>,
  );
  return { quote, preview: previewUtilityAcquisition(game, targetId, true)! };
}

function disclosure(label: string) {
  return screen.getByText(label, { selector: "summary" }).closest("details")!;
}

function expectedMargin(
  preview: NonNullable<ReturnType<typeof previewUtilityAcquisition>>,
) {
  return `${formatForecastWatts(preview.beforeMarginW)} → ${formatForecastWatts(Math.abs(preview.afterMarginW))} ${preview.afterMarginW < 0 ? "shortfall" : "spare"}`;
}

it.each(["valley-electric", "ridge-electric"] as const)(
  "shows %s pricing first in the shared purchase table and keeps full terms discoverable",
  async (targetId) => {
    const user = userEvent.setup();
    const { quote, preview } = review(targetId);
    expect(
      screen.getByText(
        targetId === "valley-electric"
          ? "90k → 249k (+177%)"
          : "90k → 140k (+56%)",
      ),
    ).toBeVisible();
    expect(screen.getByText(/Retain 90%/)).toBeVisible();
    expect(screen.getByText(/Retire the acquired oil/)).toBeVisible();
    const payments = screen.getByRole("region", { name: "Expected impact" });
    expect(within(payments).getByText(expectedMargin(preview))).toBeVisible();
    expect(payments).toHaveTextContent(
      `${formatMoneyConcise(quote.cashDue)} now + ${formatMoneyConcise(quote.cashMonthlyDebtService + quote.networkOMPerMonth)}/mo`,
    );
    expect(payments).toHaveTextContent(
      `${formatMoneyConcise(quote.financedCashDue)} now + ${formatMoneyConcise(quote.monthlyDebtService + quote.networkOMPerMonth)}/mo`,
    );
    expect(
      within(payments)
        .getAllByText(/^(Cash option|Loan option|Customers|Supply margin)$/)
        .map((node) => node.textContent),
    ).toEqual(["Cash option", "Loan option", "Customers", "Supply margin"]);
    expect(
      screen.getAllByRole("button", { name: /Pay cash|Take loan/ }),
    ).toHaveLength(2);
    expect(screen.queryByText(/Plant operating costs/)).not.toBeInTheDocument();
    expect(
      screen.queryByText(/cash-only transaction fee/),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Pay cash" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Take loan" })).toBeEnabled();

    const assets = disclosure("Plants & purchased power");
    expect(within(assets).getByText("Operating plants")).not.toBeVisible();
    await user.click(within(assets).getByText("Plants & purchased power"));
    expect(within(assets).getByText("Operating plants")).toBeVisible();
    expect(
      within(assets)
        .getAllByText(/years old/)
        .map((node) => node.textContent),
    ).toEqual(
      [...quote.facilities]
        .sort((a, b) => b.peakW - a.peakW)
        .map((plant) => `${formatNumber(plant.ageYears)} years old`),
    );
    const plants = within(
      within(assets).getByRole("region", { name: "Operating plants" }),
    );
    for (const plant of quote.facilities) {
      expect(plants.getByText(facilityDisplayName(plant))).toBeVisible();
      expect(plants.getByText(formatWatts(plant.peakW))).toBeVisible();
    }
    for (const contract of quote.contracts)
      expect(within(assets).getByText(contract.name)).toBeVisible();

    const financing = disclosure("Financing breakdown");
    expect(within(financing).getByText("Inherited debt")).not.toBeVisible();
    await user.click(within(financing).getByText("Financing breakdown"));
    expect(financing).toHaveTextContent(formatMoneyConcise(quote.assumedDebt));
    expect(financing).toHaveTextContent(formatMoneyConcise(quote.equityPrice));
    expect(financing).toHaveTextContent(formatMoneyConcise(quote.fee));
    expect(within(financing).getByText(/5% over 20 years/)).toBeVisible();
    expect(within(financing).getByText(/over 30 years/)).toBeVisible();

    const schedule = disclosure("Supply & network changes");
    expect(within(schedule).getByText(/1.5× opening upkeep/)).not.toBeVisible();
    await user.click(within(schedule).getByText("Supply & network changes"));
    expect(within(schedule).getByText(/1.5× opening upkeep/)).toBeVisible();
    expect(schedule).toHaveTextContent("Jan 2020");
  },
);

it("keeps Valley’s inherited supply and future reduction discoverable", async () => {
  review("valley-electric");
  const assets = disclosure("Plants & purchased power");
  const schedule = disclosure("Supply & network changes");
  await userEvent.click(within(assets).getByText("Plants & purchased power"));
  await userEvent.click(within(schedule).getByText("Supply & network changes"));
  expect(schedule).toHaveTextContent("Jan 2017");
  expect(schedule).toHaveTextContent("76MW deliverable");
  expect(within(assets).getByText(/January 2017/)).toHaveTextContent(
    "152 to 76 MW",
  );
  expect(assets).toHaveTextContent("Regional nuclear");
  expect(assets).toHaveTextContent("Québec hydro");
  expect(assets).not.toHaveTextContent("New England balancing");
  expect(screen.queryByText(/Plan replacement supply/)).not.toBeInTheDocument();
});

it.each([2017, 2024])(
  "keeps the current Valley supply and its reduction date discoverable in %i",
  async (year) => {
    review("valley-electric", year);
    const assets = disclosure("Plants & purchased power");
    await userEvent.click(within(assets).getByText("Plants & purchased power"));
    expect(
      within(assets).getByText(/nuclear purchase is now/),
    ).toHaveTextContent("76MW");
    expect(assets).toHaveTextContent("January 2017");
  },
);

it("excludes expired power rights and past oil retirement commitments from a 2025 purchase", async () => {
  const { quote, preview } = review("valley-electric", 2025);
  expect(quote.contracts).toEqual([]);
  expect(screen.getByText(expectedMargin(preview))).toBeVisible();
  const assets = disclosure("Plants & purchased power");
  await userEvent.click(within(assets).getByText("Plants & purchased power"));
  expect(
    within(assets).getByText(/nuclear purchase has expired/),
  ).toBeVisible();
  expect(
    within(assets).getByText("No inherited purchased-power rights remain."),
  ).toBeVisible();
  expect(screen.queryByText(/Retire the acquired oil/)).not.toBeInTheDocument();
});

it.each([
  [50000, "50k → 209k (+318%)"],
  [0, "0 → 159k"],
] as const)(
  "shows customer impact from an existing base of %i",
  (customers, value) => {
    review("valley-electric", 2005, customers);
    expect(screen.getByText(value)).toBeVisible();
  },
);
