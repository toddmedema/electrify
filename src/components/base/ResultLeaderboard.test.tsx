import { act, render, screen, within } from "@testing-library/react";
import ResultLeaderboard from "./ResultLeaderboard";

const mockGetDocs = jest.fn();
const mockDesktopScores = jest.fn();
const mockDesktopScoreRank = jest.fn();
const mockGetCount = jest.fn();
jest.mock("../../DesktopScores", () => ({
  desktopScores: (...args: unknown[]) => mockDesktopScores(...args),
  desktopScoreRank: (...args: unknown[]) => mockDesktopScoreRank(...args),
}));
jest.mock("../../Globals", () => ({ getDb: () => ({}) }));
jest.mock("firebase/firestore", () => ({
  collection: () => "scores",
  getDocs: (...args: unknown[]) => mockGetDocs(...args),
  getCountFromServer: (...args: unknown[]) => mockGetCount(...args),
  query: (...args: unknown[]) => args,
  where: (...args: unknown[]) => args,
  orderBy: (...args: unknown[]) => args,
  limit: (...args: unknown[]) => args,
}));

beforeEach(() => {
  jest.clearAllMocks();
  mockGetCount.mockResolvedValue({ data: () => ({ count: 46 }) });
  mockDesktopScoreRank.mockResolvedValue(47);
});

afterEach(() => {
  delete window.electrifyDesktop;
});

it("loads the public top three current completed scores for the played scenario and difficulty", async () => {
  mockGetDocs.mockResolvedValue({
    docs: [
      { data: () => ({ displayName: "Grid planner", score: 9999 }) },
      { data: () => ({ score: 1234 }) },
    ],
  });
  render(
    <ResultLeaderboard scenarioId={101} difficulty="CEO" currentScore={540} />,
  );
  expect(screen.getByRole("status")).toHaveTextContent("Loading scores");
  await screen.findByText("Grid planner");
  const table = screen.getByRole("table", { name: "Leaderboard · Expert" });
  expect(within(table).getByText("Anonymous")).toBeInTheDocument();
  expect(within(table).getByText("9,999")).toBeInTheDocument();
  expect(mockGetDocs).toHaveBeenCalledWith([
    "scores",
    ["scoreVersion", "==", 2],
    ["outcome", "==", "completed"],
    ["scenarioId", "==", 101],
    ["difficulty", "==", "CEO"],
    ["score", "desc"],
    [3],
  ]);
});

it("keeps this run visible on an empty board and during a network failure", async () => {
  mockGetDocs.mockResolvedValueOnce({ docs: [] });
  const { unmount } = render(
    <ResultLeaderboard scenarioId={101} difficulty="CEO" currentScore={540} />,
  );
  expect(
    await screen.findByRole("row", { name: "This run" }),
  ).toHaveTextContent("You540");
  unmount();
  mockGetDocs.mockRejectedValueOnce(new Error("offline"));
  render(
    <ResultLeaderboard scenarioId={101} difficulty="CEO" currentScore={540} />,
  );
  expect(
    await screen.findByText("Leaderboard unavailable right now."),
  ).toBeInTheDocument();
  expect(screen.getByRole("row", { name: "This run" })).toHaveTextContent(
    "You540",
  );
});

it("ignores an older scenario's response after a new board loads", async () => {
  let finishOlder!: () => void;
  mockGetDocs
    .mockReturnValueOnce(
      new Promise((done) => {
        finishOlder = () =>
          done({
            docs: [
              { data: () => ({ displayName: "Previous mission", score: 999 }) },
            ],
          });
      }),
    )
    .mockResolvedValueOnce({
      docs: [{ data: () => ({ displayName: "Current mission", score: 100 }) }],
    });
  const { rerender } = render(
    <ResultLeaderboard scenarioId={101} difficulty="CEO" currentScore={540} />,
  );
  rerender(
    <ResultLeaderboard scenarioId={110} difficulty="CEO" currentScore={540} />,
  );
  await screen.findByText("Current mission");
  await act(async () => finishOlder());
  expect(screen.getByText("Current mission")).toBeVisible();
  expect(screen.queryByText("Previous mission")).toBeNull();
});

it("uses the native Steam board for the same difficulty", async () => {
  window.electrifyDesktop = { apiVersion: 1 } as NonNullable<
    typeof window.electrifyDesktop
  >;
  mockDesktopScores.mockResolvedValue([
    { displayName: "Steam planner", score: 700 },
  ]);
  render(
    <ResultLeaderboard scenarioId={101} difficulty="CEO" currentScore={540} />,
  );
  expect(await screen.findByText("Steam planner")).toBeInTheDocument();
  expect(mockDesktopScores).toHaveBeenCalledWith(101, "CEO", "global");
});

