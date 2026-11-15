import * as React from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { configureStore } from "@reduxjs/toolkit";
import { Provider } from "react-redux";
import { createGame } from "../../testing/Simulator";
import { landPurchaseQuote, purchaseLand } from "../../helpers/Territories";
import { currentTick } from "../../helpers/GameSelectors";
import TerritoryNetwork from "./TerritoryNetwork";
import { acquisitionQuote, transferUtility } from "../../helpers/Expansion";
jest.mock("../base/useOutlookWorker", () => ({
  useOutlookWorker: () => undefined,
}));
jest.mock(
  "../base/ManualLink",
  () => (props: { children?: React.ReactNode }) => <>{props.children}</>,
);
function ready() {
  const game = createGame({ scenarioId: 116, seed: 188 });
  currentTick(game)!.cash = 1e9;
  return game;
}
const controls = {
  onBuild: jest.fn(),
  onUpgrade: jest.fn(),
  onBuyingRule: jest.fn(),
  onSellingRule: jest.fn(),
};
function show(game: ReturnType<typeof ready>, onBuildFacility = jest.fn()) {
  const store = configureStore({ reducer: { game: () => game } });
  return {
    onBuildFacility,
    ...render(
      <Provider store={store}>
        <TerritoryNetwork
          game={game}
          {...controls}
          onAcquire={jest.fn()}
          onBuildFacility={onBuildFacility}
        />
      </Provider>,
    ),
  };
}
it("has directly inspectable utility and land decisions without route controls", () => {
  show(ready());
  const territories = screen.getByRole("region", { name: "Territories" });
  expect(
    within(territories).getAllByRole("button", {
      name: /Inspect .* territory/,
    }),
  ).toHaveLength(4);
  fireEvent.click(
    screen.getByRole("button", { name: "Inspect Ridge Electric territory" }),
  );
  expect(
    screen.getByRole("button", { name: "Acquire Ridge Electric" }),
  ).toBeEnabled();
  expect(
    screen.getByRole("button", { name: "Inspect Ridge Electric" }),
  ).toBeEnabled();
  fireEvent.click(
    screen.getByRole("button", { name: "Inspect Green Uplands territory" }),
  );
  expect(
    screen.getByRole("button", { name: /Buy Green Uplands/ }),
  ).toBeEnabled();
  expect(
    within(
      screen.getByRole("region", { name: "Selected territory" }),
    ).queryByText(/connection|line utilization|upgrade/i),
  ).not.toBeInTheDocument();
});
it("reviews a single cash land purchase with no supplied plants or customers", () => {
  show(ready());
  fireEvent.click(
    screen.getByRole("button", { name: "Inspect Green Uplands territory" }),
  );
  fireEvent.click(screen.getByRole("button", { name: /Buy Green Uplands/ }));
  const dialog = screen.getByRole("dialog", { name: "Buy Green Uplands" });
  expect(
    within(dialog).getByRole("button", { name: /Buy land/ }),
  ).toBeEnabled();
  expect(
    within(dialog).getByText(/No customers, plants or power transfer/),
  ).toBeVisible();
  expect(
    within(dialog).queryByRole("button", { name: /loan/i }),
  ).not.toBeInTheDocument();
});
it.each(["green-uplands", "ridge-electric"] as const)(
  "builds immediately in owned %s without a connection",
  (id) => {
    const game = ready();
    if (id === "green-uplands") {
      const q = landPurchaseQuote(game)!;
      purchaseLand(game, { territoryId: q.territoryId, quoteKey: q.quoteKey });
    } else {
      const q = acquisitionQuote(game, id)!;
      transferUtility(game, {
        targetId: id,
        financed: false,
        quoteKey: q.quoteKey,
      });
    }
    const { onBuildFacility } = show(game);
    const name = id === "green-uplands" ? "Green Uplands" : "Ridge Electric";
    fireEvent.click(
      screen.getByRole("button", { name: `Inspect ${name} territory` }),
    );
    fireEvent.click(screen.getByRole("button", { name: `Build in ${name}` }));
    expect(onBuildFacility).toHaveBeenCalledWith(id, false);
    expect(game.transmission!.lines).toEqual([]);
  },
);
