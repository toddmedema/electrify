import { fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { ThemeProvider } from "@mui/material/styles";
import { createAppTheme } from "../Theme";
import { createGame } from "../testing/Simulator";
import CouchToolbar, { CouchToolbarProps } from "./Toolbar";

function props(overrides: Partial<CouchToolbarProps> = {}): CouchToolbarProps {
  return {
    game: createGame({ scenarioId: 101 }),
    clock: {
      speed: "NORMAL",
      players: [
        { id: "local-p1", name: "Ada", selectedSpeed: "FAST", retired: false },
        {
          id: "local-p2",
          name: "Grace",
          selectedSpeed: "NORMAL",
          retired: false,
        },
      ],
      reason: "",
      systemBlockers: [],
      readyRequired: false,
      ready: [],
      complete: false,
    },
    menuOpen: false,
    onMenuClose: jest.fn(),
    onManual: jest.fn(),
    onSettings: jest.fn(),
    onSaveQuit: jest.fn(),
    ...overrides,
  };
}

function show(value: CouchToolbarProps) {
  const theme = createAppTheme("light");
  return render(<CouchToolbar {...value} />, {
    wrapper: ({ children }) => (
      <ThemeProvider theme={theme}>{children}</ThemeProvider>
    ),
  });
}

it("shows one shared calendar while speed controls stay in the player panes", () => {
  const value = props();
  show(value);
  expect(screen.queryByRole("button", { name: "menu" })).toBeNull();
  expect(screen.getByRole("progressbar")).toHaveAttribute(
    "aria-valuenow",
    String(Math.round(value.game.date.percentOfYear * 100)),
  );
  expect(
    screen.getByText(`${value.game.date.month} ${value.game.date.year}`, {
      exact: false,
    }),
  ).toBeVisible();
  expect(screen.queryAllByRole("group", { name: /speed/ })).toHaveLength(0);
  expect(screen.queryByRole("group", { name: "Shared clock" })).toBeNull();
  expect(screen.queryByText(/Local Co-op|Unranked|Last local save/)).toBeNull();
  expect(
    screen.queryByRole("button", { name: "Save & Quit for everyone" }),
  ).toBeNull();
});

it("shows effective and selected speeds in Clock status", () => {
  show(props({ menuOpen: true }));
  fireEvent.click(screen.getByRole("button", { name: "Clock status" }));
  const details = screen.getByRole("dialog", { name: "Clock status" });
  const clock = within(details).getByRole("group", { name: "Shared clock" });
  expect(clock).toHaveTextContent("Clock 3×");
  expect(clock).toHaveTextContent("P1 12×");
  expect(clock).toHaveTextContent("P2 3×");
  expect(clock).toHaveTextContent("Set by P2");
});

it("shows common upcoming events even when the first company has a cash warning", () => {
  const value = props({
    upcoming: [
      {
        key: "shared-event",
        startsMinute: 1000000,
        title: "Carbon fee rising",
        label: "Expected next year",
        message: "Prepare for a carbon fee.",
      },
    ],
  });
  value.game.timeline[0].cash = -1;
  show(value);
  expect(
    screen.getByRole("button", { name: /Upcoming: Carbon fee rising/ }),
  ).toBeVisible();
  expect(screen.getByRole("button", { name: /months left/ })).toBeVisible();
  expect(screen.queryByRole("button", { name: /Cash out/ })).toBeNull();
});

it("shows the shared floating menu with Return to game first and delegates its actions", () => {
  const value = props({ menuOpen: true });
  show(value);
  const menu = screen.getByRole("dialog", { name: "Game menu" });
  expect(
    within(menu)
      .getAllByRole("button")
      .map((button) => button.textContent),
  ).toEqual(["Return to game", "Manual", "Settings", "Clock status", "Quit"]);
  fireEvent.click(within(menu).getByRole("button", { name: "Settings" }));
  expect(value.onSettings).toHaveBeenCalledTimes(1);
  fireEvent.click(within(menu).getByRole("button", { name: "Manual" }));
  expect(value.onManual).toHaveBeenCalledTimes(1);
  fireEvent.click(within(menu).getByRole("button", { name: "Quit" }));
  expect(value.onSaveQuit).toHaveBeenCalledTimes(1);
  fireEvent.click(within(menu).getByRole("button", { name: "Return to game" }));
  expect(value.onMenuClose).toHaveBeenCalledTimes(1);
});

it("moves menu selection using the same real focus as the controller", () => {
  show(props({ menuOpen: true }));
  const resume = screen.getByRole("button", { name: "Return to game" });
  resume.focus();
  fireEvent.keyDown(resume, { key: "ArrowDown" });
  const manual = screen.getByRole("button", { name: "Manual" });
  expect(manual).toHaveFocus();
  fireEvent.keyDown(manual, { key: "ArrowUp" });
  expect(resume).toHaveFocus();
});

it("names simultaneous holders and exposes all pause reasons through controller menu navigation", () => {
  const value = props();
  value.clock.speed = "PAUSED";
  value.clock.players[1].selectedSpeed = "PAUSED";
  value.clock.players[1].pauseReason = "New event requiring attention";
  value.clock.systemBlockers = ["TV session dialog open", "Steam overlay open"];
  show({ ...value, menuOpen: true });
  const menu = screen.getByRole("dialog", { name: "Game menu" });
  const settings = within(menu).getByRole("button", { name: "Settings" });
  settings.focus();
  fireEvent.keyDown(settings, { key: "ArrowDown" });
  const clockStatus = within(menu).getByRole("button", {
    name: "Clock status",
  });
  expect(clockStatus).toHaveFocus();
  fireEvent.click(clockStatus);

  const details = screen.getByRole("dialog", { name: "Clock status" });
  const clock = within(details).getByRole("group", { name: "Shared clock" });
  expect(clock).toHaveTextContent("Clock Paused");
  expect(clock).toHaveTextContent("P2 Paused");
  expect(clock).toHaveTextContent("Held by System, P2");
  expect(within(details).getByText("P2 · Grace")).toBeVisible();
  expect(within(details).getByText("Selected pause")).toBeVisible();
  expect(
    within(details).getByText("New event requiring attention"),
  ).toBeVisible();
  expect(within(details).getByText("TV session dialog open")).toBeVisible();
  expect(within(details).getByText("Steam overlay open")).toBeVisible();
  const back = within(details).getByRole("button", {
    name: "Back to game menu",
  });
  expect(back).toHaveFocus();
  fireEvent.keyDown(back, { key: "Escape" });
  expect(screen.getByRole("button", { name: "Clock status" })).toHaveFocus();
  expect(value.onMenuClose).not.toHaveBeenCalled();
});

it("shows readiness and decisions for the active seat while keeping retired seats out of clock ownership", () => {
  const value = props();
  value.clock.speed = "PAUSED";
  value.clock.readyRequired = true;
  value.clock.reason = "Controller replaced";
  value.clock.players[0] = {
    ...value.clock.players[0],
    selectedSpeed: "PAUSED",
    pauseReason: "Retired company notification",
    retired: true,
  };
  value.clock.players[1].pendingChoice = "Winterization";
  value.clock.players[1].selectedSpeed = "PAUSED";
  show({ ...value, menuOpen: true });
  fireEvent.click(screen.getByRole("button", { name: "Clock status" }));
  const clock = screen.getByRole("group", { name: "Shared clock" });
  expect(clock).toHaveTextContent("P1 Retired");
  expect(clock).toHaveTextContent("Held by System, P2");
  expect(screen.getByText("Select a running speed to resume")).toBeVisible();
  expect(screen.getByText("Controller replaced")).toBeVisible();
  expect(screen.getByText("Selected pause")).toBeVisible();
  expect(
    screen.getByText("Choosing a response for Winterization"),
  ).toBeVisible();
  expect(screen.queryByText("Retired company notification")).toBeNull();
});

it("keeps the controller legend accessible inside the active menu modal only while open", () => {
  const value = props();
  function ControlledMenu() {
    const [open, setOpen] = useState(true);
    return (
      <CouchToolbar
        {...value}
        menuOpen={open}
        onMenuClose={() => setOpen(false)}
        menuFooter={
          <aside aria-label="Controller controls">
            Right stick: change speed
          </aside>
        }
      />
    );
  }
  render(
    <ThemeProvider theme={createAppTheme("light")}>
      <ControlledMenu />
    </ThemeProvider>,
  );
  expect(screen.getByRole("dialog", { name: "Game menu" })).toBeVisible();
  expect(
    screen.getByRole("complementary", { name: "Controller controls" }),
  ).toBeVisible();
  fireEvent.keyDown(screen.getByRole("dialog", { name: "Game menu" }), {
    key: "Escape",
  });
  expect(
    screen.queryByRole("complementary", { name: "Controller controls" }),
  ).toBeNull();
});
