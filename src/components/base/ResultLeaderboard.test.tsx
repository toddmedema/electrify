import { act, render, screen, within } from "@testing-library/react";
import ResultLeaderboard from "./ResultLeaderboard";

const mockGetDocs = jest.fn();
const mockDesktopScores = jest.fn();
jest.mock("../../DesktopScores", () => ({
  desktopScores: (...args: unknown[]) => mockDesktopScores(...args),
}));
jest.mock("../../Globals", () => ({ getDb: () => ({}) }));
jest.mock("firebase/firestore", () => ({
  collection: () => "scores",
  getDocs: (...args: unknown[]) => mockGetDocs(...args),
  query: (...args: unknown[]) => args,
  where: (...args: unknown[]) => args,
  orderBy: (...args: unknown[]) => args,
  limit: (...args: unknown[]) => args,
}));

beforeEach(() => jest.clearAllMocks());

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
  render(<ResultLeaderboard scenarioId={101} difficulty="CEO" />);
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

it("distinguishes an empty board from a network failure", async () => {
  mockGetDocs.mockResolvedValueOnce({ docs: [] });
  const { unmount } = render(
    <ResultLeaderboard scenarioId={101} difficulty="CEO" />,
  );
  expect(
    await screen.findByText("No scores yet for this difficulty."),
  ).toBeInTheDocument();
  unmount();
  mockGetDocs.mockRejectedValueOnce(new Error("offline"));
  render(<ResultLeaderboard scenarioId={101} difficulty="CEO" />);
  expect(
    await screen.findByText("Leaderboard unavailable right now."),
  ).toBeInTheDocument();
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
    <ResultLeaderboard scenarioId={101} difficulty="CEO" />,
  );
  rerender(<ResultLeaderboard scenarioId={110} difficulty="CEO" />);
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
  render(<ResultLeaderboard scenarioId={101} difficulty="CEO" />);
  expect(await screen.findByText("Steam planner")).toBeInTheDocument();
  expect(mockDesktopScores).toHaveBeenCalledWith(101, "CEO", "global");
});
