import * as React from "react";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { GameType } from "../../Types";
import NewGameDetails, { Props } from "./NewGameDetails";
import { login } from "../../Globals";
import { DesktopBridge } from "../../Desktop";
import { DIFFICULTY_IDS } from "../../Constants";
import { DifficultyType, ScoreType } from "../../Types";

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
  it.each([false, true])(
    "passes mailing-list choice %s to Google sign-in",
    async (mailingList) => {
      render(<NewGameDetails {...props()} />);
      const checkbox = screen.getByRole("checkbox", {
        name: "Join the Electrify mailing list",
      });
      expect(checkbox).not.toBeChecked();
      if (mailingList) await userEvent.click(checkbox);
      await userEvent.click(
        screen.getByRole("button", { name: "Sign in with Google" }),
      );
      expect(login).toHaveBeenLastCalledWith({ mailingList });
    },
  );

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

  it("keeps the board's space when the difficulty chosen has fewer scores", async () => {
    respond(({ difficulty }) =>
      difficulty === "Employee"
        ? Array.from({ length: 3 }, (_, index) =>
            scoreRow(`Player ${index + 1}`, 500 - index),
          )
        : [],
    );
    const { rerender } = render(<NewGameDetails {...props()} />);
    await screen.findByText("Player 3");
    await flush();
    const board = screen.getByRole("region", { name: "Leaderboard — Easy" });
    jest
      .spyOn(board, "getBoundingClientRect")
      .mockReturnValue({ height: 360 } as DOMRect);

    rerender(<NewGameDetails {...props({ game: game("CEO") })} />);
    expect(
      screen.getByText("Complete this mission to join the leaderboard"),
    ).toBeInTheDocument();
    expect(board).toHaveStyle({ minHeight: "360px" });
    expect(screen.queryByText("Player 3")).not.toBeInTheDocument();
  });

  it("puts the player's best score in the score column", async () => {
    respond(({ uid }) => (uid ? [scoreRow("Me", 432, { uid })] : []));

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
    respond(({ difficulty }) =>
      difficulty === undefined
        ? [
            scoreRow("Expert Player", 900, { difficulty: "CEO" }),
            scoreRow("Beginner Player", 800, { difficulty: "Intern" }),
          ]
        : difficulty === "Employee"
          ? Array.from({ length: 5 }, (_, index) =>
              scoreRow(`Player ${index + 1}`, 500 - index, {
                difficulty: "Employee",
              }),
            )
          : [],
    );
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
    // One filtered query per difficulty read up front; the all-levels board adds none
    expect(
      mockWhere.mock.calls.filter(([field]) => field === "difficulty"),
    ).toHaveLength(DIFFICULTY_IDS.length);
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

describe("NewGameDetails reads every difficulty up front", () => {
  const topRow = (difficulty: unknown) => scoreRow(`Top ${difficulty}`, 500);
  const gameFor = (scenarioId: number, difficulty: DifficultyType): GameType =>
    ({ scenarioId, difficulty }) as GameType;
  const hostCoop: NonNullable<Props["coop"]> = {
    role: "host",
    hostName: "Host",
    players: [
      { id: "host", name: "Host", host: true, connected: true, ready: true },
    ],
    ready: true,
    starting: false,
  };

  beforeEach(() => {
    mockGetDocs.mockResolvedValue({ docs: [] });
    mockPrefetchScenarioData.mockClear();
    mockWhere.mockClear();
  });
  afterEach(() => {
    delete window.electrifyDesktop;
    jest.restoreAllMocks();
  });

  it("asks for each difficulty's top rows once, in the indexed query shape, then switches without asking again", async () => {
    respond(({ difficulty }) => [topRow(difficulty)]);
    const { rerender } = render(<NewGameDetails {...props()} />);
    await screen.findByText("Top Employee");
    await flush();

    const asks = mockGetDocs.mock.calls.map(([built]) => asked(built));
    expect(asks.map((ask) => ask.difficulty).sort()).toEqual(
      [...DIFFICULTY_IDS].sort(),
    );
    for (const ask of asks) {
      // The compact board shows three rows, so three is all each difficulty reads
      expect(ask).toMatchObject({ scenarioId: 100, limit: 3, uid: undefined });
      expect(ask.fields).toEqual([
        "scoreVersion",
        "outcome",
        "scenarioId",
        "difficulty",
      ]);
    }
    expect(mockGetDocs.mock.calls[0][0]).toContainEqual(["score", "desc"]);

    for (const difficulty of DIFFICULTY_IDS) {
      rerender(<NewGameDetails {...props({ game: game(difficulty) })} />);
      // No waiting: the board is already here
      expect(screen.getByText(`Top ${difficulty}`)).toBeInTheDocument();
      expect(screen.queryByText("Loading...")).toBeNull();
    }
    expect(mockGetDocs).toHaveBeenCalledTimes(DIFFICULTY_IDS.length);
  });

  it("shows Loading... for a difficulty chosen before its board arrives, until it does", async () => {
    const slow = deferred<ScoreType[]>();
    respond(({ difficulty }) =>
      difficulty === "CEO" ? slow.promise : [topRow(difficulty)],
    );
    const { rerender } = render(<NewGameDetails {...props()} />);
    await screen.findByText("Top Employee");
    await flush();

    rerender(<NewGameDetails {...props({ game: game("CEO") })} />);
    expect(screen.getByText("Loading...")).toBeInTheDocument();
    expect(screen.queryByText("Top Employee")).toBeNull();
    // The slow one doesn't hold up the rest
    rerender(<NewGameDetails {...props({ game: game("Manager") })} />);
    expect(screen.getByText("Top Manager")).toBeInTheDocument();

    rerender(<NewGameDetails {...props({ game: game("CEO") })} />);
    await act(async () => {
      slow.resolve([scoreRow("Top CEO", 700)]);
    });
    expect(screen.getByText("Top CEO")).toBeInTheDocument();
    expect(screen.queryByText("Loading...")).toBeNull();
    expect(mockGetDocs).toHaveBeenCalledTimes(DIFFICULTY_IDS.length);
  });

  it("keeps one difficulty that fails from affecting the others", async () => {
    jest.spyOn(console, "warn").mockImplementation(() => {});
    respond(({ difficulty }) => {
      if (difficulty === "Manager") throw new Error("offline");
      return [topRow(difficulty)];
    });
    const { rerender } = render(
      <NewGameDetails {...props({ game: game("Manager") })} />,
    );
    const failure = "Couldn't load the high scores right now.";
    expect(await screen.findByText(failure)).toBeInTheDocument();
    await flush();

    for (const difficulty of ["Employee", "CEO"] as const) {
      rerender(<NewGameDetails {...props({ game: game(difficulty) })} />);
      expect(screen.getByText(`Top ${difficulty}`)).toBeInTheDocument();
      expect(screen.queryByText(failure)).toBeNull();
    }
    expect(mockGetDocs).toHaveBeenCalledTimes(DIFFICULTY_IDS.length);

    // Choosing the failed one asks again, for it alone
    rerender(<NewGameDetails {...props({ game: game("Manager") })} />);
    expect(screen.getByText("Loading...")).toBeInTheDocument();
    expect(await screen.findByText(failure)).toBeInTheDocument();
    expect(mockGetDocs).toHaveBeenCalledTimes(DIFFICULTY_IDS.length + 1);
    expect(asked(mockGetDocs.mock.calls.at(-1)?.[0]).difficulty).toBe(
      "Manager",
    );
  });

  it("recovers a failed difficulty when it is chosen again", async () => {
    jest.spyOn(console, "warn").mockImplementation(() => {});
    let managerAsks = 0;
    respond(({ difficulty }) => {
      if (difficulty === "Manager" && managerAsks++ === 0)
        throw new Error("offline");
      return [topRow(difficulty)];
    });
    const { rerender } = render(<NewGameDetails {...props()} />);
    await screen.findByText("Top Employee");
    await flush();

    rerender(<NewGameDetails {...props({ game: game("Manager") })} />);
    expect(await screen.findByText("Top Manager")).toBeInTheDocument();
    expect(screen.queryByText(/Couldn't load/)).toBeNull();
  });

  it("keeps Your best through difficulty changes, with one query per difficulty", async () => {
    // Each difficulty's best is distinct: 101 for Beginner up to 105 for Expert
    const bestAt = (difficulty?: DifficultyType) =>
      101 + DIFFICULTY_IDS.indexOf(difficulty as DifficultyType);
    respond(({ difficulty, uid }) =>
      uid
        ? [scoreRow("Me", bestAt(difficulty), { uid })]
        : [topRow(difficulty)],
    );
    const { rerender } = render(
      <NewGameDetails {...props({ uid: "player" })} />,
    );
    await screen.findByRole("row", { name: /Your best 102/ });
    await flush();

    for (const difficulty of DIFFICULTY_IDS) {
      rerender(
        <NewGameDetails
          {...props({ uid: "player", game: game(difficulty) })}
        />,
      );
      expect(
        screen.getByRole("row", { name: `Your best ${bestAt(difficulty)}` }),
      ).toBeInTheDocument();
    }
    const asks = mockGetDocs.mock.calls.map(([built]) => asked(built));
    const mine = asks.filter((ask) => ask.uid === "player");
    expect(mine.map((ask) => ask.difficulty).sort()).toEqual(
      [...DIFFICULTY_IDS].sort(),
    );
    expect(mine.every((ask) => ask.limit === 1)).toBe(true);
    expect(asks).toHaveLength(DIFFICULTY_IDS.length * 2);

    // Signing out drops them; signing in again reads each difficulty once more
    rerender(<NewGameDetails {...props()} />);
    expect(screen.queryByText("Your best")).toBeNull();
    rerender(<NewGameDetails {...props({ uid: "player" })} />);
    await screen.findByRole("row", { name: /Your best 102/ });
    expect(mockGetDocs).toHaveBeenCalledTimes(DIFFICULTY_IDS.length * 3);
  });

  it("reads every difficulty again for a new scenario and ignores answers about the old one", async () => {
    const oldBoard = deferred<ScoreType[]>();
    respond(({ scenarioId, difficulty, uid }) => {
      if (scenarioId === 100 && difficulty === "CEO" && !uid)
        return oldBoard.promise;
      return uid
        ? [scoreRow("Me", Number(scenarioId), { uid })]
        : [scoreRow(`S${scenarioId} ${difficulty}`, 500)];
    });
    const { rerender } = render(
      <NewGameDetails
        {...props({ uid: "player", game: gameFor(100, "Employee") })}
      />,
    );
    await screen.findByText("S100 Employee");
    await screen.findByRole("row", { name: "Your best 100" });
    expect(mockGetDocs).toHaveBeenCalledTimes(DIFFICULTY_IDS.length * 2);

    rerender(
      <NewGameDetails
        {...props({ uid: "player", game: gameFor(101, "Employee") })}
      />,
    );
    await screen.findByText("S101 Employee");
    await screen.findByRole("row", { name: "Your best 101" });
    await flush();
    const asks = mockGetDocs.mock.calls.map(([built]) => asked(built));
    const forNew = asks.filter((ask) => ask.scenarioId === 101);
    expect(forNew).toHaveLength(DIFFICULTY_IDS.length * 2);
    expect(forNew.filter((ask) => ask.uid)).toHaveLength(DIFFICULTY_IDS.length);

    rerender(
      <NewGameDetails
        {...props({ uid: "player", game: gameFor(101, "CEO") })}
      />,
    );
    expect(screen.getByText("S101 CEO")).toBeInTheDocument();
    await act(async () => {
      oldBoard.resolve([scoreRow("S100 CEO", 500)]);
    });
    expect(screen.queryByText("S100 CEO")).toBeNull();
    expect(screen.getByText("S101 CEO")).toBeInTheDocument();
  });

  it("reads every Steam difficulty again when the scope changes and ignores answers from the old scope", async () => {
    window.electrifyDesktop = { apiVersion: 1 } as DesktopBridge;
    const oldGlobal = deferred<ScoreType[]>();
    const steamRow = (displayName: string): ScoreType =>
      scoreRow(displayName, 500, { uid: "steam:2", difficulty: "Employee" });
    mockDesktopScores.mockImplementation(
      async (_scenarioId: number, difficulty: string, scope: string) =>
        scope === "global" && difficulty === "CEO"
          ? oldGlobal.promise
          : [steamRow(`${scope} ${difficulty}`)],
    );
    const { rerender } = render(
      <NewGameDetails {...props({ uid: "steam:1" })} />,
    );
    await screen.findByText("global Employee");
    await flush();
    const reads = (scope: string) =>
      mockDesktopScores.mock.calls
        .filter((call) => call[2] === scope)
        .map(([, difficulty, , rows]) => ({ difficulty, rows }));

    // Steam is asked for just the rows the compact board shows
    expect(reads("global")).toHaveLength(DIFFICULTY_IDS.length);
    expect(reads("global").every(({ rows }) => rows === 3)).toBe(true);
    expect(reads("player")).toHaveLength(DIFFICULTY_IDS.length);
    rerender(
      <NewGameDetails {...props({ uid: "steam:1", game: game("VP") })} />,
    );
    expect(screen.getByText("global VP")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Friends" }));
    await screen.findByText("friends VP");
    await flush();
    expect(
      reads("friends")
        .map(({ difficulty }) => difficulty)
        .sort(),
    ).toEqual([...DIFFICULTY_IDS].sort());
    // Your best doesn't depend on the scope, and nothing else was asked
    expect(reads("player")).toHaveLength(DIFFICULTY_IDS.length);
    expect(reads("global")).toHaveLength(DIFFICULTY_IDS.length);

    rerender(
      <NewGameDetails {...props({ uid: "steam:1", game: game("CEO") })} />,
    );
    expect(screen.getByText("friends CEO")).toBeInTheDocument();
    await act(async () => {
      oldGlobal.resolve([steamRow("stale global")]);
    });
    expect(screen.queryByText("stale global")).toBeNull();
    expect(screen.getByText("friends CEO")).toBeInTheDocument();
    expect(mockGetDocs).not.toHaveBeenCalled();
  });

  it("ignores every answer that arrives after it unmounts", async () => {
    const pending = deferred<ScoreType[]>();
    respond(() => pending.promise);
    const instance = React.createRef<NewGameDetails>();
    const { unmount } = render(
      <NewGameDetails ref={instance} {...props({ uid: "player" })} />,
    );
    expect(mockGetDocs).toHaveBeenCalledTimes(DIFFICULTY_IDS.length * 2);
    const setState = jest.spyOn(instance.current!, "setState");
    unmount();

    await act(async () => {
      pending.resolve([scoreRow("Late", 1)]);
    });
    expect(setState).not.toHaveBeenCalled();
  });

  it.each([
    [
      "a friend challenge",
      {
        challenge: {
          run: {
            scenarioId: 100,
            seed: 1,
            difficulty: "Employee",
            compatibilityId: "test",
          },
          target: 500,
        },
      },
    ],
    ["a co-op lobby", { coop: hostCoop }],
  ] as [string, Partial<Props>][])(
    "reads nothing for %s, which shows no board",
    async (_name, extra) => {
      render(<NewGameDetails {...props({ uid: "player", ...extra })} />);
      await flush();
      expect(mockGetDocs).not.toHaveBeenCalled();
      expect(screen.queryByRole("region", { name: /Leaderboard/ })).toBeNull();
    },
  );

  it("reads the boards once the co-op lobby that hid them ends", async () => {
    respond(({ difficulty, uid }) =>
      uid ? [scoreRow("Me", 321, { uid })] : [topRow(difficulty)],
    );
    const { rerender } = render(
      <NewGameDetails {...props({ uid: "player", coop: hostCoop })} />,
    );
    await flush();
    expect(mockGetDocs).not.toHaveBeenCalled();

    rerender(<NewGameDetails {...props({ uid: "player" })} />);
    await screen.findByText("Top Employee");
    await screen.findByRole("row", { name: "Your best 321" });
    expect(mockGetDocs).toHaveBeenCalledTimes(DIFFICULTY_IDS.length * 2);
  });

  it("still loads the all-levels board only when it is asked for", async () => {
    respond(({ difficulty }) =>
      difficulty === undefined
        ? [scoreRow("Everyone", 900, { difficulty: "CEO" })]
        : [topRow(difficulty)],
    );
    render(<NewGameDetails {...props()} />);
    await screen.findByText("Top Employee");
    await flush();
    expect(mockGetDocs).toHaveBeenCalledTimes(DIFFICULTY_IDS.length);

    await userEvent.click(
      screen.getByRole("button", { name: "View all scores" }),
    );
    await screen.findByText("Everyone");
    expect(mockGetDocs).toHaveBeenCalledTimes(DIFFICULTY_IDS.length + 1);
    expect(asked(mockGetDocs.mock.calls.at(-1)?.[0])).toMatchObject({
      difficulty: undefined,
      limit: 50,
    });

    await userEvent.click(screen.getByRole("button", { name: "Show top 3" }));
    expect(screen.getByText("Top Employee")).toBeInTheDocument();
    expect(mockGetDocs).toHaveBeenCalledTimes(DIFFICULTY_IDS.length + 1);
  });
});

// The query builders echo their arguments (Jest resets their implementations before each test), so
// that a getDocs mock can read which board it was asked for.
beforeEach(() => {
  const firestore = jest.requireMock("firebase/firestore") as Record<
    string,
    jest.Mock
  >;
  firestore.collection.mockReturnValue("scores");
  for (const builder of ["query", "orderBy", "limit"])
    firestore[builder].mockImplementation((...args: unknown[]) => args);
  mockWhere.mockImplementation((field: string, op: string, value: unknown) => ({
    field,
    op,
    value,
  }));
});

interface AskedQuery {
  scenarioId?: number;
  difficulty?: DifficultyType;
  uid?: string;
  limit?: number;
  fields: string[];
}

function asked(built: unknown): AskedQuery {
  const parts = built as unknown[];
  const filters = parts.filter(
    (part): part is { field: string; value: never } =>
      typeof part === "object" && part !== null && !Array.isArray(part),
  );
  const value = (field: string) =>
    filters.find((filter) => filter.field === field)?.value;
  const limited = parts.find(
    (part) => Array.isArray(part) && part.length === 1,
  );
  return {
    scenarioId: value("scenarioId"),
    difficulty: value("difficulty"),
    uid: value("uid"),
    limit: (limited as [number] | undefined)?.[0],
    fields: filters.map((filter) => filter.field),
  };
}

/** Answers each Firestore query from what it asks for. */
function respond(
  answer: (asked: AskedQuery) => ScoreType[] | Promise<ScoreType[]>,
) {
  mockGetDocs.mockImplementation(async (built: unknown) => ({
    docs: (await answer(asked(built))).map((score) => ({ data: () => score })),
  }));
}

/** Lets every answer already on its way land, so a test can then act on a settled screen. */
function flush() {
  return act(() => new Promise<void>((done) => setTimeout(done, 0)));
}

function scoreRow(
  displayName: string,
  score: number,
  extra: Partial<ScoreType> = {},
): ScoreType {
  return { displayName, score, ...extra } as ScoreType;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
