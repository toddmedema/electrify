import * as React from "react";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { GameType } from "../../Types";
import NewGameDetails, { Props } from "./NewGameDetails";
import { DesktopBridge } from "../../Desktop";
import { ScoreType } from "../../Types";

const mockGetDocs = jest.fn();
const mockDesktopScores = jest.fn();
jest.mock("../../DesktopScores", () => ({
  desktopScores: (...args: unknown[]) => mockDesktopScores(...args),
}));
const mockPrefetchScenarioData = jest.fn();
const mockWhere = jest.fn((field: string, op: string, value: unknown) => ({
  field,
  op,
  value,
}));

jest.mock("firebase/firestore", () => ({
  collection: jest.fn(() => "scores"),
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
    ...overrides,
  };
}

describe("NewGameDetails leaderboard", () => {
  afterEach(() => {
    delete window.electrifyDesktop;
  });
  beforeEach(() => {
    mockGetDocs.mockResolvedValue({ docs: [] });
    mockPrefetchScenarioData.mockClear();
    mockWhere.mockClear();
  });

  it("prefetches scenario data and keeps the leaderboard visible at the selected difficulty", async () => {
    const { rerender } = render(<NewGameDetails {...props()} />);
    expect(mockPrefetchScenarioData).toHaveBeenCalledWith(
      expect.objectContaining({ id: "SF" }),
    );
    await screen.findByText("Complete this mission to join the leaderboard");
    expect(mockWhere).toHaveBeenCalledWith("scoreVersion", "==", 2);
    expect(mockWhere).toHaveBeenCalledWith("outcome", "==", "completed");

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

  it("keeps the board's space while a new difficulty loads and returns fewer scores", async () => {
    mockGetDocs.mockResolvedValueOnce({
      docs: Array.from({ length: 3 }, (_, index) => ({
        data: () => ({
          displayName: `Player ${index + 1}`,
          score: 500 - index,
        }),
      })),
    });
    const { rerender } = render(<NewGameDetails {...props()} />);
    await screen.findByText("Player 3");
    const board = screen.getByRole("region", { name: "Leaderboard — Easy" });
    jest
      .spyOn(board, "getBoundingClientRect")
      .mockReturnValue({ height: 360 } as DOMRect);
    let finish!: (value: { docs: [] }) => void;
    mockGetDocs.mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );

    rerender(<NewGameDetails {...props({ game: game("CEO") })} />);
    await screen.findByText("Loading...");
    expect(board).toHaveStyle({ minHeight: "360px" });
    expect(screen.queryByText("Player 3")).not.toBeInTheDocument();

    await act(async () => {
      finish({ docs: [] });
    });
    await screen.findByText("Complete this mission to join the leaderboard");
    expect(board).toHaveStyle({ minHeight: "360px" });
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
    expect(cells).toHaveLength(3);
    expect(
      screen.getAllByRole("columnheader").map((cell) => cell.textContent),
    ).toEqual(["Leaderboard — Easy", "#", "Name", "Score"]);
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

  it("uses Steam friends scores and ignores a stale global response on the expanded board", async () => {
    window.electrifyDesktop = { apiVersion: 1 } as DesktopBridge;
    const score = (displayName: string): ScoreType =>
      ({
        displayName,
        score: 500,
        scenarioId: 100,
        difficulty: "Employee",
        uid: "steam:2",
        scoreBreakdown: {},
      }) as ScoreType;
    let resolveGlobal!: (scores: ScoreType[]) => void;
    const globalRequest = new Promise<ScoreType[]>((resolve) => {
      resolveGlobal = resolve;
    });
    mockDesktopScores.mockImplementation(
      (_scenarioId: number, difficulty: string | undefined, scope: string) =>
        scope === "friends"
          ? Promise.resolve([score("Steam friend")])
          : difficulty
            ? Promise.resolve([score("Global player")])
            : globalRequest,
    );
    render(<NewGameDetails {...props()} />);
    await screen.findByText("Global player");
    await userEvent.click(
      screen.getByRole("button", { name: "View all scores" }),
    );
    await userEvent.click(screen.getByRole("button", { name: "Friends" }));
    await screen.findByText("Steam friend");
    await act(async () => {
      resolveGlobal([score("Stale global player")]);
      await globalRequest;
    });
    expect(screen.getByText("Steam friend")).toBeInTheDocument();
    expect(screen.queryByText("Stale global player")).not.toBeInTheDocument();
    expect(mockGetDocs).not.toHaveBeenCalled();
    expect(
      screen.getAllByRole("columnheader").map((cell) => cell.textContent),
    ).toEqual(["Leaderboard — All levels", "#", "Name", "Score", "Level"]);
  });
});
