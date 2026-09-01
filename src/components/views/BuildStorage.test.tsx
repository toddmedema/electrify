import * as React from "react";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { createGame } from "../../testing/Simulator";
import { GameType } from "../../Types";
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
    name: /Suitable project sites remaining.*648/,
  });
  expect(row).toHaveTextContent("648");
  expect(row).toHaveTextContent("Each project uses one suitable site");
});

it("keeps toolbar actions inside compact viewport gutters", () => {
  render(
    <BuildStorage
      game={game()}
      onBuildStorage={jest.fn()}
      onBack={jest.fn()}
    />,
  );

  expect(screen.getByRole("button", { name: "close" })).not.toHaveClass(
    "MuiIconButton-edgeEnd",
  );
  expect(
    screen.getByRole("button", { name: "Sort facilities: Build Cost" }),
  ).not.toHaveClass("MuiIconButton-edgeEnd");
});

it("shows decision context without live-time controls", () => {
  render(
    <BuildStorage
      game={game()}
      onBuildStorage={jest.fn()}
      onBack={jest.fn()}
    />,
  );

  expect(screen.getByText("Build Storage")).toBeInTheDocument();
  expect(screen.getByLabelText(/Available cash/)).toHaveTextContent("cash");
  expect(screen.getByText("Capacity")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "pause" })).toBeNull();
});

it("shows the current sort text when the controls have enough width", () => {
  const originalMatchMedia = window.matchMedia;
  window.matchMedia = (query: string) =>
    ({
      matches: query === "(min-width:600px)",
      media: query,
      onchange: null,
      addListener: () => undefined,
      removeListener: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => false,
    }) as MediaQueryList;

  try {
    render(
      <BuildStorage
        game={game()}
        onBuildStorage={jest.fn()}
        onBack={jest.fn()}
      />,
    );

    expect(
      screen.getByRole("combobox", { name: "Sort facilities" }),
    ).toHaveTextContent("Sort: Build Cost");
  } finally {
    window.matchMedia = originalMatchMedia;
  }
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
  fireEvent.click(screen.getAllByRole("button", { name: /^\$/ })[0]);
  const takeLoan = screen.getByRole("button", { name: "Take loan" });
  fireEvent.click(takeLoan);
  fireEvent.click(takeLoan);

  expect(onBuildStorage).toHaveBeenCalledTimes(1);
});

it("deduplicates storage purchase impact and discloses financing terms", async () => {
  render(
    <BuildStorage
      game={game()}
      onBuildStorage={jest.fn()}
      onBack={jest.fn()}
    />,
  );

  fireEvent.click(screen.getAllByRole("button", { name: /^\$/ })[0]);

  const impact = screen.getByRole("region", { name: "Expected impact" });
  expect(impact).toHaveTextContent("Cash purchase");
  expect(impact).toHaveTextContent("Online in");
  expect(impact).not.toHaveTextContent("Loan:");
  expect(screen.queryByText("Cash cost")).not.toBeInTheDocument();
  expect(screen.queryByText("Time to build")).not.toBeInTheDocument();
  expect(
    screen.queryByRole("table", { name: "Financing terms" }),
  ).not.toBeInTheDocument();

  const toggle = screen.getByRole("button", { name: "Show financing terms" });
  expect(toggle).toHaveAttribute("aria-expanded", "false");
  fireEvent.click(toggle);

  expect(toggle).toHaveAttribute("aria-expanded", "true");
  const terms = screen.getByRole("table", { name: "Financing terms" });
  expect(terms).toHaveTextContent("Downpayment");
  expect(terms).toHaveTextContent("Interest rate");
  expect(terms).toHaveTextContent("Monthly payments");
  expect(terms).toHaveTextContent("Loan duration");

  fireEvent.click(
    within(screen.getByRole("dialog")).getByRole("button", { name: "close" }),
  );
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  fireEvent.click(screen.getAllByRole("button", { name: /^\$/ })[0]);
  expect(
    screen.getByRole("button", { name: "Show financing terms" }),
  ).toHaveAttribute("aria-expanded", "false");
});
