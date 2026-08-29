import * as React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import VictoryDialog, { Props } from "./VictoryDialog";
import { VictoryType } from "../../Types";

const mockFetchGlobalRank = jest.fn();
jest.mock("../../reducers/User", () => ({
  fetchGlobalRank: (...args: unknown[]) => mockFetchGlobalRank(...args),
}));

const mockShareText = jest.fn();
jest.mock("../../helpers/Share", () => ({
  buildScoreShareContent: () => ({
    title: "score",
    text: "I scored 812 ...",
    url: "https://electrifygame.com",
  }),
  canShare: () => true,
  shareText: (...args: unknown[]) => mockShareText(...args),
}));

function aVictory(overrides: Partial<VictoryType> = {}): VictoryType {
  return {
    scenarioId: 101,
    scenarioName: "Deregulation",
    difficulty: "CEO",
    score: 812,
    breakdown: { supply: 800, emissions: 30, blackouts: -18 },
    ranked: true,
    ...overrides,
  };
}

function renderDialog(overrides: Partial<Props> = {}) {
  const props: Props = {
    victory: aVictory(),
    loggedIn: true,
    onClose: () => undefined,
    onQuit: () => undefined,
    onRetry: () => undefined,
    onLogin: () => undefined,
    onShared: () => undefined,
    onShareFailed: () => undefined,
    ...overrides,
  };
  render(<VictoryDialog {...props} />);
}

beforeEach(() => {
  jest.clearAllMocks();
  // A rank that never resolves, so the synchronous half of the dialog can be asserted on its own
  mockFetchGlobalRank.mockReturnValue(new Promise(() => undefined));
  mockShareText.mockResolvedValue("share");
});

