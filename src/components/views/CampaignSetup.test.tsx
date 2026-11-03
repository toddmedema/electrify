import { fireEvent, render, screen, within } from "@testing-library/react";
import { LEGACY_GENERATIONS } from "../../data/LegacyCampaign";
import CampaignSetup, { CampaignSetupProps } from "./CampaignSetup";

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

it("shows nine continuous CEO terms and starts only after the player chooses", () => {
  const onStart = jest.fn();
  render(<CampaignSetup {...props({ onStart })} />);
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
    screen.getByText(
      "Lead one utility through nine 20-year CEO terms. Inspired by Northern California history.",
    ),
  ).toBeVisible();
  expect(screen.queryByText(/The game pauses/)).not.toBeInTheDocument();
  expect(screen.queryByText(/Northern California ·/)).not.toBeInTheDocument();
  expect(onStart).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Start campaign" }));
  expect(onStart).toHaveBeenCalledTimes(1);
});

it("uses the scenario picker's difficulty buttons", () => {
  const onDifficulty = jest.fn();
  render(<CampaignSetup {...props({ onDifficulty })} />);
  expect(screen.getByRole("button", { name: "Medium" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  fireEvent.click(screen.getByRole("button", { name: "Expert" }));
  expect(onDifficulty).toHaveBeenCalledWith("CEO");
});

it("offers an existing company separately from starting over", () => {
  const onResume = jest.fn();
  const onStart = jest.fn();
  render(
    <CampaignSetup {...props({ activeGeneration: 3, onResume, onStart })} />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Resume term 4" }));
  expect(onResume).toHaveBeenCalledTimes(1);
  expect(onStart).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Start new campaign" }));
  expect(onStart).toHaveBeenCalledTimes(1);
});
