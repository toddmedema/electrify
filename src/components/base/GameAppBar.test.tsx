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
import { FacilityOperatingType, TickPresentFutureType } from "../../Types";

jest.mock("../../Globals", () => ({
  ...jest.requireActual("../../Globals"),
  isBigScreen: () => true,
}));

const WEATHER_DRIVEN_TEST_FUELS = [
  "Sun",
  "Wind",
  "Offshore Wind",
  "Airborne Wind",
];

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

  it("reports reserve and grows when a plant is added", () => {
    const game = createGame({ scenarioId: 101 });
    const now = getTimeFromTimeline(game.date.minute, game.timeline)!;
    const plant = game.facilities.find(
      (facility: FacilityOperatingType) =>
        facility.fuel &&
        !["Sun", "Wind", "Offshore Wind"].includes(facility.fuel),
    )!;
    const before = reserveCapacityW(game, now);
    game.facilities.push({ ...plant, id: 999 });

    expect(reserveCapacityW(game, now) - before).toBe(plant.peakW);
    renderAppBar({ game: { ...game, inGame: true } });
    expect(screen.getByText(/\+.*W reserve/)).toBeInTheDocument();
    expect(screen.getByText("Stable")).toBeInTheDocument();
  });

  it("warns when reserve falls to ten percent of demand", () => {
    const game = createGame({ scenarioId: 101 });
    const now = getTimeFromTimeline(game.date.minute, game.timeline)!;
    const plant = game.facilities.find(
      (facility: FacilityOperatingType) =>
        facility.fuel &&
        !facility.peakWh &&
        !WEATHER_DRIVEN_TEST_FUELS.includes(facility.fuel),
    )!;
    const lowReserveGame = {
      ...game,
      facilities: [
        {
          ...plant,
          paused: false,
          yearsToBuildLeft: 0,
          peakW: now.demandW * 1.05,
        },
      ],
    };

    expect(getGridHealth(lowReserveGame, now)).toMatchObject({
      state: "low-reserve",
      label: "Low reserve",
      metric: expect.stringMatching(/reserve \(5%\)/),
    });
  });

  it("distinguishes an exhausted reserve from a blackout", () => {
    const game = createGame({ scenarioId: 101 });
    const now = getTimeFromTimeline(game.date.minute, game.timeline)!;
    const plant = game.facilities.find(
      (facility: FacilityOperatingType) =>
        facility.fuel &&
        !facility.peakWh &&
        !WEATHER_DRIVEN_TEST_FUELS.includes(facility.fuel),
    )!;
    const atLimitGame = {
      ...game,
      facilities: [
        {
          ...plant,
          paused: false,
          yearsToBuildLeft: 0,
          peakW: now.demandW,
        },
      ],
    };

    expect(getGridHealth(atLimitGame, now)).toMatchObject({
      state: "at-limit",
      metric: "0W reserve",
    });
    expect(
      getGridHealth(game, {
        ...now,
        supplyW: now.demandW - 373000000,
      } as TickPresentFutureType),
    ).toMatchObject({
      state: "blackout",
      label: "Blackout",
      metric: "373MW short",
    });
  });

  it("counts only current weather-limited Airborne Wind output as reserve", () => {
    const game = createGame({ scenarioId: 101 });
    const now = getTimeFromTimeline(game.date.minute, game.timeline)!;
    const template = game.facilities.find(
      (facility: FacilityOperatingType) => facility.fuel,
    )!;
    const airborne = {
      ...template,
      fuel: "Airborne Wind" as const,
      peakW: 2000000,
      currentW: 500000,
      yearsToBuildLeft: 0,
      paused: false,
    };

    expect(
      reserveCapacityW({ ...game, facilities: [airborne] }, {
        ...now,
        demandW: 0,
      } as TickPresentFutureType),
    ).toBe(500000);
  });

  it("omits the redundant money and time icons on desktop", () => {
    renderAppBar();
    expect(screen.queryByLabelText("Money")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Time")).not.toBeInTheDocument();
  });

  it("omits events and sound controls from the menu", () => {
    renderAppBar();
    fireEvent.click(screen.getByRole("button", { name: "menu" }));

    expect(screen.queryByRole("menuitem", { name: /events/i })).toBeNull();
    expect(screen.queryByRole("menuitem", { name: /turn sound/i })).toBeNull();
    expect(screen.getByRole("menuitem", { name: "Options" })).toBeVisible();
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