describe("VictoryDialog", () => {
  it("renders nothing until a run has ended", () => {
    renderDialog({ victory: null });
    expect(screen.queryByText(/final score/)).not.toBeInTheDocument();
  });

  /**
   * The whole point of moving this out of the reducer: the score the player earned is on screen
   * immediately, and the parts that come over the network fill themselves in afterwards. A
   * Firestore hiccup must never cost someone their score screen.
   */
  it("shows the breakdown before any of the async data lands", () => {
    renderDialog();
    expect(screen.getByText(/812/)).toBeInTheDocument();
    expect(
      screen.getByText(/800 pts from electricity supplied/),
    ).toBeInTheDocument();
    expect(screen.getByText(/-18 pts from blackouts/)).toBeInTheDocument();
    expect(screen.queryByText("What you accomplished")).not.toBeInTheDocument();
  });

  it("uses the scenario name instead of repeating a generic completion title", () => {
    renderDialog({ victory: aVictory({ endTitle: "Mission complete!" }) });

    expect(screen.getByText("Deregulation")).toBeInTheDocument();
    expect(screen.getAllByText(/Mission complete/i)).toHaveLength(1);
  });

  it("shows how the fleet and company changed over the run", () => {
    renderDialog({
      victory: aVictory({
        debrief: {
          startingFleet: [
            { fuel: "Coal", watts: 300000000 },
            { fuel: "Natural Gas", watts: 200000000 },
          ],
          finalFleet: [
            { fuel: "Sun", watts: 400000000 },
            { fuel: "Natural Gas", watts: 200000000 },
          ],
          startingCash: 330000000,
          finalCash: 510000000,
          finalCustomers: 1200000,
          reliability: 0.998,
          unservedWh: 1000000000,
          kgco2e: 2000000000,
          highlights: [
            {
              kind: "CONSTRUCTION",
              label: "Jan 2028",
              message: "Construction complete: Solar",
            },
          ],
        },
      }),
    });

    expect(screen.getByText("The story of your grid")).toBeInTheDocument();
    expect(
      screen.getByRole("img", { name: /Coal 300MW, Natural Gas 200MW/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("img", { name: /Sun 400MW, Natural Gas 200MW/ }),
    ).toBeInTheDocument();
    expect(screen.getByText("99.8%")).toBeInTheDocument();
    expect(
      screen.getByText("Construction complete: Solar"),
    ).toBeInTheDocument();
  });

  it("fills in the global rank once it resolves", async () => {
    mockFetchGlobalRank.mockResolvedValue(4);
    renderDialog();
    expect(
      await screen.findByText(/on the global leaderboard/),
    ).toBeInTheDocument();
    expect(screen.getByText("#4")).toBeInTheDocument();
    expect(mockFetchGlobalRank).toHaveBeenCalledWith(101, 812);
  });

  it("drops the rank line rather than the dialog when the query fails", async () => {
    const warn = jest
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);
    mockFetchGlobalRank.mockRejectedValue(new Error("unavailable"));
    renderDialog();

    await waitFor(() =>
      expect(
        screen.queryByLabelText("Working out your rank"),
      ).not.toBeInTheDocument(),
    );
    expect(
      screen.getByText(/800 pts from electricity supplied/),
    ).toBeInTheDocument();
    expect(screen.queryByText(/global leaderboard/)).not.toBeInTheDocument();
    warn.mockRestore();
  });

  // previousBest is read when the run ends, before the score write, so it is the run before this
  // one rather than the one just finished
  it("celebrates a personal best against the previous one", () => {
    renderDialog({ victory: aVictory({ previousBest: 640 }) });
    expect(screen.getByText(/New personal best/)).toBeInTheDocument();
    expect(screen.getByText(/was 640/)).toBeInTheDocument();
  });

  it("reports the best that still stands when the run didn't beat it", () => {
    renderDialog({ victory: aVictory({ score: 500, previousBest: 640 }) });
    expect(screen.getByText(/Your best: 640/)).toBeInTheDocument();
    expect(screen.queryByText(/New personal best/)).not.toBeInTheDocument();
  });

  // Nothing is known about a logged-out player's history, so claiming anything about it would be
  // a guess - the prompt to log in is what belongs there instead
  it("offers a login rather than a personal best when logged out", () => {
    renderDialog({ loggedIn: false });
    expect(screen.queryByText(/personal best/)).not.toBeInTheDocument();
    expect(screen.getByText(/under your name/)).toBeInTheDocument();
  });

  // A custom game shares its scenario id with every other custom game, and a replay is someone
  // else's run - neither is comparable to anything on the board
  it("leaves out the rank and the best for an unranked run", () => {
    renderDialog({ victory: aVictory({ ranked: false }) });
    expect(mockFetchGlobalRank).not.toHaveBeenCalled();
    expect(screen.queryByText(/personal best/)).not.toBeInTheDocument();
    expect(screen.getByText(/812/)).toBeInTheDocument();
  });

  it("reports how a share went out", async () => {
    const onShared = jest.fn();
    mockShareText.mockResolvedValue("clipboard");
    renderDialog({ onShared });

    await userEvent.click(screen.getByText("Share score"));
    await waitFor(() => expect(onShared).toHaveBeenCalled());
    expect(onShared.mock.calls[0][1]).toBe("clipboard");
  });

  // Closing the share sheet is a decision, not a failure, and must not surface as an error
  it("says nothing when the player backs out of the share sheet", async () => {
    const onShared = jest.fn();
    const onShareFailed = jest.fn();
    mockShareText.mockResolvedValue("cancelled");
    renderDialog({ onShared, onShareFailed });

    await userEvent.click(screen.getByText("Share score"));
    await waitFor(() => expect(mockShareText).toHaveBeenCalled());
    expect(onShared).not.toHaveBeenCalled();
    expect(onShareFailed).not.toHaveBeenCalled();
  });

  it("keeps the ways out of a finished run", async () => {
    const onClose = jest.fn();
    const onQuit = jest.fn();
    renderDialog({ onClose, onQuit });

    await userEvent.click(screen.getByText("Review final grid"));
    expect(onClose).toHaveBeenCalled();
    await userEvent.click(screen.getByText("Choose scenario"));
    expect(onQuit).toHaveBeenCalled();
  });

  it.each([
    ["bankrupt", "Bankrupt!"],
    ["fired", "Fired!"],
  ] as const)(
    "shows a %s score without letting the terminal run resume",
    async (outcome, title) => {
      const onClose = jest.fn();
      renderDialog({ victory: aVictory({ outcome }), onClose });

      expect(screen.getByText("Run ended")).toBeInTheDocument();
      expect(screen.getByText(title)).toBeInTheDocument();
      expect(screen.queryByText("How you scored")).not.toBeInTheDocument();
      expect(screen.getByText(/Final score/)).toBeInTheDocument();
      expect(screen.queryByText("Review final grid")).not.toBeInTheDocument();
      await userEvent.keyboard("{Escape}");
      expect(onClose).not.toHaveBeenCalled();
    },
  );

  it("uses the scenario's own ending when it has one", () => {
    renderDialog({
      victory: aVictory({
        endTitle: "The lights stayed on",
        endMessage: "Your city never noticed.",
      }),
    });
    expect(screen.getByText("The lights stayed on")).toBeInTheDocument();
    expect(screen.getByText("Your city never noticed.")).toBeInTheDocument();
    // The breakdown is still there: the override replaces the flavour text, not the score
    expect(
      screen.getByText(/800 pts from electricity supplied/),
    ).toBeInTheDocument();
  });
});
