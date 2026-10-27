import {
  fireEvent,
  render,
  screen,
  waitForElementToBeRemoved,
  within,
} from "@testing-library/react";
import { createGame } from "../../testing/Simulator";
import { GameType, isStorage } from "../../Types";
import BuildStorage from "./BuildStorage";

jest.mock("../base/ManualLink", () => () => null);

function game(): GameType {
  const state = createGame({ scenarioId: 103 });
  return {
    ...state,
    location: {
      id: "Reykjavik",
      name: "Reykjavik, Iceland",
      lat: 64.1466,
      long: -21.9426,
      country: "Iceland",
      region: "Europe",
    },
  };
}

it("shows remaining pumped-hydro locations in the expanded build view", () => {
  render(
    <BuildStorage
      game={game()}
      onBuildStorage={jest.fn()}
      onBack={jest.fn()}
    />,
  );

  fireEvent.click(
    screen.getByRole("button", { name: "Show Pumped Hydro details" }),
  );

  const row = screen.getByRole("row", {
    name: /Sites left.*648/,
  });
  expect(row).toHaveTextContent("648");
});

it("submits a storage purchase only once on a double-click", () => {
  const onBuildStorage = jest.fn();
  render(
    <BuildStorage
      game={game()}
      onBuildStorage={onBuildStorage}
      onBack={jest.fn()}
    />,
  );

  // Pumped Hydro is the first shopping card, so its price is the first purchase button.
  fireEvent.click(
    screen.getAllByRole("button", { name: /^Review purchase of/ })[0],
  );
  const takeLoan = screen.getByRole("button", { name: "Take loan" });
  fireEvent.click(takeLoan);
  fireEvent.click(takeLoan);

  expect(onBuildStorage).toHaveBeenCalledTimes(1);
});

it("deduplicates storage purchase impact and shows loan terms inline", async () => {
  render(
    <BuildStorage
      game={game()}
      onBuildStorage={jest.fn()}
      onBack={jest.fn()}
    />,
  );

  fireEvent.click(
    screen.getAllByRole("button", { name: /^Review purchase of/ })[0],
  );

  const impact = screen.getByRole("region", { name: "Expected impact" });
  expect(impact).toHaveTextContent("Cash purchase");
  expect(impact).toHaveTextContent(
    /Loan option.*now \+.*\/mo \(\d+\.\d+% for 30 years\)/,
  );
  expect(impact).toHaveTextContent("Estimated upkeep");
  expect(impact).toHaveTextContent("Online in");
  expect(impact).not.toHaveTextContent("Loan:");
  expect(screen.queryByText("Cash cost")).not.toBeInTheDocument();
  expect(screen.queryByText("Time to build")).not.toBeInTheDocument();
  expect(
    screen.queryByRole("table", { name: "Financing terms" }),
  ).not.toBeInTheDocument();

  const dialog = screen.getByRole("dialog");
  fireEvent.click(within(dialog).getByRole("button", { name: "close" }));
  await waitForElementToBeRemoved(dialog);
});

it("offers an oversized storage project its max size", () => {
  // Batteries exist by 2020 but can't yet reach the slider's largest size
  const state = game();
  render(
    <BuildStorage
      game={{ ...state, date: { ...state.date, year: 2020 } }}
      onBuildStorage={jest.fn()}
      onBack={jest.fn()}
    />,
  );
  const slider = screen.getByRole("slider");
  fireEvent.keyDown(slider, { key: "End" });
  expect(
    screen.getByRole("button", { name: "Review purchase of Lithium Battery" }),
  ).toBeDisabled();
  const useMaxSize = screen.getByRole("button", { name: "Use max size" });

  const before = slider.getAttribute("aria-valuenow");
  fireEvent.click(useMaxSize);
  expect(slider).not.toHaveAttribute("aria-valuenow", before!);
  expect(
    screen.queryByRole("button", { name: "Use max size" }),
  ).not.toBeInTheDocument();
});

it("opens at average storage energy capacity", () => {
  const state = game();
  const storage = createGame({ scenarioId: 2 }).facilities.find(isStorage)!;
  state.facilities = [400e6, 800e6].map((peakWh, index) => ({
    ...storage,
    id: index + 1,
    peakWh,
  }));
  render(
    <BuildStorage game={state} onBack={jest.fn()} onBuildStorage={jest.fn()} />,
  );
  expect(screen.getByRole("slider")).toHaveAccessibleName(/600MWh/);
});

it("shows lithium and iron-air efficiency before opening details", () => {
  const state = createGame({ scenarioId: 100 });
  state.date.year = 2030;
  render(
    <BuildStorage game={state} onBack={jest.fn()} onBuildStorage={jest.fn()} />,
  );
  expect(screen.getByText("Fast response, four hours of power")).toBeVisible();
  expect(screen.queryByText("Energy capacity")).not.toBeInTheDocument();
  expect(screen.getByText("85%")).toBeVisible();
  expect(screen.getByText("43%")).toBeVisible();
  for (const name of ["Lithium Battery", "Iron-Air Battery"]) {
    expect(
      screen.getByRole("button", { name: `Show ${name} details` }),
    ).toHaveAttribute("aria-expanded", "false");
  }
  fireEvent.click(
    screen.getByRole("button", { name: "Show Lithium Battery details" }),
  );
  const table = screen.getByRole("table", { name: "storage properties" });
  expect(
    within(table).queryByRole("row", { name: /Round-trip efficiency/ }),
  ).not.toBeInTheDocument();
  fireEvent.click(
    screen.getByRole("button", { name: "Review purchase of Lithium Battery" }),
  );
  expect(screen.getByRole("dialog")).toHaveAccessibleName(/Lithium Battery/);
});
