import * as React from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { configureStore } from "@reduxjs/toolkit";
import { Provider } from "react-redux";
import { createGame } from "../../testing/Simulator";
import { landPurchaseQuote, purchaseLand } from "../../helpers/Territories";
import { currentTick } from "../../helpers/GameSelectors";
import { LAND_TERRITORIES } from "../../data/Territories";
import { territoryMapLabel } from "../base/TerritoryMapLayout";
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
const inspect = (id: Parameters<typeof territoryMapLabel>[0]) =>
  fireEvent.click(
    screen.getByRole("button", {
      name: `Inspect ${territoryMapLabel(id)} territory`,
    }),
  );
it("floats utility names on the map and removes the numbered key", () => {
  const { container } = show(ready());
  expect(
    screen.getByRole("button", { name: "Inspect You territory" }),
  ).toHaveTextContent("You");
  expect(
    screen.getByRole("button", { name: "Inspect Ridge Electric territory" }),
  ).toHaveTextContent("Ridge Electric");
  expect(
    screen.getByRole("button", { name: "Inspect Valley Electric territory" }),
  ).toHaveTextContent("Valley Electric");
  expect(container.querySelector(".territoryMapKey")).toBeNull();
  expect(container.querySelector(".territoryHexHub")).toBeNull();
  expect(container.querySelectorAll(".territoryParcel")).toHaveLength(
    LAND_TERRITORIES.length,
  );
  expect(screen.queryByText("Green Uplands")).not.toBeInTheDocument();
});
it.each(LAND_TERRITORIES)(
  "inspects every unowned $benefit parcel $id as a cash purchase",
  ({ id, benefit }) => {
    show(ready());
    inspect(id);
    const detail = screen.getByRole("region", { name: "Selected territory" });
    expect(within(detail).getByRole("heading", { level: 3 })).toHaveTextContent(
      territoryMapLabel(id),
    );
    fireEvent.click(
      within(detail).getByRole("button", { name: /Buy territory/ }),
    );
    const dialog = screen.getByRole("dialog", {
      name: "Buy territory",
    });
    expect(
      within(dialog).getByRole("button", { name: /Buy territory/ }),
    ).toBeEnabled();
    expect(
      within(dialog).queryByRole("button", { name: /loan/i }),
    ).not.toBeInTheDocument();
    expect(dialog).toHaveTextContent(
      benefit === "residential"
        ? "residential customers"
        : benefit === "industrial"
          ? "industrial customers"
          : benefit === "general"
            ? "shared building sites"
            : `${benefit} development site`,
    );
  },
);
it("reviews an unaffordable parcel with a cash shortfall rather than hiding its benefits", () => {
  const game = ready();
  currentTick(game)!.cash = 1;
  show(game);
  inspect("parcel-1");
  fireEvent.click(screen.getByRole("button", { name: /Buy territory/ }));
  const dialog = screen.getByRole("dialog", {
    name: "Buy territory",
  });
  expect(
    within(dialog).getByRole("button", { name: /Buy territory/ }),
  ).toBeDisabled();
  expect(within(dialog).getByRole("status")).toHaveTextContent(
    "more cash needed",
  );
  expect(dialog).toHaveTextContent("residential customers");
});
it.each(["green-uplands", "parcel-0", "parcel-7", "parcel-3"] as const)(
  "opens the correct build destination for owned %s",
  (id) => {
    const game = ready(),
      quote = landPurchaseQuote(game, id)!;
    expect(
      purchaseLand(game, { territoryId: id, quoteKey: quote.quoteKey }),
    ).toBe(true);
    const { onBuildFacility } = show(game);
    inspect(id);
    const name =
      id === "parcel-7"
        ? "Build hydro"
        : id === "parcel-3"
          ? "Build geothermal"
          : `Build in ${territoryMapLabel(id)}`;
    fireEvent.click(screen.getByRole("button", { name }));
    expect(onBuildFacility).toHaveBeenCalledWith(id, false);
    expect(game.transmission!.lines).toEqual([]);
  },
);
it("shows added industrial customers without offering nonexistent plant sites", () => {
  const game = ready(),
    quote = landPurchaseQuote(game, "parcel-5")!;
  purchaseLand(game, {
    territoryId: quote.territoryId,
    quoteKey: quote.quoteKey,
  });
  show(game);
  inspect("parcel-5");
  const detail = screen.getByRole("region", { name: "Selected territory" });
  expect(detail).toHaveTextContent("Customers addedIndustrial400");
  expect(
    within(detail).queryByRole("button", { name: /Build/ }),
  ).not.toBeInTheDocument();
});
it("keeps utility offers directly inspectable and turns acquired borders into your ownership", () => {
  const game = ready();
  const quote = acquisitionQuote(game, "ridge-electric")!;
  transferUtility(game, {
    targetId: "ridge-electric",
    financed: false,
    quoteKey: quote.quoteKey,
  });
  const { container, onBuildFacility } = show(game);
  inspect("ridge-electric");
  expect(
    screen.getByRole("button", { name: "Inspect Ridge Electric territory" }),
  ).toHaveTextContent("You");
  expect(container.querySelector('[data-owner="ridge-electric"]')).toBeNull();
  fireEvent.click(
    screen.getByRole("button", { name: "Build in Ridge Electric" }),
  );
  expect(onBuildFacility).toHaveBeenCalledWith("ridge-electric", false);
});
it("disables only the parcel owned by another co-op company", () => {
  const game = ready();
  game.multiplayer = {
    seat: "0",
    landOwners: { "parcel-7": { seat: "1", name: "North Electric" } },
  };
  show(game);
  inspect("parcel-7");
  const detail = screen.getByRole("region", { name: "Selected territory" });
  expect(detail).toHaveTextContent("Owned by North Electric");
  expect(
    within(detail).getByRole("button", { name: /Buy territory/ }),
  ).toBeDisabled();
  inspect("parcel-3");
  expect(
    within(detail).getByRole("button", { name: /Buy territory/ }),
  ).toBeEnabled();
});
