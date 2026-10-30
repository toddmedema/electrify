import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { getTimeFromTimeline, MINUTES_PER_MONTH } from "../../helpers/DateTime";
import { TICK_MINUTES } from "../../Constants";
import { formatMoneyStable } from "../../helpers/Format";
import { ThemeProvider } from "@mui/material/styles";
import { createAppTheme } from "../../Theme";
import userEvent from "@testing-library/user-event";
import { createGame } from "../../testing/Simulator";
import { modScenario } from "../../mods/ModScenario";
import { TickPresentFutureType } from "../../Types";
import {
  GameAppBar,
  getGridHealth,
  Props,
  reserveCapacityW,
  stableGridSummary,
} from "./GameAppBar";

let mockDesktop = false;
let mockPaneLayout = true;
jest.mock("../../Globals", () => ({
  ...jest.requireActual("../../Globals"),
  isBigScreen: () => true,
  isDesktopScreen: () => mockDesktop,
  isPaneLayout: () => mockPaneLayout,
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
  return render(
    <ThemeProvider theme={createAppTheme("light")}>
      <GameAppBar {...props} />
    </ThemeProvider>,
  );
}

const originalMatchMedia = window.matchMedia;
beforeEach(() => {
  window.matchMedia = (query: string) => ({
    ...originalMatchMedia(query),
    matches:
      (query.includes("min-width:1300px") ||
        query.includes("min-width:1024px")) &&
      mockDesktop,
  });
});
afterEach(() => {
  window.matchMedia = originalMatchMedia;
});
// Fake timers and nodes added outside React must not leak into later tests when one fails.
const attached: Element[] = [];
function attach(...nodes: Element[]) {
  document.body.append(...nodes);
  attached.push(...nodes);
}
afterEach(() => {
  jest.useRealTimers();
  attached.splice(0).forEach((node) => node.remove());
});

describe("GameAppBar", () => {
  it.each([1, -1, 0])(
    "shows the current month profit forecast beside cash on desktop (%s)",
    (sign) => {
      mockDesktop = true;
      try {
        const game = createGame({ scenarioId: 101 });
        game.inGame = true;
        const tick = {
          ...game.timeline[0],
          revenue: sign > 0 ? 200000 : 0,
          expensesFuel: sign < 0 ? 100000 : 0,
          expensesOM: 0,
          expensesCarbonFee: 0,
          expensesInterest: sign === 0 ? 0 : 10000,
          expensesPolicy: 0,
          expensesImports: sign === 0 ? 0 : 5000,
        };
        game.timeline = [
          { ...tick, minute: 0 },
          { ...tick, minute: TICK_MINUTES },
          { ...tick, minute: MINUTES_PER_MONTH, revenue: 1000000000 },
        ];
        // Two current-month samples include interest and imports; the next month is excluded.
        const expected = sign > 0 ? 370000 : sign < 0 ? -230000 : 0;
        renderAppBar({ game });
        const profit = screen.getByLabelText(
          `Monthly profit forecast ${formatMoneyStable(expected)}`,
        );
        expect(profit).toHaveTextContent(
          `${expected > 0 ? "+" : ""}${formatMoneyStable(expected)}/mo`,
        );
        const palette = createAppTheme("light").palette;
        expect(profit).toHaveStyle({
          color:
            sign < 0
              ? palette.error.main
              : sign > 0
                ? palette.success.main
                : palette.text.secondary,
        });
      } finally {
        mockDesktop = false;
      }
    },
  );

  it("keeps the profit forecast out of the phone top bar", () => {
    renderAppBar();
    expect(screen.queryByLabelText(/^Monthly profit forecast/)).toBeNull();
  });
  it("opens the feedback form directly from the game menu", () => {
    const open = jest.spyOn(window, "open").mockImplementation(() => null);
    try {
      renderAppBar();
      fireEvent.click(screen.getByRole("button", { name: "menu" }));
      fireEvent.click(screen.getByRole("menuitem", { name: "Send feedback" }));
      expect(open).toHaveBeenCalledWith(
        "https://forms.gle/nSpkVzcFcXMQMMgb9",
        "_system",
      );
    } finally {
      open.mockRestore();
    }
  });

  it("keeps the menu action named consistently while announcing offline saving", () => {
    const online = jest
      .spyOn(window.navigator, "onLine", "get")
      .mockReturnValue(false);
    try {
      renderAppBar();
      const menu = screen.getByRole("button", { name: "menu" });
      expect(menu).toHaveAccessibleDescription(
        "Offline: saving to this device only",
      );
      fireEvent.click(menu);
      expect(
        screen.getByRole("menuitem", {
          name: "Offline: saving to this device only",
        }),
      ).toHaveAttribute("aria-disabled", "true");
    } finally {
      online.mockRestore();
    }
  });

  it.each(["click", "{Enter}", " "])(
    "opens scenario info from the months remaining with %s",
    async (action) => {
      const onEvidence = jest.fn();
      renderAppBar({ onEvidence });
      const months = screen.getByRole("button", { name: /months left$/ });
      if (action === "click") await userEvent.click(months);
      else {
        act(() => months.focus());
        await userEvent.keyboard(action);
      }
      expect(onEvidence).toHaveBeenCalledTimes(1);
      expect(onEvidence).toHaveBeenCalledWith("mission-details");
    },
  );

  it.each(["idle", "saving", "saved"] as const)(
    "keeps routine %s indicators off the game screen",
    (saveState) => {
      renderAppBar({
        saveState,
        savedAt: new Date().toISOString(),
        activeSave: { id: "A", name: "Experiment" },
      });
      expect(
        screen.queryByText(/Saved just now|Saving…|Preparing save…/),
      ).not.toBeInTheDocument();
      expect(screen.queryByRole("status")).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "menu" }));
      expect(
        screen.queryByRole("menuitem", { name: /Rename/ }),
      ).not.toBeInTheDocument();
    },
  );
  it("keeps save failure visible and opens recovery from the status", () => {
    const onSavedGames = jest.fn();
    renderAppBar({
      saveState: "failed",
      saveError: "Browser storage is full.",
      onSavedGames,
    });
    const status = screen.getByRole("alert");
    expect(status).toHaveAttribute("data-save-state", "failed");
    expect(status).toHaveAttribute("title", "Browser storage is full.");
    fireEvent.click(
      screen.getByRole("button", { name: "Save failed · Manage saves" }),
    );
    expect(onSavedGames).toHaveBeenCalledTimes(1);
  });
  it("labels a modded run as unranked in words for the whole run", () => {
    const scenario = modScenario({
      schemaVersion: 1,
      gameApi: 1,
      id: "grid",
      title: "Grid",
      creator: "A",
      version: "1",
      description: "A modded grid for testing its unranked label.",
      seed: 42,
      baseScenarioId: 999,
    });
    const game = createGame({ scenarioId: 999, scenario });
    const { unmount } = renderAppBar();
    expect(screen.queryByText("Modded · Unranked")).toBeNull();
    unmount();
    renderAppBar({ game: { ...game, inGame: true } });
    expect(screen.getByText("Modded · Unranked")).toBeInTheDocument();
  });
  afterEach(() => {
    mockDesktop = false;
  });

  it("labels the frame-aligned speeds and offers ULTRA only on desktop-sized screens", () => {
    const { unmount } = renderAppBar();
    expect(
      screen.getByRole("button", { name: "fast speed" }),
    ).toHaveTextContent("12×");
    expect(screen.queryByRole("button", { name: "ultra speed" })).toBeNull();
    unmount();

    mockDesktop = true;
    renderAppBar();
    expect(
      screen.getByRole("button", { name: "ultra speed" }),
    ).toHaveTextContent("24×");
  });

  it("drops ULTRA to FAST once the screen is no longer desktop-sized", () => {
    const onSpeedChange = jest.fn();
    const game = createGame({ scenarioId: 101 });
    renderAppBar({
      game: { ...game, inGame: true, speed: "ULTRA" },
      onSpeedChange,
    });
    expect(onSpeedChange).toHaveBeenCalledWith("FAST");
  });

  it("keeps ULTRA on a desktop-sized screen", () => {
    mockDesktop = true;
    const onSpeedChange = jest.fn();
    const game = createGame({ scenarioId: 101 });
    renderAppBar({
      game: { ...game, inGame: true, speed: "ULTRA" },
      onSpeedChange,
    });
    expect(onSpeedChange).not.toHaveBeenCalled();
  });

  it("keeps a multiplayer player's ULTRA selection on phones while the shared clock is paused", () => {
    const game = createGame({ scenarioId: 101 });
    const onSpeedChange = jest.fn();
    renderAppBar({
      onSpeedChange,
      game: {
        ...game,
        inGame: true,
        speed: "PAUSED",
        multiplayer: {
          seat: "1",
          clock: {
            activeSpeed: "PAUSED",
            selectedSpeed: "ULTRA",
            reason: "Waiting for players",
            readyRequired: true,
            ready: false,
            players: [
              { id: "1", name: "Player 1", selectedSpeed: "ULTRA" },
              { id: "2", name: "Player 2", selectedSpeed: "SLOW" },
            ],
          },
        },
      },
    });
    expect(screen.getByRole("button", { name: "ultra speed" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(
      screen.getByRole("group", { name: "your game speed" }),
    ).toHaveAccessibleDescription(/Game speed: Paused/);
    expect(onSpeedChange).not.toHaveBeenCalled();
    expect(
      screen.getByRole("group", { name: "your game speed" }),
    ).toHaveAccessibleDescription(/Player 2 selected 1×/);
    fireEvent.click(screen.getByRole("button", { name: "ultra speed" }));
    expect(onSpeedChange).toHaveBeenCalledWith("ULTRA");
  });

  /* eslint-disable testing-library/no-container, testing-library/no-node-access --
     where the status row sits in the bar is the behaviour under test */
  it("folds the status row into the top bar, between the date and the speeds, on wide windows", () => {
    const matchMedia = window.matchMedia;
    window.matchMedia = (query: string) =>
      ({
        ...matchMedia(query),
        matches: query.includes("min-width:1300px"),
      }) as MediaQueryList;
    try {
      const { container } = renderAppBar();
      const appbar = container.querySelector("#appbar")!;
      const toolbar = appbar.querySelector("#topbar .MuiToolbar-root")!;
      expect(appbar).toHaveClass("appbarSingleRow");
      expect(Array.from(toolbar.children, (child) => child.className)).toEqual([
        expect.stringContaining("gameMenuButton"),
        expect.stringContaining("gameStatus"),
        "gameStatusBar",
        "",
      ]);
      expect(toolbar.lastElementChild).toHaveAttribute(
        "id",
        "speedChangeButtons",
      );
      expect(appbar.querySelectorAll(".gameStatusBar")).toHaveLength(1);
      // The months label keeps its full text for assistive tech and copy, only its tail can hide.
      expect(appbar.querySelector(".missionSummaryMonths")).toHaveTextContent(
        /^\d+ months left$/,
      );
    } finally {
      window.matchMedia = matchMedia;
    }
  });

  it.each([/Wildfire emergency/, /months left$/])(
    "keeps keyboard focus on %s when the window crosses the single-row width",
    async (name) => {
      const matchMedia = window.matchMedia;
      let wide = false;
      const listeners = new Set<() => void>();
      window.matchMedia = (query: string) =>
        ({
          ...matchMedia(query),
          get matches() {
            return query.includes("min-width:1300px") && wide;
          },
          addListener: (listener: () => void) => listeners.add(listener),
          removeListener: (listener: () => void) => listeners.delete(listener),
          addEventListener: (_: string, listener: () => void) =>
            listeners.add(listener),
          removeEventListener: (_: string, listener: () => void) =>
            listeners.delete(listener),
        }) as unknown as MediaQueryList;
      const resize = (next: boolean) =>
        act(async () => {
          wide = next;
          listeners.forEach((listener) => listener());
        });
      try {
        const { container } = renderAppBar({
          activeEvents: [
            {
              key: "fire",
              title: "Wildfire emergency",
              importance: "CRITICAL",
              count: 1,
              throughLabel: "through Mar 2026",
            },
          ],
        });
        const control = () => screen.getByRole("button", { name });
        await act(async () => control().focus());
        // Document geometry can still report the wide layout when the media query changes.
        mockDesktop = true;
        await resize(true);
        expect(
          screen.getByRole("button", { name: "ultra speed" }),
        ).toBeVisible();
        expect(
          container.querySelector("#topbar .gameStatusBar"),
        ).not.toBeNull();
        expect(control()).toHaveFocus();
        await resize(false);
        expect(
          screen.queryByRole("button", { name: "ultra speed" }),
        ).toBeNull();
        expect(container.querySelector("#topbar .gameStatusBar")).toBeNull();
        expect(control()).toHaveFocus();
      } finally {
        window.matchMedia = matchMedia;
      }
    },
  );

  it("keeps the status in its own row below the top bar on narrower windows", () => {
    const { container } = renderAppBar();
    const appbar = container.querySelector("#appbar")!;
    expect(appbar).not.toHaveClass("appbarSingleRow");
    expect(appbar.querySelector("#topbar .gameStatusBar")).toBeNull();
    expect(appbar.querySelector(":scope > .gameStatusBar")).not.toBeNull();
  });

  /* eslint-enable testing-library/no-container, testing-library/no-node-access */

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
    expect(
      screen.getByText(/^Stable, \d.*[kMGT]?W reserve$/),
    ).toBeInTheDocument();
    expect(
      screen.getByLabelText(/Current grid status: Stable, .* reserve/),
    ).toBeVisible();
  });

  it("shrinks a stable grid to a checked icon on phones, with the full readout on hover", async () => {
    mockPaneLayout = false;
    try {
      const game = createGame({ scenarioId: 101 });
      const now = getTimeFromTimeline(game.date.minute, game.timeline)!;
      now.supplyW = now.demandW;
      now.demandW = 72e6;
      now.reserveW = 10e6;
      expect(stableGridSummary(game, now)).toBe(
        "Stable, 72MW demand met with 10MW reserve",
      );
      renderAppBar({ game: { ...game, inGame: true } });
      expect(screen.queryByText(/^Stable, /)).not.toBeInTheDocument();
      const status = screen.getByRole("button", {
        name: "Current grid status: Stable, 72MW demand met with 10MW reserve",
      });
      fireEvent.mouseOver(status);
      expect(
        await screen.findByRole("tooltip", {
          name: "Stable, 72MW demand met with 10MW reserve",
        }),
      ).toBeVisible();
    } finally {
      mockPaneLayout = true;
    }
  });

  it.each(["low-reserve", "at-limit", "blackout-ahead", "blackout"] as const)(
    "keeps %s compact on phones with details available by tap",
    async (state) => {
      mockPaneLayout = false;
      try {
        const game = createGame({ scenarioId: 101 });
        const now = getTimeFromTimeline(game.date.minute, game.timeline)!;
        now.supplyW = now.demandW;
        now.reserveW = state === "at-limit" ? 0 : now.demandW * 0.05;
        if (state === "blackout") now.supplyW = now.demandW - 10e6;
        if (state === "blackout-ahead") {
          const later = game.timeline.find((tick) => tick.minute > now.minute)!;
          later.demandW = later.supplyW + 10e6;
        }
        const health = getGridHealth(game, now);
        expect(health.state).toBe(state);
        const summary = `${health.label}, ${health.metric}`;
        renderAppBar({ game: { ...game, inGame: true } });
        const status = screen.getByRole("button", {
          name: `Current grid status: ${summary}`,
        });
        expect(status).toHaveTextContent(/^$/);
        expect(screen.queryByText(summary)).not.toBeInTheDocument();
        fireEvent.click(status);
        expect(
          await screen.findByRole("tooltip", { name: summary }),
        ).toBeVisible();
        fireEvent.click(status);
        await waitFor(() => {
          expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
        });
      } finally {
        mockPaneLayout = true;
      }
    },
  );

  it("warns when reachable reserve falls to five percent of demand", () => {
    const game = createGame({ scenarioId: 101 });
    const now = getTimeFromTimeline(game.date.minute, game.timeline)!;
    now.supplyW = now.demandW;
    now.reserveW = now.demandW * 0.05;
    expect(getGridHealth(game, now)).toMatchObject({
      state: "low-reserve",
      metric: expect.stringMatching(/\(5%\)/),
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

  it("reports a shortfall later today instead of a reassuring reserve", () => {
    const game = createGame({ scenarioId: 101 });
    const now = getTimeFromTimeline(game.date.minute, game.timeline)!;
    now.supplyW = now.demandW;
    now.reserveW = now.demandW * 0.5;
    const later = game.timeline.find((tick) => tick.minute > now.minute)!;
    later.demandW = later.supplyW + 120_000_000;
    expect(getGridHealth(game, now)).toMatchObject({
      state: "blackout-ahead",
      label: expect.stringMatching(/^Blackout (today|tonight) at \d+ [AP]M$/),
      metric: "120MW short",
    });
    // A blackout happening now still outranks the one expected later.
    expect(
      getGridHealth(game, {
        ...now,
        supplyW: now.demandW - 1_000_000,
      } as TickPresentFutureType).state,
    ).toBe("blackout");
    renderAppBar({ game: { ...game, inGame: true } });
    const readout = screen.getByLabelText(
      /Current grid status: Blackout (today|tonight) at \d+ [AP]M, 120MW short/,
    );
    expect(readout).toHaveClass("statusWarning");
    expect(screen.queryByText(/^Stable/)).toBeNull();
  });

  it("shows active events in the mission row and opens Events", () => {
    const onEvidence = jest.fn();
    renderAppBar({
      activeEvents: [
        {
          key: "fire",
          title: "Wildfire emergency",
          importance: "CRITICAL",
          count: 1,
          throughLabel: "through Mar 2026",
        },
      ],
      onEvidence,
    });
    const chip = screen.getByRole("button", { name: /Wildfire emergency/ });
    const readout = screen.getByLabelText(/Current grid status/);
    expect(readout).not.toContainElement(chip);
    expect(screen.getByLabelText("Mission progress")).toContainElement(chip);
    fireEvent.click(chip);
    expect(onEvidence).toHaveBeenCalledWith({ card: "EVENTS" });
  });

  it("leaves active events to the tutorial HUD", () => {
    const game = createGame({ scenarioId: 0 });
    renderAppBar({
      game: { ...game, inGame: true },
      activeEvents: [
        {
          key: "fire",
          title: "Wildfire emergency",
          importance: "CRITICAL",
          count: 1,
          throughLabel: "through Mar 2026",
        },
      ],
    });
    expect(screen.queryByRole("button", { name: /Active events/ })).toBeNull();
  });

  it("returns focus to the primary action after Save & Quit", () => {
    jest.useFakeTimers();
    const target = document.createElement("button");
    target.dataset.mainAction = "";
    attach(target);
    const onQuit = jest.fn();
    renderAppBar({ onQuit });

    fireEvent.click(screen.getByRole("button", { name: "menu" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Save & Quit" }));
    act(() => jest.advanceTimersByTime(350));

    expect(onQuit).toHaveBeenCalled();
    expect(target).toHaveFocus();
  });

  it("Save & Quit preserves a later menu selection", () => {
    jest.useFakeTimers();
    renderAppBar();
    fireEvent.click(screen.getByRole("button", { name: "menu" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Save & Quit" }));
    render(
      <>
        <button data-main-action>Continue</button>
        <button>Saved games shortcut</button>
      </>,
    );
    const library = screen.getByRole("button", {
      name: "Saved games shortcut",
    });
    act(() => library.focus());
    fireEvent.keyDown(library, { key: "Enter" });
    act(() => jest.advanceTimersByTime(350));
    expect(library).toHaveFocus();
  });

  it.each([false, true])(
    "keeps the solo save library outside a multiplayer game (%s)",
    (multiplayer) => {
      const game = createGame({ scenarioId: 101 });
      const onQuit = jest.fn();
      renderAppBar({
        game: {
          ...game,
          inGame: true,
          multiplayer: multiplayer ? { seat: "1" } : undefined,
        },
        onQuit,
      });
      fireEvent.click(screen.getByRole("button", { name: "menu" }));
      expect(
        screen.queryAllByRole("menuitem", { name: "Saved games" }),
      ).toHaveLength(multiplayer ? 0 : 1);
      fireEvent.click(screen.getByRole("menuitem", { name: "Save & Quit" }));
      expect(onQuit).toHaveBeenCalledTimes(1);
    },
  );
});
