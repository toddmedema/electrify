import { fireEvent, render, screen, within } from "@testing-library/react";
import { Provider } from "react-redux";
import { store } from "../../Store";
import type { GameType } from "../../Types";
import { registerMultiplayerRuntime } from "../../multiplayer/Registry";
import { createWorld } from "../../multiplayer/World";
import { COOP_TEST_SPEC, coopSeats } from "../../testing/MultiplayerFixtures";
import { loadSimData } from "../../testing/SimData";
import TerritorialAgreements from "./TerritorialAgreements";

let opening: GameType;
beforeAll(() => {
  loadSimData("SF");
  opening = createWorld(COOP_TEST_SPEC, coopSeats(2), "match", "epoch")
    .grids[0];
});
afterEach(() => registerMultiplayerRuntime(undefined));

const view = (game: GameType) => (
  <Provider store={store}>
    <TerritorialAgreements
      game={game}
      onBuyingRule={jest.fn()}
      onSellingRule={jest.fn()}
    />
  </Provider>
);

it("requires a shared border and keeps a rejected connection proposal open for review", async () => {
  const original = opening.multiplayer!.peers![0];
  const multiplayer = { ...opening.multiplayer!, peers: [original] };
  const game = {
    ...opening,
    multiplayer,
    transmission: { ...opening.transmission!, lines: [] },
  };
  const { rerender } = render(view(game));
  const label = `Review connection with ${original.name}`;
  expect(
    screen.getByText("Expand to a shared border to connect."),
  ).toBeVisible();
  expect(screen.queryByRole("button", { name: label })).not.toBeInTheDocument();

  const error = "The other company has retired.";
  const submit = jest.fn().mockRejectedValue(new Error(error));
  registerMultiplayerRuntime({
    command: jest.fn(),
    submit,
    activity: jest.fn(),
    leave: jest.fn(),
  });
  rerender(
    view({
      ...game,
      multiplayer: {
        ...multiplayer,
        peers: [
          {
            ...original,
            border: { here: "frontier:1:0", there: "frontier:2:0" },
          },
        ],
      },
    }),
  );
  fireEvent.click(screen.getByRole("button", { name: label }));
  const review = screen.getByRole("dialog", {
    name: `Propose connection to ${original.name}?`,
  });
  fireEvent.click(
    within(review).getByRole("button", { name: "Propose connection" }),
  );

  expect(await within(review).findByText(error)).toBeVisible();
  expect(submit).toHaveBeenCalledWith({
    kind: "action",
    name: "buildTransmissionLine",
    payload: {
      corridorId: original.corridor.id,
      financed: false,
      intent: "propose",
      border: { here: "frontier:1:0", there: "frontier:2:0" },
    },
  });
});

it("submits the proposal opened for review after the host withdraws and replaces it", async () => {
  const original = opening.multiplayer!.peers![0];
  const game = (revision?: number): GameType => ({
    ...opening,
    transmission: { ...opening.transmission!, lines: [] },
    multiplayer: {
      ...opening.multiplayer!,
      peers: [
        {
          ...original,
          border: { here: "frontier:1:0", there: "frontier:2:0" },
          connectionRequestedBy:
            revision === undefined ? undefined : original.name,
          connectionProposalRevision: revision,
        },
      ],
    },
  });
  const error =
    "This connection proposal changed. Review the current connection.";
  const submit = jest.fn().mockRejectedValue(new Error(error));
  registerMultiplayerRuntime({
    command: jest.fn(),
    submit,
    activity: jest.fn(),
    leave: jest.fn(),
  });
  const { rerender } = render(view(game(10)));
  fireEvent.click(
    screen.getByRole("button", {
      name: `Review connection from ${original.name}`,
    }),
  );
  rerender(view(game()));
  const review = screen.getByRole("dialog", {
    name: `Accept connection to ${original.name}?`,
  });
  rerender(view(game(11)));
  fireEvent.click(
    within(review).getByRole("button", { name: "Accept connection" }),
  );
  expect(await within(review).findByText(error)).toBeVisible();
  expect(submit).toHaveBeenCalledWith({
    kind: "action",
    name: "buildTransmissionLine",
    payload: {
      corridorId: original.corridor.id,
      financed: false,
      intent: "accept",
      proposalRevision: 10,
    },
  });
});
