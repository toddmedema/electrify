import * as React from "react";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { createGame } from "../../testing/Simulator";
import {
  GameAppBar,
  getGridHealth,
  Props,
  reserveCapacityW,
} from "./GameAppBar";
import { getTimeFromTimeline } from "../../helpers/DateTime";
import { TickPresentFutureType } from "../../Types";

jest.mock("../../Globals", () => ({
  ...jest.requireActual("../../Globals"),
  isBigScreen: () => true,
}));

function renderAppBar(overrides: Partial<Props> = {}) {
  const game = createGame({ scenarioId: 101 });
  const props: Props = {
    game: { ...game, inGame: true },
    onManual: () => undefined,
    onNextTutorial: () => undefined,
    onQuit: () => undefined,
    onSettings: () => undefined,
    onSpeedChange: () => undefined,
    ...overrides,
  };
  return render(<GameAppBar {...props} />);
}

describe("GameAppBar", () => {
  it("keeps all four speeds one tap away", () => {
    const onSpeedChange = jest.fn();
    renderAppBar({ onSpeedChange });

    const speedControls = screen.getByRole("group", { name: "game speed" });
    expect(within(speedControls).getAllByRole("button")).toHaveLength(4);

    fireEvent.click(
      within(speedControls).getByRole("button", { name: "fast speed" }),
    );
    expect(onSpeedChange).toHaveBeenCalledWith("FAST");
  });

  it("uses reachable reserve from the simulation rather than plant nameplates", () => {
    const game = createGame({ scenarioId: 101 });
    const now = getTimeFromTimeline(game.date.minute, game.timeline)!;
    now.supplyW = now.demandW;
    now.reserveW = now.demandW * 0.25;
    // Changing a displayed nameplate cannot invent immediately available output.
    game.facilities = game.facilities.map((plant) => ({
      ...plant,
      peakW: 1e15,
    }));
    expect(reserveCapacityW(game, now)).toBe(now.reserveW);
    renderAppBar({ game: { ...game, inGame: true } });
    expect(screen.getByText("Stable")).toBeInTheDocument();
    expect(screen.getByText(/\+.*W reserve/)).toBeInTheDocument();
  });

  it("warns when reachable reserve falls to five percent of demand", () => {
    const game = createGame({ scenarioId: 101 });
    const now = getTimeFromTimeline(game.date.minute, game.timeline)!;
    now.supplyW = now.demandW;
    now.reserveW = now.demandW * 0.05;
    expect(getGridHealth(game, now)).toMatchObject({
      state: "low-reserve",
      metric: expect.stringMatching(/reserve \(5%\)/),
    });
    renderAppBar({ game: { ...game, inGame: true } });
    expect(
      screen.getByLabelText(/Current grid status: Low reserve/),
    ).toBeVisible();
  });

  it("distinguishes zero reserve from a blackout and prioritizes actual shortages", () => {
    const game = createGame({ scenarioId: 101 });
    const now = getTimeFromTimeline(game.date.minute, game.timeline)!;
    expect(
      getGridHealth(game, {
        ...now,
        supplyW: now.demandW,
        reserveW: 0,
      } as TickPresentFutureType),
    ).toMatchObject({
      state: "at-limit",
      metric: "0W reserve",
    });
    expect(
      getGridHealth(game, {
        ...now,
        supplyW: now.demandW - 373000000,
        reserveW: 500000000,
      } as TickPresentFutureType),
    ).toMatchObject({
      state: "blackout",
      metric: "373MW short",
    });
  });
  it("gives the scenario dialog only the scenario name", () => {
    renderAppBar();
    fireEvent.click(screen.getByRole("button", { name: "menu" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Scenario details" }));

    expect(
      screen.getByRole("dialog", { name: "Rise of Renewables" }),
    ).toBeVisible();
  });

  it("returns focus to the primary action after Save & Quit", () => {
    jest.useFakeTimers();
    const target = document.createElement("button");
    target.dataset.mainAction = "";
    document.body.appendChild(target);
    const onQuit = jest.fn();
    renderAppBar({ onQuit });

    fireEvent.click(screen.getByRole("button", { name: "menu" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Save & Quit" }));
    act(() => jest.advanceTimersByTime(350));

    expect(onQuit).toHaveBeenCalled();
    expect(target).toHaveFocus();
    target.remove();
    jest.useRealTimers();
  });
});
