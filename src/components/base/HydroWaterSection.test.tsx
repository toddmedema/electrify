import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { Provider } from "react-redux";
import { store } from "../../Store";
import { manualHelpClose } from "../../reducers/UI";
import { ReservoirOutlookPoint } from "../../helpers/HydroOutlook";
import { GameType } from "../../Types";
import { createGame } from "../../testing/Simulator";
import HydroWaterSection from "./HydroWaterSection";
import { MANUAL_ENTRY } from "./ManualEntries";
import { useOutlookWorker } from "./useOutlookWorker";

jest.mock("./useOutlookWorker");

function showWater(
  fraction: number,
  fleet: boolean,
  points?: ReservoirOutlookPoint[],
  liveDate?: Pick<GameType["date"], "year" | "monthNumber">,
) {
  const game = createGame({ scenarioId: 108 });
  if (points) {
    game.date.year = 2025;
    game.date.monthNumber = points[0].monthNumber;
  }
  Object.assign(game.date, liveDate);
  const dam = game.facilities.find((facility) => facility.fuel === "Hydro")!;
  if (fleet) game.facilities.push({ ...dam, id: dam.id + 100 });
  jest.mocked(useOutlookWorker).mockReturnValue(
    points ??
      Array.from({ length: 13 }, (_, month) => ({
        monthNumber: (month % 12) + 1,
        year: game.date.year + Math.floor(month / 12),
        fraction,
        snowpackMm: 0,
      })),
  );
  render(
    <Provider store={store}>
      <HydroWaterSection facility={dam} game={game} />
    </Provider>,
  );
  return screen.getByRole("region", { name: "Water" });
}

afterEach(() => {
  act(() => {
    store.dispatch(manualHelpClose());
  });
});

it("announces the fleet forecast scope and no-refill warning when its chart is absent", () => {
  const water = within(showWater(0.01, true));
  const forecast = water.getByRole("button", { name: /reservoir forecast/i });
  expect(forecast).toHaveTextContent(
    "All your dams, next 12 months: no refill expected",
  );
  expect(forecast).toHaveAccessibleName(/all your dams, next 12 months/i);
  expect(forecast).toHaveAccessibleName(/no refill expected/i);
  expect(water.queryByRole("img", { name: /Reservoir forecast/ })).toBeNull();
  fireEvent.click(forecast);
  expect(store.getState().ui.manualHelpEntry).toBe(MANUAL_ENTRY.HYDROPOWER);
});

it.each([false, true])(
  "keeps the regular forecast link and chart (fleet: %s)",
  (fleet) => {
    const water = within(showWater(0.5, fleet));
    const forecast = water.getByRole("button", {
      name: "What is reservoir forecast?",
    });
    expect(forecast).toHaveTextContent(
      fleet ? "All your dams, next 12 months" : "Next 12 months",
    );
    expect(forecast).not.toHaveTextContent("no refill expected");
    expect(
      water.getByRole("img", { name: /Reservoir forecast/ }),
    ).toBeInTheDocument();
  },
);

it.each([2026, 2027])(
  "keeps a retained December forecast's dates while the live year is %s",
  (liveYear) => {
    const points = [
      { monthNumber: 12, year: 2025, fraction: 0.5, snowpackMm: 0 },
      { monthNumber: 12, year: 2025, fraction: 0.4, snowpackMm: 0 },
      { monthNumber: 1, year: 2026, fraction: 0.3, snowpackMm: 0 },
    ];
    const water = within(
      showWater(0.5, false, points, { year: liveYear, monthNumber: 1 }),
    );
    const group = water.getByRole("group", {
      name: "Monthly reservoir forecast",
    });
    fireEvent.keyDown(group, { key: "Home" });
    expect(group).toHaveAccessibleDescription("Now · Dec 2025 50% full");
    fireEvent.keyDown(group, { key: "End" });
    expect(group).toHaveAccessibleDescription("Jan 2026 30% full · month end");
  },
);

it.each([false, true])(
  "inspects reservoir month ends across a year boundary (fleet: %s)",
  (fleet) => {
    const points = Array.from({ length: 13 }, (_, index) => ({
      monthNumber: index < 2 ? 12 : index - 1,
      year: index < 2 ? 2025 : 2026,
      fraction: index === 2 ? 0.2 : 0.5,
      snowpackMm: 0,
    }));
    const water = within(showWater(0.5, fleet, points));
    const group = water.getByRole("group", {
      name: fleet
        ? "Monthly reservoir forecast for all your dams"
        : "Monthly reservoir forecast",
    });
    expect(group).toHaveAccessibleDescription(/Low Jan 20%/);
    fireEvent.keyDown(group, { key: "Home" });
    expect(group).toHaveAccessibleDescription("Now · Dec 2025 50% full");
    fireEvent.keyDown(group, { key: "ArrowRight" });
    expect(group).toHaveAccessibleDescription("Dec 2025 50% full · month end");
    fireEvent.keyDown(group, { key: "ArrowRight" });
    expect(group).toHaveAccessibleDescription("Jan 2026 20% full · month end");
    fireEvent.keyDown(group, { key: "End" });
    expect(group).toHaveAccessibleDescription("Nov 2026 50% full · month end");
    fireEvent.pointerLeave(group);
    expect(group).toHaveAccessibleDescription(/Low Jan 20%/);
  },
);
