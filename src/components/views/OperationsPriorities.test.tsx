import * as React from "react";
import { createNextState as produce } from "@reduxjs/toolkit";
import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createGame } from "../../testing/Simulator";
import { GameType } from "../../Types";
import OperationsPriorities from "./OperationsPriorities";
import { UpcomingStoryEventType } from "./StoryEventSelectors";
import { MINUTES_PER_MONTH } from "../../helpers/DateTime";

function fixture(change?: (game: GameType) => void) {
  return produce(createGame({ scenarioId: 111 }), (draft) => {
    change?.(draft as GameType);
  });
}

function props(game = fixture()) {
  return {
    game,
    ongoing: [],
    upcoming: [],
    onEvidence: jest.fn(),
    onFacility: jest.fn(),
  };
}

beforeEach(() => localStorage.clear());

test("a current shortage never replaces the two pinned requirements", () => {
  const game = fixture((draft) => {
    draft.timeline[0].supplyW = 1;
    draft.timeline[0].demandW = 2;
  });
  render(<OperationsPriorities {...props(game)} />);
  expect(screen.getByRole("heading", { name: "Pinned goals" })).toBeVisible();
  expect(
    screen.getByRole("button", { name: /Keep the utility solvent/ }),
  ).toBeVisible();
  expect(
    screen.getByRole("button", {
      name: /January and February.*wildfire emergency/,
    }),
  ).toBeVisible();
  expect(
    screen.getByRole("button", { name: /Blackout.*Inspect supply/ }),
  ).toBeVisible();
});

test("players can choose concurrent goals and their choices survive remount", async () => {
  const user = userEvent.setup();
  const passed = props();
  const view = render(<OperationsPriorities {...passed} />);
  await user.click(screen.getByRole("button", { name: "Choose pinned goals" }));
  await user.click(
    screen.getByRole("menuitemcheckbox", { name: "Avoid chronic blackouts" }),
  );
  await user.click(
    screen.getByRole("menuitemcheckbox", {
      name: /January and February.*wildfire emergency/,
    }),
  );
  await user.click(screen.getByRole("menuitem", { name: "Done" }));
  view.unmount();
  render(<OperationsPriorities {...passed} />);
  expect(
    screen.getByRole("button", { name: /Avoid chronic blackouts/ }),
  ).toBeVisible();
  expect(
    screen.queryByRole("button", {
      name: /January and February.*wildfire emergency/,
    }),
  ).not.toBeInTheDocument();
  await user.click(
    screen.getByRole("button", { name: /Keep the utility solvent/ }),
  );
  expect(passed.onEvidence).toHaveBeenCalledWith("finances");
});

test("the next-event destination stays stable while keyboard focus is on it", async () => {
  const first: UpcomingStoryEventType = {
    key: "first",
    title: "Fuel supply change",
    message: "Fuel prices will rise.",
    label: "Feb 2025",
    actionTarget: { card: "INSIGHTS", layer: "FUEL_PRICES" },
  };
  const second: UpcomingStoryEventType = {
    key: "second",
    title: "A new load",
    message: "Demand will rise.",
    label: "Mar 2025",
    actionTarget: { card: "INSIGHTS", layer: "SUPPLY_DEMAND" },
  };
  const passed = props();
  const view = render(<OperationsPriorities {...passed} upcoming={[first]} />);
  const button = screen.getByRole("button", { name: /Fuel supply change/ });
  await act(async () => button.focus());
  view.rerender(<OperationsPriorities {...passed} upcoming={[second]} />);
  expect(button).toHaveFocus();
  fireEvent.click(button);
  expect(passed.onEvidence).toHaveBeenCalledWith(first.actionTarget);
  await act(async () => button.blur());
  expect(screen.getByRole("button", { name: /A new load/ })).toBeVisible();
});

test("a project's commitment stays linked to the same asset as it starts producing", () => {
  const building = fixture((draft) => {
    draft.facilities = [
      {
        ...draft.facilities[0],
        id: 17,
        yearsToBuildLeft: 8.4 / 12,
        currentW: 0,
      },
    ];
  });
  const passed = props(building);
  const view = render(<OperationsPriorities {...passed} />);
  const button = screen.getByRole("button", {
    name: /project and grid output/,
  });
  expect(button).toHaveTextContent("No output yet");
  expect(button).toHaveTextContent("9 mo to online");
  fireEvent.click(button);
  expect(passed.onFacility).toHaveBeenCalledWith(17);
  const online = produce(building, (draft) => {
    draft.date.minute = 10;
    draft.facilities[0].yearsToBuildLeft = 0;
    draft.facilities[0].minuteOperational = 10;
    draft.facilities[0].currentW = 500;
  });
  view.rerender(
    <OperationsPriorities {...passed} game={online} selectedFacilityId={17} />,
  );
  expect(screen.getByRole("button", { name: /project and grid output/ })).toBe(
    button,
  );
  expect(button).toHaveTextContent("Online");
  expect(button).toHaveTextContent("500W now");
  expect(button).toHaveClass("selected");
});

test.each(["pointer", "keyboard"])(
  "project expiry holds the %s target while live output keeps updating",
  async (interaction) => {
    const user = userEvent.setup();
    const game = fixture((draft) => {
      draft.date.minute = 20;
      draft.facilities = [
        {
          ...draft.facilities[0],
          id: 3,
          name: "Solar",
          yearsToBuildLeft: 0,
          minuteOperational: 10,
          currentW: 100,
        },
        {
          ...draft.facilities[0],
          id: 4,
          name: "Solar",
          yearsToBuildLeft: 0.5,
          minuteOperational: undefined,
          currentW: 0,
        },
      ];
    });
    const passed = props(game);
    const view = render(<OperationsPriorities {...passed} />);
    const rows = () =>
      screen.getAllByRole("button", {
        name: "Inspect Solar project and grid output",
      });
    const first = rows()[0];
    if (interaction === "pointer") await user.hover(first);
    else await act(async () => first.focus());
    const expired = produce(game, (draft) => {
      draft.date.minute = 10 + MINUTES_PER_MONTH;
      draft.facilities[0].currentW = 500;
    });
    view.rerender(<OperationsPriorities {...passed} game={expired} />);
    expect(rows()).toHaveLength(2);
    expect(rows()[0]).toBe(first);
    expect(first).toHaveTextContent("#3");
    expect(first).toHaveTextContent("500W now");
    if (interaction === "keyboard") expect(first).toHaveFocus();
    fireEvent.click(first);
    expect(passed.onFacility).toHaveBeenCalledWith(3);
    if (interaction === "pointer") await user.unhover(first);
    else
      await act(async () =>
        screen
          .getByRole("button", { name: /Keep the utility solvent/ })
          .focus(),
      );
    expect(rows()).toHaveLength(1);
    expect(rows()[0]).toHaveTextContent("#4");
  },
);
