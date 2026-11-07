import { fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { ThemeProvider } from "@mui/material/styles";
import { createAppTheme } from "../Theme";
import { createGame } from "../testing/Simulator";
import CouchToolbar, { CouchToolbarProps } from "./Toolbar";

function props(overrides: Partial<CouchToolbarProps> = {}): CouchToolbarProps {
  return {
    game: createGame({ scenarioId: 101 }),
    menuOpen: false,
    onMenuOpen: jest.fn(),
    onMenuClose: jest.fn(),
    onManual: jest.fn(),
    onSettings: jest.fn(),
    onSaveQuit: jest.fn(),
    ...overrides,
  };
}

function show(value: CouchToolbarProps) {
  return render(
    <ThemeProvider theme={createAppTheme("light")}>
      <CouchToolbar {...value} />
    </ThemeProvider>,
  );
}

it("shows one shared calendar while speed controls stay in the player panes", () => {
  const value = props();
  show(value);
  expect(screen.getAllByRole("button", { name: "menu" })).toHaveLength(1);
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
  expect(screen.queryByText(/On this TV|Unranked|Last local save/)).toBeNull();
  expect(
    screen.queryByRole("button", { name: "Save & Quit for everyone" }),
  ).toBeNull();
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

it("opens the shared three-dot menu and delegates actions without a duplicate quit button", () => {
  const value = props();
  function ControlledMenu() {
    const [open, setOpen] = useState(false);
    return (
      <CouchToolbar
        {...value}
        menuOpen={open}
        onMenuOpen={() => setOpen(true)}
        onMenuClose={() => setOpen(false)}
      />
    );
  }
  render(
    <ThemeProvider theme={createAppTheme("light")}>
      <ControlledMenu />
    </ThemeProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: "menu" }));
  const menu = screen.getByRole("menu", { name: "Game menu" });
  expect(within(menu).getByRole("menuitem", { name: "Manual" })).toBeVisible();
  fireEvent.click(within(menu).getByRole("menuitem", { name: "Settings" }));
  expect(value.onSettings).toHaveBeenCalledTimes(1);
  fireEvent.click(within(menu).getByRole("menuitem", { name: "Save & Quit" }));
  expect(value.onSaveQuit).toHaveBeenCalledTimes(1);
});

it("keeps the controller legend accessible inside the active menu modal only while open", () => {
  const value = props();
  function ControlledMenu() {
    const [open, setOpen] = useState(false);
    return (
      <CouchToolbar
        {...value}
        menuOpen={open}
        onMenuOpen={() => setOpen(true)}
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
  expect(
    screen.queryByRole("complementary", { name: "Controller controls" }),
  ).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "menu" }));
  expect(screen.getByRole("menu", { name: "Game menu" })).toBeVisible();
  expect(
    screen.getByRole("complementary", { name: "Controller controls" }),
  ).toBeVisible();
  fireEvent.keyDown(screen.getByRole("menu", { name: "Game menu" }), {
    key: "Escape",
  });
  expect(
    screen.queryByRole("complementary", { name: "Controller controls" }),
  ).toBeNull();
});
