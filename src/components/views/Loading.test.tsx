import * as React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import Loading from "./Loading";
import { createGame } from "../../testing/Simulator";

it("offers a way back to the mission list when loading fails", async () => {
  const onExit = jest.fn();
  const load = jest.fn((_game, error: (m: string) => void) =>
    error("Mission not found."),
  );
  render(
    <Loading
      game={createGame({ scenarioId: 100, seed: 1 })}
      load={load}
      onExit={onExit}
    />,
  );
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Mission not found.",
  );
  expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
  await userEvent.click(
    screen.getByRole("button", { name: "Back to missions" }),
  );
  expect(onExit).toHaveBeenCalledTimes(1);
});
