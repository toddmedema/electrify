import * as React from "react";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { GameType } from "../../Types";
import NewGameDetails, { Props } from "./NewGameDetails";

const mockGetDocs = jest.fn();
const mockPrefetchScenarioData = jest.fn();
const mockWhere = jest.fn((field: string, op: string, value: unknown) => ({
  field,
  op,
  value,
}));

jest.mock("firebase/firestore", () => ({
  collection: jest.fn(() => "scores"),
  doc: jest.fn(),
  getDoc: jest.fn(),
  getDocs: (...args: unknown[]) => mockGetDocs(...args),
  query: jest.fn((...args: unknown[]) => args),
  where: (...args: [string, string, unknown]) => mockWhere(...args),
  orderBy: jest.fn((...args: unknown[]) => args),
  limit: jest.fn((...args: unknown[]) => args),
}));

jest.mock("../../Globals", () => ({
  getDb: jest.fn(() => ({})),
  getLocalStorage: jest.fn(() => globalThis.localStorage),
  login: jest.fn(),
}));

jest.mock("../../helpers/OfflineData", () => ({
  prefetchScenarioData: (...args: unknown[]) =>
    mockPrefetchScenarioData(...args),
}));

function game(difficulty: GameType["difficulty"]): GameType {
  return { scenarioId: 100, difficulty } as GameType;
}

function props(overrides: Partial<Props> = {}): Props {
  return {
    game: game("Employee"),
    onBack: jest.fn(),
    onDelta: jest.fn(),
    onStart: jest.fn(),
    onWatchReplay: jest.fn(),
    onReplayError: jest.fn(),
    ...overrides,
  };
}

describe("NewGameDetails leaderboard", () => {
  beforeEach(() => {
    mockGetDocs.mockResolvedValue({ docs: [] });
    mockPrefetchScenarioData.mockClear();
    mockWhere.mockClear();
  });

  it("prefetches the scenario data while the player reads its details", async () => {
    render(<NewGameDetails {...props()} />);

    expect(mockPrefetchScenarioData).toHaveBeenCalledWith(
      expect.objectContaining({ id: "SF" }),
    );
    await screen.findByText("Finish this game to join the leaderboard");
  });

  it("leads with the scenario fantasy, objective, and stakes", async () => {
    render(<NewGameDetails {...props()} />);

    expect(
      screen.getByRole("img", { name: "Carbon Fee icon" }),
    ).toHaveAttribute("src", "/images/carbon fee.svg");
    expect(
      screen.getByRole("heading", {
        name: "Carbon Fee",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Modernize an aging grid as pollution gets more expensive.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("Your goal")).toBeInTheDocument();
    expect(screen.getByText("The catch")).toBeInTheDocument();
    expect(screen.getByText("Watch out")).toBeInTheDocument();
    expect(screen.queryByText("Winning looks like")).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "What counts as a win" }),
    ).toBeVisible();
    expect(screen.getByRole("button", { name: "Start game" })).toBeVisible();
    expect(screen.getByText(/Forgiving: lower costs/)).toBeVisible();
    await screen.findByText("Finish this game to join the leaderboard");
  });

  it("is always visible and follows the selected difficulty", async () => {
    const { rerender } = render(<NewGameDetails {...props()} />);

    expect(
      screen.getByRole("heading", { name: "Leaderboard — Easy" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("See global leaderboard")).toBeNull();
    expect(screen.queryByRole("columnheader", { name: "Level" })).toBeNull();
    await waitFor(() =>
      expect(mockWhere).toHaveBeenCalledWith("difficulty", "==", "Employee"),
    );

    rerender(<NewGameDetails {...props({ game: game("CEO") })} />);

    expect(
      screen.getByRole("heading", { name: "Leaderboard — Expert" }),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(mockWhere).toHaveBeenCalledWith("difficulty", "==", "CEO"),
    );
  });

  it("offers every difficulty as a one-tap choice", async () => {
    const onDelta = jest.fn();
    render(<NewGameDetails {...props({ onDelta })} />);

    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Easy" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    await userEvent.click(screen.getByRole("button", { name: "Expert" }));

    expect(onDelta).toHaveBeenCalledWith({ difficulty: "CEO" });
  });

  it("puts the player's best score in the score column", async () => {
    mockGetDocs.mockResolvedValueOnce({ docs: [] }).mockResolvedValueOnce({
      docs: [{ data: () => ({ score: 432, uid: "player" }) }],
    });

    render(<NewGameDetails {...props({ uid: "player" })} />);

    await screen.findByText("Your best");
    const row = screen.getByRole("row", { name: /Your best 432/ });
    const cells = within(row).getAllByRole("cell");
    expect(cells[1]).toHaveTextContent("Your best");
    expect(cells[2]).toHaveTextContent("432");
    expect(cells[1]).not.toHaveTextContent("432");
  });

  it("shows all difficulties and their labels only on the expanded board", async () => {
    mockGetDocs
      .mockResolvedValueOnce({
        docs: Array.from({ length: 5 }, (_, index) => ({
          data: () => ({
            score: 500 - index,
            displayName: `Player ${index + 1}`,
            difficulty: "Employee",
          }),
        })),
      })
      .mockResolvedValueOnce({
        docs: [
          {
            data: () => ({
              score: 900,
              displayName: "Expert Player",
              difficulty: "CEO",
            }),
          },
          {
            data: () => ({
              score: 800,
              displayName: "Beginner Player",
              difficulty: "Intern",
            }),
          },
        ],
      });
    render(<NewGameDetails {...props()} />);

    await screen.findByText("Player 3");
    expect(screen.queryByText("Player 4")).toBeNull();
    expect(screen.queryByRole("columnheader", { name: "Level" })).toBeNull();
    await userEvent.click(
      screen.getByRole("button", { name: "View all scores" }),
    );
    expect(
      await screen.findByRole("heading", {
        name: "Leaderboard — All levels",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("columnheader", { name: "Level" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("row", { name: /Expert Player 900 Expert/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("row", { name: /Beginner Player 800 Beginner/ }),
    ).toBeInTheDocument();
    expect(
      mockWhere.mock.calls.filter(([field]) => field === "difficulty"),
    ).toHaveLength(1);
  });
});
