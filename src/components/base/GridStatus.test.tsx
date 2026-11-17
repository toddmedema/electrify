import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { ThemeProvider } from "@mui/material/styles";
import { createAppTheme } from "../../Theme";
import { createGame } from "../../testing/Simulator";
import GridStatus from "./GridStatus";
import { readProjection, requestProjection } from "./DeferredProjection";

jest.mock("./DeferredProjection", () => ({
  projectionReady: jest.fn(() => false),
  readProjection: jest.fn(),
  requestProjection: jest.fn(),
  subscribeProjection: () => () => undefined,
}));

function setup(scenarioId = 116) {
  const game = createGame({ scenarioId });
  const now = game.timeline[0];
  const onEvidence = jest.fn();
  const onNavigate = jest.fn();
  const onReserveHelp = jest.fn();
  const props = { game, now, onEvidence, onNavigate, onReserveHelp };
  return {
    props,
    ...render(
      <ThemeProvider theme={createAppTheme("light")}>
        <GridStatus {...props} />
      </ThemeProvider>,
    ),
  };
}

beforeEach(() => jest.clearAllMocks());

it("keeps current facts visible while requesting the shared forecast, never reading stale projection", () => {
  setup();
  expect(
    screen.getByRole("button", { name: /^Current grid status: NOW/ }),
  ).toBeVisible();
  expect(requestProjection).toHaveBeenCalled();
  expect(readProjection).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: /^Current grid status/ }));
  expect(screen.getByRole("dialog", { name: "Grid status" })).toHaveTextContent(
    "Updating forecast…",
  );
});

it("shows live import exposure and agreement capacity, then closes before each navigation callback", () => {
  const { props, rerender } = setup();
  props.now.importedW = 25e6;
  props.now.supplyW = 100e6;
  props.now.entitlementImportCapacityW = 40e6;
  rerender(
    <ThemeProvider theme={createAppTheme("light")}>
      <GridStatus {...props} />
    </ThemeProvider>,
  );
  const status = screen.getByRole("button", { name: /^Current grid status/ });
  for (const [name, target] of [
    ["Manage fleet", "FLEET"],
    ["Manage agreements", "AGREEMENTS"],
  ]) {
    props.onNavigate.mockImplementation(() =>
      expect(
        screen.queryByRole("dialog", { name: "Grid status" }),
      ).not.toBeInTheDocument(),
    );
    fireEvent.click(status);
    const dialog = screen.getByRole("dialog", { name: "Grid status" });
    expect(dialog).toHaveTextContent(
      "Purchased power now: 25MW · 25% of supply",
    );
    expect(dialog).toHaveTextContent("Under agreement: 40MW");
    fireEvent.click(within(dialog).getByRole("button", { name }));
    expect(props.onNavigate).toHaveBeenLastCalledWith(target);
  }
  fireEvent.click(status);
  fireEvent.click(screen.getByRole("button", { name: "View supply forecast" }));
  expect(props.onEvidence).toHaveBeenCalledWith({
    card: "INSIGHTS",
    layer: "SUPPLY_DEMAND",
  });
});

it("routes ordinary agreements to existing intertie controls and leaves no stale modal focus", async () => {
  const { props } = setup(101);
  const status = screen.getByRole("button", { name: /^Current grid status/ });
  fireEvent.click(status);
  fireEvent.click(screen.getByRole("button", { name: "Close grid status" }));
  await waitFor(() => expect(status).toHaveFocus());
  fireEvent.click(status);
  fireEvent.click(screen.getByRole("button", { name: "Manage agreements" }));
  expect(props.onNavigate).toHaveBeenCalledWith("BUILD_INTERTIES");
});

it("retains tutorial facts while allowing only revealed navigation", () => {
  const { props, rerender } = setup(0);
  fireEvent.click(screen.getByRole("button", { name: /^Current grid status/ }));
  expect(screen.getByRole("heading", { name: "Now" })).toBeVisible();
  expect(
    screen.queryByRole("button", {
      name: /Manage fleet|Manage agreements|View supply forecast/,
    }),
  ).not.toBeInTheDocument();
  rerender(
    <ThemeProvider theme={createAppTheme("light")}>
      <GridStatus {...props} tutorialActions={["INSIGHTS"]} />
    </ThemeProvider>,
  );
  expect(
    screen.getByRole("button", { name: "View supply forecast" }),
  ).toBeVisible();
});
