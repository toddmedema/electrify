import type { ComponentProps } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { configureStore } from "@reduxjs/toolkit";
import { Provider } from "react-redux";
import settingsReducer from "../reducers/Settings";
import CoopResult from "./Result";
import type { CompanyResultType } from "../Types";

const results: CompanyResultType[] = [
  {
    id: "grace",
    name: "Grace",
    outcome: "completed",
    title: "Complete",
    month: 6,
    cash: 1000,
    kgco2e: 1000,
    reliability: 1,
  },
];

function show(
  props: Partial<ComponentProps<typeof CoopResult>> = {},
  handlers = {
    onWatch: jest.fn(),
    onRestart: jest.fn(),
    onReturnToLobby: jest.fn(),
    onLeave: jest.fn(),
  },
) {
  const store = configureStore({
    reducer: {
      settings: settingsReducer,
      game: () => ({
        scenarioId: 100,
        startingYear: 2020,
        multiplayer: { results },
      }),
    },
  });
  render(
    <Provider store={store}>
      <CoopResult
        complete
        host
        hostName="Grace"
        selfId="grace"
        {...handlers}
        {...props}
      />
    </Provider>,
  );
  return handlers;
}

test("the host of a finished match restarts it, returns to the lobby, or leaves", async () => {
  const user = userEvent.setup();
  const handlers = show();
  expect(
    screen.getByRole("dialog", { name: "Match complete" }),
  ).toBeInTheDocument();
  // The old online-only exit is gone; every match offers the same three choices, in this order.
  expect(
    screen.queryByRole("button", { name: /Save and leave campaign/ }),
  ).not.toBeInTheDocument();
  expect(
    screen.getAllByRole("button").map((button) => button.textContent),
  ).toEqual(["Main menu", "Return to lobby", "Restart"]);
  await user.click(screen.getByRole("button", { name: "Restart" }));
  expect(handlers.onRestart).toHaveBeenCalledTimes(1);
  await user.click(screen.getByRole("button", { name: "Return to lobby" }));
  expect(handlers.onReturnToLobby).toHaveBeenCalledTimes(1);
  await user.click(screen.getByRole("button", { name: "Main menu" }));
  expect(handlers.onLeave).toHaveBeenCalledTimes(1);
});

test("a host cannot choose twice while the next game is being prepared", () => {
  show({ working: true });
  for (const name of ["Main menu", "Return to lobby", "Restart"])
    expect(screen.getByRole("button", { name })).toBeDisabled();
});

test("a guest waits for the host to choose the next game", () => {
  show({ host: false, hostName: "Ada", selfId: "grace" });
  expect(screen.getByRole("status")).toHaveTextContent(
    "Waiting for Ada to choose the next game.",
  );
  expect(
    screen.getAllByRole("button").map((button) => button.textContent),
  ).toEqual(["Leave lobby"]);
});
