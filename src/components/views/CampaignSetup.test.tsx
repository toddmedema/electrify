import { fireEvent, render, screen, within } from "@testing-library/react";
import { loadLeaderboard } from "../../Leaderboard";
import { LEGACY_GENERATIONS } from "../../data/LegacyCampaign";
import CampaignSetup, { CampaignSetupProps } from "./CampaignSetup";

jest.mock("../../Leaderboard", () => ({
  BOARD_ROWS: 10,
  loadLeaderboard: jest.fn(),
}));

beforeEach(() => {
  (loadLeaderboard as jest.Mock).mockResolvedValue([]);
});

function props(
  overrides: Partial<CampaignSetupProps> = {},
): CampaignSetupProps {
  return {
    difficulty: "Manager",
    onDifficulty: jest.fn(),
    onStart: jest.fn(),
    onBack: jest.fn(),
    ...overrides,
  };
}

it("shows nine continuous CEO terms and starts only after the player chooses", async () => {
  const onStart = jest.fn();
  render(<CampaignSetup {...props({ onStart })} />);
  await screen.findByText("Complete all nine terms to join the leaderboard");
  const terms = within(
    screen.getByRole("list", { name: "Campaign generations" }),
  ).getAllByRole("listitem");
  expect(terms).toHaveLength(9);
  LEGACY_GENERATIONS.forEach((generation, index) => {
    expect(terms[index]).toHaveTextContent(
      `${generation.name} (${generation.startYear}–${generation.startYear + 19})`,
    );
  });
  expect(screen.queryByText(/Your first grid:/)).not.toBeInTheDocument();
  expect(
    screen.getByText("Inspired by Northern California history."),
  ).toBeVisible();
  expect(screen.queryByText(/nine 20-year CEO terms/)).not.toBeInTheDocument();
  expect(screen.queryByText(/The game pauses/)).not.toBeInTheDocument();
  expect(screen.queryByText(/Northern California ·/)).not.toBeInTheDocument();
  expect(onStart).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Start campaign" }));
  expect(onStart).toHaveBeenCalledTimes(1);
});

it("uses the scenario picker's difficulty buttons", async () => {
  const onDifficulty = jest.fn();
  render(<CampaignSetup {...props({ onDifficulty })} />);
  await screen.findByText("Complete all nine terms to join the leaderboard");
  expect(screen.getByRole("button", { name: "Medium" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  fireEvent.click(screen.getByRole("button", { name: "Expert" }));
  expect(onDifficulty).toHaveBeenCalledWith("CEO");
});

it("shows the full campaign board at the selected difficulty and loads the player's best", async () => {
  const { rerender } = render(<CampaignSetup {...props({ uid: "player" })} />);
  expect(
    await screen.findByText("Complete all nine terms to join the leaderboard"),
  ).toBeVisible();
  expect(
    screen.getByRole("region", { name: "Leaderboard — Medium" }),
  ).toBeVisible();
  expect(loadLeaderboard).toHaveBeenCalledWith(
    117,
    "Manager",
    "player",
    "player",
  );
  rerender(<CampaignSetup {...props({ difficulty: "CEO", uid: "player" })} />);
  expect(
    screen.getByRole("region", { name: "Leaderboard — Expert" }),
  ).toBeVisible();
  expect(loadLeaderboard).toHaveBeenCalledWith(117, "CEO", "player", "player");
  fireEvent.click(screen.getByRole("button", { name: "View all scores" }));
  expect(
    screen.getByRole("region", { name: "Leaderboard — All levels" }),
  ).toBeVisible();
  expect(loadLeaderboard).toHaveBeenCalledWith(
    117,
    undefined,
    "global",
    "player",
  );
  await screen.findByText("Complete all nine terms to join the leaderboard");
});

it("offers an existing company separately from starting over", async () => {
  const onResume = jest.fn();
  const onStart = jest.fn();
  render(
    <CampaignSetup {...props({ activeGeneration: 3, onResume, onStart })} />,
  );
  await screen.findByText("Complete all nine terms to join the leaderboard");
  fireEvent.click(screen.getByRole("button", { name: "Resume term 4" }));
  expect(onResume).toHaveBeenCalledTimes(1);
  expect(onStart).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Start new campaign" }));
  expect(onStart).toHaveBeenCalledTimes(1);
});
