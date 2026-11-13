import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { Provider } from "react-redux";
import { store } from "../../Store";
import { manualHelpClose } from "../../reducers/UI";
import { createGame } from "../../testing/Simulator";
import HydroWaterSection from "./HydroWaterSection";
import { MANUAL_ENTRY } from "./ManualEntries";
import { useOutlookWorker } from "./useOutlookWorker";

jest.mock("./useOutlookWorker");

function showWater(fraction: number, fleet: boolean) {
  const game = createGame({ scenarioId: 108 });
  const dam = game.facilities.find((facility) => facility.fuel === "Hydro")!;
  if (fleet) game.facilities.push({ ...dam, id: dam.id + 100 });
  jest.mocked(useOutlookWorker).mockReturnValue(
    Array.from({ length: 13 }, (_, month) => ({
      monthNumber: (month % 12) + 1,
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