it("shows this run below the leaders even when the player has a higher previous best", async () => {
  mockGetDocs.mockResolvedValue({
    docs: [
      {
        data: () => ({ uid: "me", displayName: "Daniel McEntee", score: 999 }),
      },
      {
        data: () => ({
          uid: "second",
          displayName: "Northern Wind",
          score: 900,
        }),
      },
      {
        data: () => ({
          uid: "third",
          displayName: "Solar operator",
          score: 800,
        }),
      },
    ],
  });
  render(
    <ResultLeaderboard
      {...{
        scenarioId: 101,
        difficulty: "CEO" as const,
        currentScore: 540,
        uid: "me",
        displayName: "Daniel McEntee",
      }}
    />,
  );
  await screen.findByText("Northern Wind");
  const rows = screen.getAllByRole("row");
  expect(rows).toHaveLength(4);
  expect(rows[3]).toHaveTextContent("47Daniel McEntee540");
  expect(rows[3]).toHaveAttribute("aria-current", "true");
  expect(mockGetCount).toHaveBeenCalledWith([
    "scores",
    ["scoreVersion", "==", 2],
    ["outcome", "==", "completed"],
    ["scenarioId", "==", 101],
    ["difficulty", "==", "CEO"],
    ["score", ">", 540],
    ["score", "desc"],
  ]);
  expect(screen.queryByRole("columnheader")).toBeNull();
});

it("shows this run once when it is already in the top three", async () => {
  mockGetCount.mockResolvedValue({ data: () => ({ count: 1 }) });
  mockGetDocs.mockResolvedValue({
    docs: [
      { data: () => ({ uid: "first", displayName: "Leader", score: 1000 }) },
      {
        data: () => ({ uid: "me", displayName: "Daniel McEntee", score: 540 }),
      },
      { data: () => ({ uid: "third", displayName: "Third", score: 400 }) },
    ],
  });
  render(
    <ResultLeaderboard
      scenarioId={101}
      difficulty="CEO"
      currentScore={540}
      uid="me"
      displayName="Daniel McEntee"
    />,
  );
  await screen.findByText("Leader");
  expect(screen.getAllByRole("row")).toHaveLength(3);
  expect(screen.getAllByText("Daniel McEntee")).toHaveLength(1);
  expect(screen.getByRole("row", { name: "This run" })).toHaveTextContent(
    "2Daniel McEntee540",
  );
});

it("inserts a new top-three run before its submission appears on the board", async () => {
  mockGetCount.mockResolvedValue({ data: () => ({ count: 0 }) });
  mockGetDocs.mockResolvedValue({
    docs: [
      { data: () => ({ uid: "first", displayName: "Leader", score: 500 }) },
      { data: () => ({ uid: "second", displayName: "Second", score: 400 }) },
      { data: () => ({ uid: "third", displayName: "Third", score: 300 }) },
    ],
  });
  render(
    <ResultLeaderboard
      scenarioId={101}
      difficulty="CEO"
      currentScore={540}
      uid="me"
      displayName="Daniel McEntee"
    />,
  );
  await screen.findByText("Leader");
  expect(screen.getAllByRole("row")).toHaveLength(3);
  expect(screen.getAllByRole("row")[0]).toHaveTextContent("1Daniel McEntee540");
  expect(screen.queryByText("Third")).toBeNull();
  expect(screen.getAllByRole("row")[1]).toHaveTextContent("2Leader500");
});

it("keeps the actual score visible when both standings and rank are offline", async () => {
  mockGetDocs.mockRejectedValue(new Error("offline"));
  mockGetCount.mockRejectedValue(new Error("offline"));
  render(
    <ResultLeaderboard
      scenarioId={101}
      difficulty="CEO"
      currentScore={540}
      displayName="Daniel McEntee"
    />,
  );
  expect(screen.getByRole("row", { name: "This run" })).toHaveTextContent(
    "Daniel McEntee540",
  );
  await screen.findByText("Leaderboard unavailable right now.");
  expect(screen.getByRole("row", { name: "This run" })).toHaveTextContent(
    "Daniel McEntee540",
  );
  expect(screen.getByRole("cell", { name: "Rank pending" })).toHaveTextContent(
    "—",
  );
});
