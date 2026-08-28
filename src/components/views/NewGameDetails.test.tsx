import * as React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { GameType } from "../../Types";
import NewGameDetails, { Props } from "./NewGameDetails";

const mockGetDocs = jest.fn();
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
    mockWhere.mockClear();
  });

  it("is always visible and follows the selected difficulty", async () => {
    const { rerender } = render(<NewGameDetails {...props()} />);

    expect(
      screen.getByRole("heading", { name: "Global High Scores — Easy" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("See global leaderboard")).toBeNull();
    expect(
      screen.queryByRole("columnheader", { name: "Difficulty" }),
    ).toBeNull();
    await waitFor(() =>
      expect(mockWhere).toHaveBeenCalledWith("difficulty", "==", "Employee"),
    );

    rerender(<NewGameDetails {...props({ game: game("CEO") })} />);

    expect(
      screen.getByRole("heading", { name: "Global High Scores — Expert" }),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(mockWhere).toHaveBeenCalledWith("difficulty", "==", "CEO"),
    );
  });
});
